import dotenv from 'dotenv';
import { z } from 'zod';
dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('3000').transform(Number),
  HL_CLIENT_ID: z.string().min(1, 'HL_CLIENT_ID is required'),
  HL_CLIENT_SECRET: z.string().min(1, 'HL_CLIENT_SECRET is required'),
  HL_REDIRECT_URI: z.string().default('http://localhost:3000/redirect'),
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),
  SESSION_SECRET: z.string().default('dev-secret'),
  NUM_TEST_CASES: z.string().default('5').transform(Number),
  MAX_TURNS_PER_CASE: z.string().default('15').transform(Number),
  PER_CASE_TIMEOUT_MS: z.string().default('120000').transform(Number),
  SIMULATION_TIMEOUT_MS: z.string().default('660000').transform(Number),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

export const config = {
  port: env.PORT,

  hl: {
    clientId: env.HL_CLIENT_ID,
    clientSecret: env.HL_CLIENT_SECRET,
    redirectUri: env.HL_REDIRECT_URI,
    apiBaseUrl: 'https://services.leadconnectorhq.com',
    authBaseUrl: 'https://marketplace.gohighlevel.com',
    scopes: [
      'conversations.readonly',
      'conversations.write',
      'conversations/message.readonly',
      'conversations/message.write',
      'conversations/reports.readonly',
      'conversations/livechat.write',
      'voice-ai-dashboard.readonly',
      'voice-ai-agents.readonly',
      'voice-ai-agents.write',
      'voice-ai-agent-goals.readonly',
      'voice-ai-agent-goals.write',
    ],
  },

  anthropic: {
    apiKey: env.ANTHROPIC_API_KEY,
    model: 'claude-sonnet-4-6' as const,
  },

  simulation: {
    numTestCases: env.NUM_TEST_CASES,
    maxTurnsPerCase: env.MAX_TURNS_PER_CASE,
    perCaseTimeoutMs: env.PER_CASE_TIMEOUT_MS,
    timeoutMs: env.SIMULATION_TIMEOUT_MS,
  },
} as const;
