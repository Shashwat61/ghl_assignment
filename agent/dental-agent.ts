/**
 * Dental Agent — joins a LiveKit room as the AI dental assistant.
 *
 * Uses Google Gemini Multimodal Live (speech-to-speech) via @livekit/agents-plugin-google.
 * Room metadata must contain: { systemPrompt, scenario, timeoutMs }
 *
 * Run via: npm run agents (from project root)
 */
import { defineAgent, voice, JobContext } from '@livekit/agents';
import { beta } from '@livekit/agents-plugin-google';
import dotenv from 'dotenv';
dotenv.config();

export default defineAgent({
  entry: async (ctx: JobContext) => {
    await ctx.connect();

    const metadata = (() => {
      try {
        return JSON.parse(ctx.room.metadata || '{}');
      } catch {
        return {};
      }
    })();

    const systemPrompt: string =
      metadata.systemPrompt ||
      'You are a friendly, professional dental assistant. Help callers with their questions about dental services, appointments, and procedures.';

    const timeoutMs: number = metadata.timeoutMs || 180_000;

    const model = new beta.realtime.RealtimeModel({
      instructions: systemPrompt,
      voice: 'Puck',
      model: 'gemini-2.0-flash-exp',
      apiKey: process.env.GOOGLE_API_KEY,
    });

    const myAgent = new voice.Agent({ instructions: systemPrompt, llm: model });

    const session = new voice.AgentSession({ llm: model });

    // Listen for conversation items to publish transcript to backend
    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (ev) => {
      try {
        const item = (ev as any)?.item;
        if (!item) return;
        const text = item.content?.map?.((c: any) => c.text).filter(Boolean).join(' ');
        if (text && item.role) {
          const role = item.role === 'assistant' ? 'assistant' : 'user';
          ctx.room.localParticipant?.publishData(
            Buffer.from(JSON.stringify({ role, content: text })),
            { topic: 'transcript', reliable: true },
          );
        }
      } catch {
        // Non-fatal
      }
    });

    // 3-minute hard timeout
    const timeoutHandle = setTimeout(() => {
      session.close();
    }, timeoutMs);

    session.start({ agent: myAgent, room: ctx.room });

    // Block until session closes
    await new Promise<void>((resolve) => {
      session.on(voice.AgentSessionEventTypes.Close, () => {
        clearTimeout(timeoutHandle);
        resolve();
      });
    });
  },
});

// Allow running as standalone worker: npx ts-node agent/dental-agent.ts dev
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
