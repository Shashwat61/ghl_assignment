import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { logger } from '../logger';
import { sessionStore } from './sessionStore';

function getClient(): Anthropic {
  const apiKey = sessionStore.getAnthropicApiKey();
  if (!apiKey) {
    throw new Error('No Anthropic API key set. Please enter your API key in the app settings.');
  }
  return new Anthropic({ apiKey });
}

export interface TestCase {
  scenario: string;
  kpis: string[];
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface KpiResult {
  kpi: string;
  result: 'pass' | 'fail';
  reasoning: string;
}

export interface EvaluationResult {
  overall: 'pass' | 'fail';
  kpiResults: KpiResult[];
  summary: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripMarkdownFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/\s*```\s*$/im, '')
    .trim();
}

async function extractJSON<T>(text: string, retryFn: () => Promise<string>, retries = 0): Promise<T> {
  const cleaned = stripMarkdownFences(text);
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Try regex extraction: find first [...] or {...} block
    const match = cleaned.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
    if (match) {
      try {
        return JSON.parse(match[1]) as T;
      } catch { /* fall through */ }
    }

    if (retries < 2) {
      logger.warn(`JSON parse failed, retry ${retries + 1}/2`, { raw: text.slice(0, 200) });
      const newText = await retryFn();
      return extractJSON<T>(newText, retryFn, retries + 1);
    }

    throw new Error(`Failed to parse JSON after 3 attempts. Raw: ${text.slice(0, 200)}`);
  }
}

async function callClaude(
  systemPrompt: string,
  userMessage: string,
  maxTokens = 2048,
): Promise<string> {
  const response = await getClient().messages.create({
    model: config.anthropic.model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const block = response.content[0];
  if (block.type !== 'text') throw new Error('Unexpected response type from Claude');
  return block.text;
}

async function callClaudeWithHistory(
  systemPrompt: string,
  messages: Anthropic.MessageParam[],
  maxTokens = 1024,
): Promise<string> {
  const response = await getClient().messages.create({
    model: config.anthropic.model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
  });

  const block = response.content[0];
  if (block.type !== 'text') throw new Error('Unexpected response type from Claude');
  return block.text;
}

// ---------------------------------------------------------------------------
// Chain 1 — Generate Test Cases
// ---------------------------------------------------------------------------

const CHAIN1_SYSTEM = `You are a senior QA architect specializing in voice AI systems.
Your task is to generate realistic, diverse test cases for a Voice AI agent.
Each test case should probe different aspects of the agent's capabilities and potential failure modes.
Respond ONLY with valid JSON — no preamble, no markdown fences, no explanation.`;

export async function generateTestCases(
  agentPrompt: string,
  numCases: number,
): Promise<TestCase[]> {
  const userMessage = `Given this Voice AI agent system prompt:

---
${agentPrompt}
---

Generate exactly ${numCases} diverse test cases that thoroughly validate this agent.
Each test case should target a different scenario or edge case.

Return a JSON array with exactly ${numCases} objects, each with:
- "scenario": A 1-2 sentence description of the caller situation and goal
- "kpis": An array of 2-4 outcome-based success criteria strings

IMPORTANT KPI rules:
- KPIs must be OUTCOME-based, not FORMAT-based. Judge WHAT the agent accomplishes, not HOW it phrases things.
- BAD KPI: "Agent uses exactly two sentences to handle pricing questions"
- GOOD KPI: "Agent acknowledges the pricing question and offers to connect the caller with the right person"
- KPIs should be clearly pass/fail based on conversation content — avoid subjective or overly specific wording requirements.

Example format:
[
  {
    "scenario": "A frustrated customer calls to cancel their subscription after being charged twice",
    "kpis": ["Agent acknowledges the billing issue", "Agent offers a concrete resolution such as a refund or credit", "Agent handles the cancellation request or escalates appropriately"]
  }
]`;

  const retryFn = () => callClaude(CHAIN1_SYSTEM, userMessage, 2048);
  const rawText = await retryFn();
  return extractJSON<TestCase[]>(rawText, retryFn);
}

// ---------------------------------------------------------------------------
// Chain 2 — Simulate User Turn
// ---------------------------------------------------------------------------

const CHAIN2_SYSTEM = `You are roleplaying as a caller interacting with an AI phone agent.
Stay fully in character as the caller — never break character or acknowledge you are an AI.
Your messages should sound natural and human: include realistic hesitations, emotions, or follow-up questions.
Keep responses to 1-3 sentences as a real phone caller would speak.
Respond with ONLY the caller's spoken words — no stage directions, no JSON, no formatting.

CRITICAL RULES:
- If the agent asks for your name, email, or any contact details, provide realistic fictional details (e.g. "Sure, it's Jane Smith" / "jane.smith@gmail.com").
- If the agent asks a follow-up question, answer it — do not hang up or end the call prematurely.
- Only say goodbye AFTER the agent has fully wrapped up the call (confirmed your details back, said a closing phrase).
- Do NOT end the call just because your original question was answered — let the full conversation play out naturally.`;

export async function simulateUserTurn(
  scenario: string,
  history: ConversationTurn[],
): Promise<string> {
  const historyText = history
    .map((t) => `${t.role === 'user' ? 'Caller' : 'Agent'}: ${t.content}`)
    .join('\n');

  const userMessage = `Scenario: ${scenario}

${historyText ? `Conversation so far:\n${historyText}\n\n` : ''}${history.length === 0 ? 'Start the conversation as the caller making their first statement.' : 'Continue the conversation as the caller with your next response.'}`;

  return callClaude(CHAIN2_SYSTEM, userMessage, 512);
}

// ---------------------------------------------------------------------------
// Chain 3 — Simulate Agent Turn
// ---------------------------------------------------------------------------

// These phrases must unambiguously signal the agent is CLOSING the call.
// Do NOT include mid-conversation phrases like "is there anything else" or
// "we'll be in touch" — agents say those while still collecting info.
const END_OF_CONVERSATION_PHRASES = [
  'have a great day', 'have a wonderful day', 'have a good day',
  'goodbye', 'good bye', 'take care',
  'have a pleasant day', 'farewell',
  'we look forward to seeing you',
];

export interface AgentTurnResult {
  content: string;
  isConversationEnd: boolean;
}

export async function simulateAgentTurn(
  agentPrompt: string,
  history: ConversationTurn[],
): Promise<AgentTurnResult> {
  const messages: Anthropic.MessageParam[] = history.map((turn) => ({
    role: turn.role,
    content: turn.content,
  }));

  const content = await callClaudeWithHistory(agentPrompt, messages, 1024);
  const lower = content.toLowerCase();
  const isConversationEnd = END_OF_CONVERSATION_PHRASES.some((phrase) =>
    lower.includes(phrase),
  );

  return { content, isConversationEnd };
}

// ---------------------------------------------------------------------------
// Chain 4 — Evaluate Transcript
// ---------------------------------------------------------------------------

const CHAIN4_SYSTEM = `You are an objective QA evaluator for voice AI systems.
Your task is to evaluate a conversation transcript against specific KPIs.
Be rigorous but fair — judge based on the actual conversation content.
A single KPI failure means overall = "fail".
Respond ONLY with valid JSON — no preamble, no markdown fences, no explanation.`;

export async function evaluateTranscript(
  transcript: ConversationTurn[],
  kpis: string[],
  scenario: string,
): Promise<EvaluationResult> {
  const transcriptText = transcript
    .map((t) => `${t.role === 'user' ? 'Caller' : 'Agent'}: ${t.content}`)
    .join('\n');

  const userMessage = `Evaluate this voice AI conversation transcript against the given KPIs.

Scenario: ${scenario}

KPIs to evaluate:
${kpis.map((kpi, i) => `${i + 1}. ${kpi}`).join('\n')}

Conversation transcript:
---
${transcriptText}
---

Return a JSON object with:
- "overall": "pass" if ALL KPIs pass, "fail" if ANY KPI fails
- "kpiResults": array of objects, one per KPI, each with:
  - "kpi": the KPI text
  - "result": "pass" or "fail"
  - "reasoning": 1-2 sentence explanation citing specific evidence from the transcript
- "summary": 2-3 sentence overall assessment

JSON format:
{
  "overall": "pass" | "fail",
  "kpiResults": [{"kpi": "...", "result": "pass"|"fail", "reasoning": "..."}],
  "summary": "..."
}`;

  const retryFn = () => callClaude(CHAIN4_SYSTEM, userMessage, 2048);
  const rawText = await retryFn();
  return extractJSON<EvaluationResult>(rawText, retryFn);
}

// ---------------------------------------------------------------------------
// Chain 5 — Optimize Prompt
// ---------------------------------------------------------------------------

export interface FailureEntry {
  scenario: string;
  kpi: string;
  reasoning: string;
}

export interface PassEntry {
  scenario: string;
  kpi: string;
}

const CHAIN5_SYSTEM = `You are an expert prompt engineer specializing in voice AI systems.
Your task is to improve an AI agent's system prompt to fix identified failures WITHOUT breaking passing behaviors.
The improved prompt must be a complete, drop-in replacement — not a diff or commentary.
Output ONLY the improved system prompt text — no preamble, no explanation, no markdown.`;

export async function optimizePrompt(
  originalPrompt: string,
  failures: FailureEntry[],
  passes: PassEntry[] = [],
): Promise<string> {
  const failureList = failures
    .map(
      (f, i) =>
        `${i + 1}. Scenario: "${f.scenario}"\n   Failed KPI: "${f.kpi}"\n   Why it failed: ${f.reasoning}`,
    )
    .join('\n\n');

  const passList = passes.length > 0
    ? passes
        .map((p, i) => `${i + 1}. Scenario: "${p.scenario}"\n   Passing KPI: "${p.kpi}"`)
        .join('\n\n')
    : '(none recorded)';

  const userMessage = `Original agent system prompt:
---
${originalPrompt}
---

FAILURES to fix (the prompt must address all of these):

${failureList}

PASSING behaviors to preserve (do NOT regress these):

${passList}

Rewrite the system prompt to fix all failures while keeping all passing behaviors intact. Return ONLY the improved prompt text.`;

  return callClaude(CHAIN5_SYSTEM, userMessage, 4096);
}
