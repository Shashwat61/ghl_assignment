import { Router, Request, Response, NextFunction } from 'express';
import * as fs from 'fs';
import { requireAuth } from '../middleware/auth';
import { hlClient } from '../services/hlClient';
import { livekitService } from '../services/livekitService';
import { generateTestCases, evaluateTranscript, ConversationTurn } from '../services/promptChains';
import { config } from '../config';
import { logger } from '../logger';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// In-memory SSE event bus per sessionId
const voiceSessions = new Map<string, {
  events: Array<{ type: string; data: unknown }>;
  listeners: Array<(event: { type: string; data: unknown }) => void>;
  done: boolean;
}>();

function createVoiceSession(sessionId: string) {
  voiceSessions.set(sessionId, { events: [], listeners: [], done: false });
}

function emitVoiceEvent(sessionId: string, type: string, data: unknown) {
  const session = voiceSessions.get(sessionId);
  if (!session) return;
  const event = { type, data };
  session.events.push(event);
  session.listeners.forEach((fn) => fn(event));
}

function markVoiceSessionDone(sessionId: string) {
  const session = voiceSessions.get(sessionId);
  if (session) session.done = true;
  // Clean up after 5 minutes
  setTimeout(() => voiceSessions.delete(sessionId), 5 * 60 * 1000);
}

/**
 * POST /api/voice/run
 * Body: { agentId: string }
 *
 * Creates LiveKit rooms and runs voice call simulations for each test case.
 * Returns immediately with { sessionId } for SSE streaming.
 */
router.post(
  '/voice/run',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    const { agentId } = req.body as { agentId?: string };

    if (!agentId) {
      res.status(400).json({ error: 'Missing agentId in request body' });
      return;
    }

    const sessionId = uuidv4();
    createVoiceSession(sessionId);

    // Respond immediately with sessionId so client can open SSE stream
    res.json({ sessionId });

    // Run voice simulation in background (no await)
    runVoiceSimulation(agentId, sessionId).catch((err) => {
      logger.error('Voice simulation failed', { agentId, sessionId, error: err instanceof Error ? err.stack : err });
      emitVoiceEvent(sessionId, 'voice_error', { message: err instanceof Error ? err.message : 'Voice simulation failed' });
      markVoiceSessionDone(sessionId);
    });
  },
);

/**
 * GET /api/voice/stream?sessionId=xxx
 * SSE stream of voice simulation progress events.
 */
router.get(
  '/voice/stream',
  requireAuth,
  (req: Request, res: Response) => {
    const { sessionId } = req.query;

    if (!sessionId || typeof sessionId !== 'string') {
      res.status(400).json({ error: 'Missing sessionId query parameter' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const write = (type: string, data: unknown) => {
      res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
      if (typeof (res as any).flush === 'function') (res as any).flush();
    };

    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
    }, 15_000);

    const session = voiceSessions.get(sessionId);
    if (!session) {
      write('voice_error', { message: 'Session not found' });
      res.end();
      clearInterval(heartbeat);
      return;
    }

    // Replay buffered events
    session.events.forEach((e) => write(e.type, e.data));

    if (session.done) {
      clearInterval(heartbeat);
      res.end();
      return;
    }

    // Listen for new events
    const listener = (event: { type: string; data: unknown }) => {
      write(event.type, event.data);
      if (event.type === 'voice_complete' || event.type === 'voice_error') {
        clearInterval(heartbeat);
        res.end();
      }
    };

    session.listeners.push(listener);

    req.on('close', () => {
      clearInterval(heartbeat);
      const s = voiceSessions.get(sessionId);
      if (s) {
        s.listeners = s.listeners.filter((fn) => fn !== listener);
      }
    });
  },
);

// ---------------------------------------------------------------------------
// Core voice simulation logic
// ---------------------------------------------------------------------------

async function runVoiceSimulation(agentId: string, sessionId: string): Promise<void> {
  emitVoiceEvent(sessionId, 'voice_status', { message: 'Fetching agent configuration...' });

  const agent = await hlClient.getAgent(agentId);
  const agentPrompt: string =
    (agent.systemPrompt as string) ||
    (agent.description as string) ||
    'You are a helpful dental assistant.';

  emitVoiceEvent(sessionId, 'voice_status', { message: `Generating test cases for agent: ${agent.name || agentId}` });

  const testCases = await generateTestCases(agentPrompt, config.simulation.numTestCases);

  emitVoiceEvent(sessionId, 'voice_status', { message: `Generated ${testCases.length} test cases. Starting voice calls...` });

  const allResults: Array<{
    index: number;
    testCase: typeof testCases[number];
    evaluation: ReturnType<typeof evaluateTranscript> extends Promise<infer T> ? T : never;
    recordingFile: string | null;
  }> = [];

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    const roomName = `voice-${agentId}-case${i}-${Date.now()}`;

    emitVoiceEvent(sessionId, 'voice_case_start', {
      index: i,
      testCase: tc,
      total: testCases.length,
    });

    emitVoiceEvent(sessionId, 'voice_status', { message: `Case ${i + 1}/${testCases.length}: Creating LiveKit room...` });

    let listenerRoom: import('@livekit/rtc-node').Room | null = null;
    let stopRecording: (() => Promise<void>) | null = null;
    let recordingPath: string | null = null;
    const transcript: ConversationTurn[] = [];

    try {
      // Room metadata for agents
      const roomMetadata = {
        systemPrompt: agentPrompt,
        scenario: tc.scenario,
        timeoutMs: config.livekit.voiceCallTimeoutMs,
        caseIndex: i,
      };

      await livekitService.createRoom(roomName, roomMetadata);

      // Dispatch both agents into the room via AgentDispatchClient
      emitVoiceEvent(sessionId, 'voice_status', { message: `Case ${i + 1}: Dispatching agents...` });
      await Promise.all([
        livekitService.dispatchAgent(roomName, 'dental-agent'),
        livekitService.dispatchAgent(roomName, 'caller-agent'),
      ]);
      logger.info(`Agents dispatched to room ${roomName}`);

      // Wait for agents to join (30s window)
      emitVoiceEvent(sessionId, 'voice_status', { message: `Case ${i + 1}: Waiting for agents to join...` });
      const joined = await livekitService.waitForParticipants(roomName, 2, 30_000);

      if (!joined) {
        emitVoiceEvent(sessionId, 'voice_status', {
          message: `Case ${i + 1}: Agents did not join within 30s — is "npm run agents" running?`,
        });
      } else {
        emitVoiceEvent(sessionId, 'voice_status', { message: `Case ${i + 1}: Both agents joined. Call in progress (up to 3 min)...` });

        // Join as backend-listener AFTER agents have joined.
        // Agents join as ParticipantKind.AGENT and lock onto each other for audio input.
        // The listener joins as STANDARD kind — joining before agents would cause them
        // to pick the listener as their audio target instead of each other.
        try {
          const listener = await livekitService.joinRoomAsListener(roomName);
          listenerRoom = listener.room;
          (listenerRoom as any).__transcript = listener.transcript;
          stopRecording = listener.stopRecording;
          recordingPath = listener.recordingPath;
          logger.info(`Backend listener joined room after agents: ${roomName}`);
        } catch (listenerErr) {
          logger.warn(`Failed to join room as listener — transcripts/recording won't be collected`, { error: listenerErr });
        }

        // Wait for call to end or timeout
        const outcome = await livekitService.waitForRoomEmpty(roomName, config.livekit.voiceCallTimeoutMs);
        emitVoiceEvent(sessionId, 'voice_status', {
          message: `Case ${i + 1}: Call ended (${outcome === 'timeout' ? 'timeout' : 'natural end'})`,
        });
      }

      // Stop recording — flushes ffmpeg and finalises the .ogg file
      if (stopRecording) {
        await stopRecording().catch((e) => logger.warn('stopRecording error', { error: e }));
        stopRecording = null;
      }

      // Collect transcript from listener
      if (listenerRoom && (listenerRoom as any).__transcript) {
        transcript.push(...(listenerRoom as any).__transcript as ConversationTurn[]);
        logger.info(`Collected ${transcript.length} transcript turns from room ${roomName}`);
      }

      // Disconnect listener
      if (listenerRoom) {
        try { await listenerRoom.disconnect(); } catch { /* non-fatal */ }
        listenerRoom = null;
      }

      // Evaluate with whatever transcript we collected (or a minimal fallback)
      emitVoiceEvent(sessionId, 'voice_status', { message: `Case ${i + 1}: Evaluating...` });

      if (transcript.length === 0) {
        // Agents publish transcript via data channel — if none received, create placeholder
        transcript.push({
          role: 'user',
          content: `[Voice call scenario: ${tc.scenario}]`,
        });
        transcript.push({
          role: 'assistant',
          content: '[Voice call transcript unavailable — agent did not publish text data]',
        });
      }

      const evaluation = await evaluateTranscript(transcript, tc.kpis, tc.scenario);
      const recFile = recordingPath && fs.existsSync(recordingPath)
        ? livekitService.recordingFilename(roomName)
        : null;

      emitVoiceEvent(sessionId, 'voice_case_complete', {
        index: i,
        testCase: tc,
        evaluation,
        transcript,
        recordingFile: recFile,
      });

      allResults.push({ index: i, testCase: tc, evaluation, recordingFile: recFile });
    } catch (caseErr) {
      logger.error(`Voice case ${i} failed`, { roomName, error: caseErr instanceof Error ? caseErr.stack : caseErr });

      emitVoiceEvent(sessionId, 'voice_case_error', {
        index: i,
        message: caseErr instanceof Error ? caseErr.message : 'Case failed',
      });
    } finally {
      if (stopRecording) {
        await stopRecording().catch(() => {});
      }
      if (listenerRoom) {
        try { await listenerRoom.disconnect(); } catch { /* non-fatal */ }
      }
      await livekitService.deleteRoom(roomName).catch(() => {});
    }
  }

  emitVoiceEvent(sessionId, 'voice_complete', {
    results: allResults,
    total: testCases.length,
    completed: allResults.length,
  });

  markVoiceSessionDone(sessionId);
}

export default router;
