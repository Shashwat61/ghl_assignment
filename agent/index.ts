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
import { AgentServer, ServerOptions, initializeLogger } from '@livekit/agents';
import * as path from 'path';
import dotenv from 'dotenv';
dotenv.config();

initializeLogger({ level: 'info', pretty: true });

const lkUrl = process.env.LIVEKIT_URL || 'ws://localhost:7880';
const apiKey = process.env.LIVEKIT_API_KEY || 'devkey';
const apiSecret = process.env.LIVEKIT_API_SECRET || 'devsecret';

// Point at compiled .js files — the framework dynamically imports this path in child processes.
// At runtime __dirname is dist/agent/, so sibling .js files are right here.
const agentDistDir = __dirname;

const dentalOpts = new ServerOptions({
  agent: path.join(agentDistDir, 'dental-agent.js'),
  agentName: 'dental-agent',
  wsURL: lkUrl,
  apiKey,
  apiSecret,
});

const callerOpts = new ServerOptions({
  agent: path.join(agentDistDir, 'caller-agent.js'),
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
