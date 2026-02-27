import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { hlClient } from '../services/hlClient';
import { runFullSimulation, generateOptimizedPrompt, SimulationProgressEvent } from '../services/simulationEngine';
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
      const optimizedPrompt = await generateOptimizedPrompt(originalPrompt, failures);
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

export default router;
