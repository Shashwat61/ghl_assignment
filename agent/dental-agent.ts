/**
 * Dental Agent — joins a LiveKit room as the AI dental assistant.
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

    const systemPrompt: string =
      metadata.systemPrompt ||
      'You are a friendly, professional dental assistant. Help callers with their questions about dental services, appointments, and procedures.';

    const timeoutMs: number = metadata.timeoutMs || 180_000;

    if (!process.env.GOOGLE_API_KEY) {
      throw new Error('GOOGLE_API_KEY is not set in .env — Gemini Live requires a valid API key');
    }

    const model = new google.beta.realtime.RealtimeModel({
      instructions: systemPrompt,
      voice: 'Puck',
      model: 'gemini-2.5-flash-native-audio-preview-12-2025',
      apiKey: process.env.GOOGLE_API_KEY,
    });

    const session = new voice.AgentSession({
      llm: model,
      voiceOptions: {
        // Disable user-away timeout — the "user" is another agent, not a human
        userAwayTimeout: null,
      },
    });

    // Publish only the agent's own speech (role === 'assistant') as transcript.
    // ConversationItemAdded also fires for 'user' turns (what the agent hears from the caller),
    // but those are published by the caller-agent, so we skip them here to avoid duplicates.
    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (ev: any) => {
      try {
        const item = ev?.item;
        if (item?.role !== 'assistant') return;
        const text = item?.textContent;
        if (!text) return;
        ctx.room.localParticipant?.publishData(
          Buffer.from(JSON.stringify({ role: 'assistant', content: text })),
          { topic: 'transcript', reliable: true },
        );
      } catch { /* non-fatal */ }
    });

    // Hard timeout
    const timeoutHandle = setTimeout(() => session.close(), timeoutMs);

    session.start({
      agent: new voice.Agent({ instructions: systemPrompt, llm: model }),
      room: ctx.room,
      inputOptions: {
        // Accept audio from AGENT participants (the caller-agent)
        participantKinds: [ParticipantKind.AGENT, ParticipantKind.STANDARD, ParticipantKind.SIP],
        // Don't close when the other agent disconnects — let the timeout handle cleanup
        closeOnDisconnect: false,
      },
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
    agentName: 'dental-agent',
    wsURL: process.env.LIVEKIT_URL || 'ws://localhost:7880',
    apiKey: process.env.LIVEKIT_API_KEY || 'devkey',
    apiSecret: process.env.LIVEKIT_API_SECRET || 'devsecret',
  }));
}
