import { config } from '../config';
import {
  TestCase,
  ConversationTurn,
  EvaluationResult,
  FailureEntry,
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
  | { type: 'complete'; testCases: TestCase[]; results: EvaluationResult[]; failures: FailureEntry[] }
  | { type: 'error'; message: string };

export type ProgressCallback = (event: SimulationProgressEvent) => void;

export interface SimulationResult {
  testCases: TestCase[];
  results: EvaluationResult[];
  failures: FailureEntry[];
}

async function runSimulationCore(
  agentPrompt: string,
  onProgress: ProgressCallback,
): Promise<SimulationResult> {
  const { conversationTurns, numTestCases } = config.simulation;

  // Step 1: Generate test cases
  onProgress({ type: 'status', message: 'Generating test cases...' });
  const testCases = await generateTestCases(agentPrompt, numTestCases);
  onProgress({ type: 'status', message: `Generated ${testCases.length} test cases` });

  const results: EvaluationResult[] = [];
  const failures: FailureEntry[] = [];

  // Step 2: Run each test case
  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    onProgress({ type: 'testcase_start', index: i, testCase });

    const history: ConversationTurn[] = [];
    const transcript: ConversationTurn[] = [];

    // Run conversation turns
    for (let turn = 0; turn < conversationTurns; turn++) {
      // User turn (Chain 2)
      const userMessage = await simulateUserTurn(testCase.scenario, history);
      const userTurn: ConversationTurn = { role: 'user', content: userMessage };
      history.push(userTurn);
      transcript.push(userTurn);
      onProgress({ type: 'turn', caseIndex: i, role: 'user', content: userMessage });

      // Agent turn (Chain 3)
      const agentResponse = await simulateAgentTurn(agentPrompt, history);
      const agentTurn: ConversationTurn = { role: 'assistant', content: agentResponse };
      history.push(agentTurn);
      transcript.push(agentTurn);
      onProgress({ type: 'turn', caseIndex: i, role: 'assistant', content: agentResponse });
    }

    // Evaluate transcript (Chain 4)
    onProgress({ type: 'status', message: `Evaluating test case ${i + 1}/${testCases.length}...` });
    const evaluation = await evaluateTranscript(transcript, testCase.kpis, testCase.scenario);
    results.push(evaluation);
    onProgress({ type: 'evaluated', index: i, evaluation });

    // Collect failures for optimization
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

  return { testCases, results, failures };
}

export async function runFullSimulation(
  agentPrompt: string,
  onProgress: ProgressCallback,
): Promise<SimulationResult> {
  const timeoutMs = config.simulation.timeoutMs;

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Simulation timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([
      runSimulationCore(agentPrompt, onProgress),
      timeoutPromise,
    ]);

    onProgress({
      type: 'complete',
      testCases: result.testCases,
      results: result.results,
      failures: result.failures,
    });

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown simulation error';
    onProgress({ type: 'error', message });
    throw err;
  }
}

export async function generateOptimizedPrompt(
  originalPrompt: string,
  failures: FailureEntry[],
): Promise<string> {
  return optimizePrompt(originalPrompt, failures);
}
