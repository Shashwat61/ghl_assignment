/**
 * Caller Agent — joins a LiveKit room as a simulated patient/caller.
 *
 * Uses Google Gemini Multimodal Live (speech-to-speech) via @livekit/agents-plugin-google.
 * Room metadata must contain: { scenario, timeoutMs }
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

    const scenario: string =
      metadata.scenario ||
      'You are calling a dental office to ask about their services.';

    const timeoutMs: number = metadata.timeoutMs || 180_000;

    const callerPrompt = `You are roleplaying as a caller to a dental office.

Scenario: ${scenario}

Rules:
- Keep responses to 1-3 sentences as a real phone caller would speak.
- Sound natural and human — include realistic hesitations and follow-up questions.
- If asked for your name, email, or contact details, provide realistic fictional details (e.g. "Sure, it's Jane Smith" / "jane.smith@gmail.com").
- If the agent asks a follow-up question, answer it — do not hang up or end the call prematurely.
- Only say goodbye AFTER the agent has fully wrapped up the call.
- Do NOT end the call just because your original question was answered — let the full conversation play out naturally.
- Start the conversation immediately with your first statement as the caller.`;

    const model = new beta.realtime.RealtimeModel({
      instructions: callerPrompt,
      voice: 'Charon',
      model: 'gemini-2.0-flash-exp',
      apiKey: process.env.GOOGLE_API_KEY,
    });

    const myAgent = new voice.Agent({ instructions: callerPrompt, llm: model });

    const session = new voice.AgentSession({ llm: model });

    // Listen for conversation items to publish transcript to backend
    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (ev) => {
      try {
        const item = (ev as any)?.item;
        if (!item) return;
        const text = item.content?.map?.((c: any) => c.text).filter(Boolean).join(' ');
        if (text && item.role) {
          // Caller perspective: the "assistant" role here is the caller speaking
          ctx.room.localParticipant?.publishData(
            Buffer.from(JSON.stringify({ role: 'user', content: text })),
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

// Allow running as standalone worker: npx ts-node agent/caller-agent.ts dev
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
