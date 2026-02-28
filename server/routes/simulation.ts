import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { hlClient } from '../services/hlClient';
import { runFullSimulation, runFlywheel, generateOptimizedPrompt, SimulationProgressEvent } from '../services/simulationEngine';
import { FailureEntry } from '../services/promptChains';
import { logger } from '../logger';

const router = Router();

/**
 * GET /api/simulate?agentId=xxx
 * Server-Sent Events stream for the full simulation pipeline.
 *
 * Events emitted:
 *   status       – progress message string
 *   testcase_start – new test case beginning
 *   turn         – individual conversation turn
 *   evaluated    – KPI evaluation result for a test case
 *   complete     – final results payload
 *   error        – error message, stream closes
 */
router.get(
  '/simulate',
  requireAuth,
  async (req: Request, res: Response) => {
    const { agentId } = req.query;

    if (!agentId || typeof agentId !== 'string') {
      res.status(400).json({ error: 'Missing agentId query parameter' });
      return;
    }

    // Setup SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx buffering
    res.flushHeaders();

    const sendEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      if (typeof (res as any).flush === 'function') (res as any).flush();
    };

    // Heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
    }, 15_000);

    const cleanup = () => clearInterval(heartbeat);
    req.on('close', cleanup);

    try {
      const agent = await hlClient.getAgent(agentId);

      const agentPrompt: string =
        (agent.systemPrompt as string) ||
        (agent.description as string) ||
        'You are a helpful voice AI assistant.';

      logger.debug(`Agent system prompt for ${agent.name || agentId}:\n` + agentPrompt);
      sendEvent('status', { message: `Starting simulation for agent: ${agent.name || agentId}` });

      const onProgress = (event: SimulationProgressEvent) => {
        sendEvent(event.type, event);
      };

      await runFullSimulation(agentPrompt, onProgress);
    } catch (err) {
      logger.error('Simulation failed', { agentId, error: err instanceof Error ? err.stack : err });
      const message = err instanceof Error ? err.message : 'Simulation failed';
      sendEvent('error', { message });
    } finally {
      cleanup();
      res.end();
    }
  },
);

/**
 * POST /api/optimize
 * Generates an optimized prompt and AUTO-PUSHES it to HighLevel.
 * No confirm step — push happens immediately.
 *
 * Body: { agentId: string, failures: FailureEntry[], originalPrompt: string }
 * Response: { optimizedPrompt: string, originalPrompt: string }
 */
router.post(
  '/optimize',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { agentId, failures, originalPrompt } = req.body as {
        agentId: string;
        failures: FailureEntry[];
        originalPrompt: string;
      };

      if (!agentId || !failures || !originalPrompt) {
        res.status(400).json({ error: 'Missing required fields: agentId, failures, originalPrompt' });
        return;
      }

      if (!Array.isArray(failures) || failures.length === 0) {
        res.status(400).json({ error: 'failures must be a non-empty array' });
        return;
      }

      // Chain 5: Generate optimized prompt
      logger.info('Generating optimized prompt', { agentId, failureCount: failures.length });
      logger.debug('Original prompt:\n' + originalPrompt);
      const optimizedPrompt = await generateOptimizedPrompt(originalPrompt, failures);
      logger.debug('Optimized prompt:\n' + optimizedPrompt);
      logger.info('Optimized prompt generated, pushing to HL', { agentId });

      // Auto-push to HighLevel immediately
      await hlClient.updateAgent(agentId, optimizedPrompt);
      logger.info(`Optimized prompt pushed to HL agent ${agentId}`);

      res.json({ optimizedPrompt, originalPrompt });
    } catch (err) {
      const axiosData = (err as any)?.response?.data;
      logger.error('Optimize failed', {
        agentId: req.body?.agentId,
        status: (err as any)?.response?.status,
        responseData: axiosData,
        error: err instanceof Error ? err.stack : err,
      });
      next(err);
    }
  },
);

/**
 * GET /api/flywheel?agentId=xxx
 * Full validation flywheel — Phase 1 (fix loop) + Phase 2 (harden loop).
 * Owns optimize + re-run internally; frontend just listens to SSE.
 *
 * Additional events vs /api/simulate:
 *   phase_change     – { phase: 'fix'|'harden', attempt, total }
 *   optimize_start   – { attempt }
 *   optimize_complete – { optimizedPrompt, attempt }
 *   complete         – includes currentPrompt
 */
router.get(
  '/flywheel',
  requireAuth,
  async (req: Request, res: Response) => {
    const { agentId } = req.query;

    if (!agentId || typeof agentId !== 'string') {
      res.status(400).json({ error: 'Missing agentId query parameter' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const sendEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      // Flush after every write — critical for large payloads like 'complete'
      if (typeof (res as any).flush === 'function') (res as any).flush();
    };

    let clientConnected = true;
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);
    const cleanup = () => {
      clearInterval(heartbeat);
      clientConnected = false;
    };
    req.on('close', cleanup);

    try {
      const agent = await hlClient.getAgent(agentId);
      const initialPrompt: string =
        (agent.systemPrompt as string) ||
        (agent.description as string) ||
        'You are a helpful voice AI assistant.';

      logger.debug(`Flywheel starting for ${agent.name || agentId}:\n` + initialPrompt);
      sendEvent('status', { message: `Starting flywheel for agent: ${agent.name || agentId}` });

      const onProgress = (event: SimulationProgressEvent) => sendEvent(event.type, event);

      const pushPrompt = async (prompt: string) => {
        await hlClient.updateAgent(agentId, prompt);
        logger.info(`Prompt pushed to HL agent ${agentId}`);
      };

      await runFlywheel(agentId, initialPrompt, onProgress, pushPrompt);
      logger.info(`Flywheel complete — clientConnected: ${clientConnected}`);
    } catch (err) {
      logger.error('Flywheel failed', { agentId, error: err instanceof Error ? err.stack : err });
      const message = err instanceof Error ? err.message : 'Flywheel failed';
      sendEvent('error', { message });
    } finally {
      cleanup();
      // Small delay ensures the last write (complete/error event) is flushed before closing
      await new Promise(resolve => setTimeout(resolve, 100));
      res.end();
    }
  },
);

export default router;
