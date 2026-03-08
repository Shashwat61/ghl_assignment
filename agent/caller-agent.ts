/**
 * Caller Agent — joins a LiveKit room as a simulated patient/caller.
 * Uses Google Gemini Multimodal Live via @livekit/agents-plugin-google.
 */
import { defineAgent, voice, JobContext, initializeLogger } from '@livekit/agents';
import { ParticipantKind } from '@livekit/rtc-node';
import * as google from '@livekit/agents-plugin-google';
import dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
initializeLogger({ level: 'info', pretty: true });

export default defineAgent({
  entry: async (ctx: JobContext) => {
    await ctx.connect();

    const metadata = (() => {
      try { return JSON.parse(ctx.room.metadata || '{}'); }
      catch { return {}; }
    })();

    const scenario: string =
      metadata.scenario ||
      'You are calling a dental office to ask about their services.';

    const timeoutMs: number = metadata.timeoutMs || 180_000;

    const callerPrompt = `You are roleplaying as a caller to a dental office. Speak naturally and concisely (1-3 sentences per turn).

Scenario: ${scenario}

Rules:
- If asked for your name, email, or contact details, provide realistic fictional details (e.g. "Sure, it's Jane Smith, jane.smith@gmail.com").
- Answer follow-up questions from the agent — do not hang up prematurely.
- Only say goodbye AFTER the agent has fully wrapped up the call.
- Speak your opening line immediately when the call starts without waiting.`;

    if (!process.env.GOOGLE_API_KEY) {
      throw new Error('GOOGLE_API_KEY is not set in .env — Gemini Live requires a valid API key');
    }

    const model = new google.beta.realtime.RealtimeModel({
      instructions: callerPrompt,
      voice: 'Charon',
      model: 'gemini-2.5-flash-native-audio-preview-12-2025',
      apiKey: process.env.GOOGLE_API_KEY,
    });

    const myAgent = new voice.Agent({
      instructions: callerPrompt,
      llm: model,
    });

    const session = new voice.AgentSession({
      llm: model,
      voiceOptions: {
        // Disable user-away timeout — the "user" is another agent, not a human
        userAwayTimeout: null,
      },
    });

    // Publish only the caller's own speech (role === 'assistant' in its own session context)
    // as 'user' turns in the transcript (caller = human side from evaluation perspective).
    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (ev: any) => {
      try {
        const item = ev?.item;
        if (item?.role !== 'assistant') return;
        const text = item?.textContent;
        if (!text) return;
        ctx.room.localParticipant?.publishData(
          Buffer.from(JSON.stringify({ role: 'user', content: text })),
          { topic: 'transcript', reliable: true },
        );
      } catch { /* non-fatal */ }
    });

    // Hard timeout
    const timeoutHandle = setTimeout(() => session.close(), timeoutMs);

    session.start({
      agent: myAgent,
      room: ctx.room,
      inputOptions: {
        // Accept audio from AGENT participants (the dental-agent)
        participantKinds: [ParticipantKind.AGENT, ParticipantKind.STANDARD, ParticipantKind.SIP],
        // Don't close when the other agent disconnects
        closeOnDisconnect: false,
      },
    });

    // Caller initiates — trigger the opening line once the session is listening
    session.once(voice.AgentSessionEventTypes.AgentStateChanged, async (ev: any) => {
      if (ev?.newState !== 'listening') return;
      try {
        await session.generateReply({
          userInput: 'Start the conversation as the caller. Say your opening line now.',
        });
      } catch { /* non-fatal */ }
    });

    await new Promise<void>((resolve) => {
      session.on(voice.AgentSessionEventTypes.Close, () => {
        clearTimeout(timeoutHandle);
        resolve();
      });
    });
  },
});

if (require.main === module) {
  const { ServerOptions, cli: agentCli } = require('@livekit/agents');
  const path = require('path');
  agentCli.runApp(new ServerOptions({
    agent: path.resolve(__filename),
    agentName: 'caller-agent',
    wsURL: process.env.LIVEKIT_URL || 'ws://localhost:7880',
    apiKey: process.env.LIVEKIT_API_KEY || 'devkey',
    apiSecret: process.env.LIVEKIT_API_SECRET || 'devsecret',
  }));
}
