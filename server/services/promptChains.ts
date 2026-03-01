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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function callWithRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const is429 = err?.status === 429 || err?.message?.includes('rate_limit');
      if (is429 && attempt < retries - 1) {
        const wait = (attempt + 1) * 20_000; // 20s, 40s backoff
        logger.warn(`Rate limited by Anthropic — waiting ${wait / 1000}s before retry ${attempt + 1}/${retries - 1}`);
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
  throw new Error('callWithRetry exhausted');
}

async function callClaude(
  systemPrompt: string,
  userMessage: string,
  maxTokens = 2048,
): Promise<string> {
  const response = await callWithRetry(() => getClient().messages.create({
    model: config.anthropic.model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  }));

  const block = response.content[0];
  if (block.type !== 'text') throw new Error('Unexpected response type from Claude');
  return block.text;
}

async function callClaudeWithHistory(
  systemPrompt: string,
  messages: Anthropic.MessageParam[],
  maxTokens = 1024,
): Promise<string> {
  const response = await callWithRetry(() => getClient().messages.create({
    model: config.anthropic.model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
  }));

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
- KPIs must only evaluate AGENT behavior — never require outcomes that depend on the caller's cooperation.
- BAD KPI: "Agent collects both name and email before the call ends" (caller may refuse and hang up — agent can't control this)
- GOOD KPI: "Agent makes at least one clear attempt to collect name and email"
- KPIs must be simple and broad — do NOT enumerate sub-requirements or checklists within a single KPI.
- BAD KPI: "Agent provides a description of braces including candidacy information and all four required elements" (invents a checklist — evaluator will always find something missing)
- GOOD KPI: "Agent provides a substantive description of braces that goes beyond a generic tagline"
- Do NOT add phrasing sub-requirements (e.g. "explaining that details are needed so the team can follow up") — judge intent, not exact words.
- If a scenario involves a caller who refuses or is uncooperative, KPIs should test how the agent HANDLES the refusal, not whether the agent ultimately succeeds despite it.

Example format:
[
  {
    "scenario": "A frustrated customer calls to cancel their subscription after being charged twice",
    "kpis": ["Agent acknowledges the billing issue", "Agent offers a concrete resolution such as a refund or credit", "Agent handles the cancellation request or escalates appropriately"]
  }
]`;

  const retryFn = () => callClaude(CHAIN1_SYSTEM, userMessage, 2048);
  const rawText = await retryFn();
  const cases = await extractJSON<TestCase[]>(rawText, retryFn);
  return cases.slice(0, numCases);
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
  "i'll see you", "see you saturday", "see you then", "see you soon",
  "that's that", "i'm hanging up", "hanging up now",
];

// Phrases in the CALLER's message that signal they are ending the call
const CALLER_END_PHRASES = [
  'goodbye', 'good bye', 'bye', 'take care',
  "i'm hanging up", "hanging up", "i'll see you", "see you saturday",
  "see you then", "see you soon", "that's that", "farewell",
];

export function isCallerEndingCall(callerMessage: string): boolean {
  const lower = callerMessage.toLowerCase();
  return CALLER_END_PHRASES.some((phrase) => lower.includes(phrase));
}

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
Be fair and reasonable — judge the INTENT and substance of what was said, not exact wording.
If the agent's response clearly satisfies the spirit of a KPI, mark it pass even if the phrasing differs from the KPI wording.
Only fail a KPI if there is clear, concrete evidence the agent did NOT do what was required — do not fail on technicalities or hairsplitting.
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

  const retryFn = () => callClaude(CHAIN4_SYSTEM, userMessage, 4096);
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
Your task is to fix specific failures in an AI agent's system prompt by outputting a minimal JSON patch.

Output ONLY a JSON object with these fields:
- "insertions": array of short instruction strings to append to the prompt (use this for new rules/behaviors to add)
- "replacements": array of {"find": "exact text in original", "replace": "new text"} objects (use this to fix existing instructions)

Keep insertions concise — one clear instruction per item. Do not rewrite sections that are already working.
Respond ONLY with valid JSON — no preamble, no markdown fences, no explanation.`;

export interface PreviousAttempt {
  prompt: string;
  failures: FailureEntry[];
}

interface PromptPatch {
  insertions: string[];
  replacements: { find: string; replace: string }[];
}

function applyPatch(original: string, patch: PromptPatch): string {
  let result = original;
  for (const { find, replace } of patch.replacements) {
    if (result.includes(find)) {
      result = result.replace(find, replace);
    }
  }
  if (patch.insertions.length > 0) {
    result = result.trimEnd() + '\n\n' + patch.insertions.join('\n');
  }
  return result;
}

export async function optimizePrompt(
  originalPrompt: string,
  failures: FailureEntry[],
  passes: PassEntry[] = [],
  previousAttempts: PreviousAttempt[] = [],
): Promise<string> {
  const failureList = failures
    .map(
      (f, i) =>
        `${i + 1}. Scenario: "${f.scenario}"\n   Failed KPI: "${f.kpi}"\n   Why it failed: ${f.reasoning}`,
    )
    .join('\n\n');

  // Only include passing KPI topics (not full entries) to keep input short
  const passTopics = passes.length > 0
    ? `Passing behaviors to preserve (do not regress): ${[...new Set(passes.map(p => p.kpi))].join('; ')}`
    : '';

  const previousAttemptsSection = previousAttempts.length > 0
    ? `\nPREVIOUS PATCHES THAT DID NOT FIX THE FAILURES (try a different approach):\n` +
      previousAttempts.map((a, i) => {
        const prevFailureList = a.failures
          .map((f) => `   - "${f.kpi}" — ${f.reasoning}`)
          .join('\n');
        return `Attempt ${i + 1} still failed:\n${prevFailureList}`;
      }).join('\n') + '\n'
    : '';

  const userMessage = `Agent system prompt:
---
${originalPrompt}
---
${previousAttemptsSection}
FAILURES to fix:

${failureList}

${passTopics}

Output a JSON patch to fix all failures. Use "insertions" to add new rules, "replacements" to fix existing ones.`;

  const retryFn = () => callClaude(CHAIN5_SYSTEM, userMessage, 1024);
  const rawText = await retryFn();
  const patch = await extractJSON<PromptPatch>(rawText, retryFn);

  return applyPatch(originalPrompt, patch);
}
