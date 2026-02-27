import { config } from '../config';
import {
  TestCase,
  ConversationTurn,
  EvaluationResult,
  FailureEntry,
  AgentTurnResult,
  generateTestCases,
  simulateUserTurn,
  simulateAgentTurn,
  evaluateTranscript,
  optimizePrompt,
} from './promptChains';

export type SimulationProgressEvent =
  | { type: 'status'; message: string }
  | { type: 'testcase_start'; index: number; testCase: TestCase }
  | { type: 'turn'; caseIndex: number; role: 'user' | 'assistant'; content: string }
  | { type: 'evaluated'; index: number; evaluation: EvaluationResult }
  | { type: 'complete'; testCases: TestCase[]; results: EvaluationResult[]; failures: FailureEntry[]; timedOut: boolean; completedCount: number }
  | { type: 'error'; message: string };

export type ProgressCallback = (event: SimulationProgressEvent) => void;

export interface SimulationResult {
  testCases: TestCase[];
  results: EvaluationResult[];
  failures: FailureEntry[];
}

// Sentinel error thrown when the global timeout fires
class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Simulation timed out after ${ms / 1000}s`);
    this.name = 'TimeoutError';
  }
}

export async function runFullSimulation(
  agentPrompt: string,
  onProgress: ProgressCallback,
): Promise<SimulationResult> {
  const { numTestCases, timeoutMs } = config.simulation;

  // Shared cancellation flag — set when timeout fires
  let timedOut = false;
  const timeoutHandle = setTimeout(() => { timedOut = true; }, timeoutMs);

  const testCases: TestCase[] = [];
  const results: EvaluationResult[] = [];
  const failures: FailureEntry[] = [];

  try {
    // Step 1: Generate test cases
    onProgress({ type: 'status', message: 'Generating test cases...' });
    const generated = await generateTestCases(agentPrompt, numTestCases);
    testCases.push(...generated);
    onProgress({ type: 'status', message: `Generated ${testCases.length} test cases` });

    // Step 2: Run each test case — stop early if global timeout fired
    for (let i = 0; i < testCases.length; i++) {
      if (timedOut) break;

      const testCase = testCases[i];
      onProgress({ type: 'testcase_start', index: i, testCase });

      const history: ConversationTurn[] = [];
      const transcript: ConversationTurn[] = [];

      // Per-case timeout — marks case as incomplete if it runs too long
      let caseTimedOut = false;
      const caseTimeoutHandle = setTimeout(
        () => { caseTimedOut = true; },
        config.simulation.perCaseTimeoutMs,
      );

      try {
        // Run turns until natural end, safety cap, or timeout
        for (let turn = 0; turn < config.simulation.maxTurnsPerCase; turn++) {
          if (timedOut || caseTimedOut) break;

          // User turn (Chain 2)
          const userMessage = await simulateUserTurn(testCase.scenario, history);
          const userTurn: ConversationTurn = { role: 'user', content: userMessage };
          history.push(userTurn);
          transcript.push(userTurn);
          onProgress({ type: 'turn', caseIndex: i, role: 'user', content: userMessage });

          if (timedOut || caseTimedOut) break;

          // Agent turn (Chain 3) — returns content + isConversationEnd signal
          const agentResult: AgentTurnResult = await simulateAgentTurn(agentPrompt, history);
          const agentTurn: ConversationTurn = { role: 'assistant', content: agentResult.content };
          history.push(agentTurn);
          transcript.push(agentTurn);
          onProgress({ type: 'turn', caseIndex: i, role: 'assistant', content: agentResult.content });

          // Natural conversation end detected
          if (agentResult.isConversationEnd) {
            onProgress({ type: 'status', message: `Test case ${i + 1}: conversation concluded naturally after ${turn + 1} turns` });
            break;
          }
        }
      } finally {
        clearTimeout(caseTimeoutHandle);
      }

      // If global timeout fired, stop everything
      if (timedOut) break;

      // If per-case timeout fired but we have some transcript, still evaluate it
      if (caseTimedOut) {
        onProgress({ type: 'status', message: `Test case ${i + 1} timed out — evaluating partial transcript` });
      }

      // Nothing to evaluate if transcript is empty
      if (transcript.length === 0) {
        onProgress({ type: 'status', message: `Test case ${i + 1} produced no transcript — skipping` });
        continue;
      }

      onProgress({ type: 'status', message: `Evaluating test case ${i + 1}/${testCases.length}...` });
      const evaluation = await evaluateTranscript(transcript, testCase.kpis, testCase.scenario);
      results.push(evaluation);
      onProgress({ type: 'evaluated', index: i, evaluation });

      // Collect failures
      for (const kpiResult of evaluation.kpiResults) {
        if (kpiResult.result === 'fail') {
          failures.push({
            scenario: testCase.scenario,
            kpi: kpiResult.kpi,
            reasoning: kpiResult.reasoning,
          });
        }
      }
    }

    onProgress({
      type: 'complete',
      testCases,
      results,
      failures,
      timedOut,
      completedCount: results.length,
    });

    return { testCases, results, failures };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown simulation error';
    onProgress({ type: 'error', message });
    throw err;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export async function generateOptimizedPrompt(
  originalPrompt: string,
  failures: FailureEntry[],
): Promise<string> {
  return optimizePrompt(originalPrompt, failures);
}
