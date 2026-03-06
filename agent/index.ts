/**
 * Agent worker entry point.
 *
 * Starts two separate LiveKit agent workers:
 *   - dental-agent: joins as the AI dental assistant (uses HL system prompt)
 *   - caller-agent: joins as the simulated caller (uses scenario as prompt)
 *
 * Usage:
 *   npm run agents          (runs both workers)
 *   npx ts-node agent/dental-agent.ts dev  (dental only)
 *   npx ts-node agent/caller-agent.ts dev  (caller only)
 *
 * Prerequisites:
 *   - LiveKit server running (docker compose up -d)
 *   - .env configured with LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, GOOGLE_API_KEY
 */
import { AgentServer, ServerOptions, cli } from '@livekit/agents';
import * as path from 'path';
import dotenv from 'dotenv';
dotenv.config();

const lkUrl = process.env.LIVEKIT_URL || 'ws://localhost:7880';
const apiKey = process.env.LIVEKIT_API_KEY || 'devkey';
const apiSecret = process.env.LIVEKIT_API_SECRET || 'devsecret';

// WorkerOptions.agent expects a path to the agent file (loaded dynamically by the framework)
const dentalOpts = new ServerOptions({
  agent: path.resolve(__dirname, 'dental-agent.ts'),
  agentName: 'dental-agent',
  wsURL: lkUrl,
  apiKey,
  apiSecret,
});

const callerOpts = new ServerOptions({
  agent: path.resolve(__dirname, 'caller-agent.ts'),
  agentName: 'caller-agent',
  wsURL: lkUrl,
  apiKey,
  apiSecret,
});

// Run both workers
async function main() {
  const dentalWorker = new AgentServer(dentalOpts);
  const callerWorker = new AgentServer(callerOpts);

  process.on('SIGINT', async () => {
    console.log('\nShutting down agent workers...');
    await Promise.all([dentalWorker.close(), callerWorker.close()]);
    process.exit(0);
  });

  await Promise.all([dentalWorker.run(), callerWorker.run()]);
}

main().catch((err) => {
  console.error('Agent workers failed:', err);
  process.exit(1);
});
