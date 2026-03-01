import { config } from '../config';
import { logger } from '../logger';
import {
  TestCase,
  ConversationTurn,
  EvaluationResult,
  FailureEntry,
  PassEntry,
  PreviousAttempt,
  AgentTurnResult,
  generateTestCases,
  simulateUserTurn,
  simulateAgentTurn,
  evaluateTranscript,
  optimizePrompt,
} from './promptChains';

// ---------------------------------------------------------------------------
// SSE event types
// ---------------------------------------------------------------------------

export type SimulationProgressEvent =
  | { type: 'status'; message: string }
  | { type: 'phase_change'; phase: 'fix'; attempt: number; total: number }
  | { type: 'testcase_start'; index: number; testCase: TestCase }
  | { type: 'turn'; caseIndex: number; role: 'user' | 'assistant'; content: string }
  | { type: 'evaluated'; index: number; evaluation: EvaluationResult }
  | { type: 'optimize_start'; attempt: number }
  | { type: 'optimize_complete'; optimizedPrompt: string; attempt: number }
  | { type: 'push_start' }
  | { type: 'push_complete'; success: boolean }
  | { type: 'complete'; testCases: TestCase[]; results: EvaluationResult[]; failures: FailureEntry[]; timedOut: boolean; completedCount: number; currentPrompt: string }
  | { type: 'error'; message: string };

export type ProgressCallback = (event: SimulationProgressEvent) => void;

export interface SimulationResult {
  testCases: TestCase[];
  results: EvaluationResult[];
  failures: FailureEntry[];
}

// Stored caller messages per failing case — used for deterministic re-runs
interface CaseReplay {
  testCase: TestCase;
  originalIndex: number;
  callerMessages: string[]; // the exact user messages from the original run
}

// Collect passing KPIs from current results to pass to optimizer
function collectPasses(testCases: TestCase[], results: EvaluationResult[]): PassEntry[] {
  const passes: PassEntry[] = [];
  testCases.forEach((tc, i) => {
    const result = results[i];
    if (result) {
      for (const kpi of result.kpiResults) {
        if (kpi.result === 'pass') {
          passes.push({ scenario: tc.scenario, kpi: kpi.kpi });
        }
      }
    }
  });
  return passes;
}

// ---------------------------------------------------------------------------
// Run initial test cases — simulates caller fresh, stores caller messages
// ---------------------------------------------------------------------------

export async function runTestCases(
  agentPrompt: string,
  testCases: TestCase[],
  onProgress: ProgressCallback,
  indices?: number[],
): Promise<SimulationResult & { replays: CaseReplay[] }> {
  const results: EvaluationResult[] = [];
  const failures: FailureEntry[] = [];
  const replays: CaseReplay[] = [];

  let timedOut = false;
  const timeoutHandle = setTimeout(() => { timedOut = true; }, config.simulation.timeoutMs);

  try {
    for (let i = 0; i < testCases.length; i++) {
      if (timedOut) break;

      const testCase = testCases[i];
      const displayIndex = indices ? indices[i] : i;
      onProgress({ type: 'testcase_start', index: displayIndex, testCase });

      const history: ConversationTurn[] = [];
      const transcript: ConversationTurn[] = [];
      const callerMessages: string[] = [];

      let caseTimedOut = false;
      const caseTimeoutHandle = setTimeout(() => { caseTimedOut = true; }, config.simulation.perCaseTimeoutMs);

      try {
        for (let turn = 0; turn < config.simulation.maxTurnsPerCase; turn++) {
          if (timedOut || caseTimedOut) break;

          const userMessage = await simulateUserTurn(testCase.scenario, history);
          callerMessages.push(userMessage);
          const userTurn: ConversationTurn = { role: 'user', content: userMessage };
          history.push(userTurn);
          transcript.push(userTurn);
          onProgress({ type: 'turn', caseIndex: displayIndex, role: 'user', content: userMessage });

          if (timedOut || caseTimedOut) break;

          const agentResult: AgentTurnResult = await simulateAgentTurn(agentPrompt, history);
          const agentTurn: ConversationTurn = { role: 'assistant', content: agentResult.content };
          history.push(agentTurn);
          transcript.push(agentTurn);
          onProgress({ type: 'turn', caseIndex: displayIndex, role: 'assistant', content: agentResult.content });

          if (agentResult.isConversationEnd) break;
        }
      } finally {
        clearTimeout(caseTimeoutHandle);
      }

      if (timedOut) break;
      if (transcript.length === 0) continue;

      onProgress({ type: 'status', message: `Evaluating case ${displayIndex + 1}...` });
      const evaluation = await evaluateTranscript(transcript, testCase.kpis, testCase.scenario);
      results.push(evaluation);
      onProgress({ type: 'evaluated', index: displayIndex, evaluation });

      replays.push({ testCase, originalIndex: displayIndex, callerMessages });

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
  } finally {
    clearTimeout(timeoutHandle);
  }

  return { testCases, results, failures, replays };
}

// ---------------------------------------------------------------------------
// Re-run failing cases replaying the EXACT same caller messages
// ---------------------------------------------------------------------------

async function rerunWithReplay(
  agentPrompt: string,
  failingReplays: CaseReplay[],
  onProgress: ProgressCallback,
): Promise<{ results: EvaluationResult[]; failures: FailureEntry[] }> {
  const results: EvaluationResult[] = [];
  const failures: FailureEntry[] = [];

  for (const replay of failingReplays) {
    const { testCase, originalIndex, callerMessages } = replay;
    onProgress({ type: 'testcase_start', index: originalIndex, testCase });

    const history: ConversationTurn[] = [];
    const transcript: ConversationTurn[] = [];

    for (let turn = 0; turn < callerMessages.length; turn++) {
      // Replay the exact same caller message
      const userMessage = callerMessages[turn];
      const userTurn: ConversationTurn = { role: 'user', content: userMessage };
      history.push(userTurn);
      transcript.push(userTurn);
      onProgress({ type: 'turn', caseIndex: originalIndex, role: 'user', content: userMessage });

      // Get agent response with new prompt
      const agentResult: AgentTurnResult = await simulateAgentTurn(agentPrompt, history);
      const agentTurn: ConversationTurn = { role: 'assistant', content: agentResult.content };
      history.push(agentTurn);
      transcript.push(agentTurn);
      onProgress({ type: 'turn', caseIndex: originalIndex, role: 'assistant', content: agentResult.content });

      if (agentResult.isConversationEnd) break;
    }

    onProgress({ type: 'status', message: `Evaluating case ${originalIndex + 1}...` });
    const evaluation = await evaluateTranscript(transcript, testCase.kpis, testCase.scenario);
    results.push(evaluation);
    onProgress({ type: 'evaluated', index: originalIndex, evaluation });

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

  return { results, failures };
}

// ---------------------------------------------------------------------------
// Full flywheel
// ---------------------------------------------------------------------------

export async function runFlywheel(
  _agentId: string,
  initialPrompt: string,
  onProgress: ProgressCallback,
  pushPrompt: (prompt: string) => Promise<void>,
): Promise<void> {
  const { numTestCases, maxOptimizeAttempts } = config.simulation;
  let currentPrompt = initialPrompt;

  // ---- Initial run ----
  onProgress({ type: 'status', message: 'Generating test cases...' });
  const initialCases = await generateTestCases(currentPrompt, numTestCases);

  onProgress({ type: 'phase_change', phase: 'fix', attempt: 1, total: maxOptimizeAttempts });
  const initialIndices = initialCases.map((_, i) => i);
  const initialRun = await runTestCases(currentPrompt, initialCases, onProgress, initialIndices);

  const allTestCases = [...initialCases];
  const allResults = [...initialRun.results];

  logger.info(`Initial run done — results: ${initialRun.results.length}, failures: ${initialRun.failures.length}`);

  // All passed — already optimized
  if (initialRun.failures.length === 0) {
    onProgress({ type: 'status', message: '✅ All test cases passed — prompt is already optimized!' });
    onProgress({
      type: 'complete',
      testCases: allTestCases,
      results: allResults,
      failures: [],
      timedOut: false,
      completedCount: allResults.length,
      currentPrompt,
    });
    return;
  }

  // Build replays for failing cases
  let failingReplays = initialRun.replays.filter((_, i) => initialRun.results[i]?.overall === 'fail');
  let failures = initialRun.failures;

  // Track best prompt = fewest failures so far (so we never push something worse)
  let bestPrompt = currentPrompt;
  let bestFailureCount = failures.length;
  let everPassed = false;
  const previousAttempts: PreviousAttempt[] = [];

  // ---- Fix loop: optimize → re-run with same caller messages → push only if passing ----
  for (let attempt = 1; attempt <= maxOptimizeAttempts && failures.length > 0; attempt++) {
    logger.info(`Fix loop attempt ${attempt}/${maxOptimizeAttempts} — ${failures.length} failures`);

    onProgress({ type: 'optimize_start', attempt });
    const passes = collectPasses(allTestCases, allResults);
    try {
      currentPrompt = await optimizePrompt(currentPrompt, failures, passes, previousAttempts);
    } catch (err) {
      logger.error(`optimizePrompt failed on attempt ${attempt}`, { error: err instanceof Error ? err.stack : err });
      break;
    }
    onProgress({ type: 'optimize_complete', optimizedPrompt: currentPrompt, attempt });

    // Re-run with the EXACT same caller messages — fair comparison
    onProgress({ type: 'phase_change', phase: 'fix', attempt: Math.min(attempt + 1, maxOptimizeAttempts), total: maxOptimizeAttempts });
    onProgress({ type: 'status', message: `Re-running ${failingReplays.length} failing case(s) with optimized prompt...` });

    const retryRun = await rerunWithReplay(currentPrompt, failingReplays, onProgress);

    // Merge results back
    failingReplays.forEach((replay, ri) => {
      const idx = allTestCases.indexOf(replay.testCase);
      if (idx !== -1 && retryRun.results[ri]) {
        allResults[idx] = retryRun.results[ri];
      }
    });

    failures = retryRun.failures;

    // Track best prompt — only update if this attempt improved things
    if (failures.length < bestFailureCount) {
      bestPrompt = currentPrompt;
      bestFailureCount = failures.length;
    }

    if (failures.length === 0) {
      everPassed = true;
      // All passing — push now
      onProgress({ type: 'status', message: '✅ All test cases pass — pushing optimized prompt to HighLevel...' });
      onProgress({ type: 'push_start' });
      try {
        await pushPrompt(currentPrompt);
        onProgress({ type: 'push_complete', success: true });
        onProgress({ type: 'status', message: '✅ Optimized prompt pushed to HighLevel!' });
      } catch (err) {
        logger.error(`pushPrompt failed`, { error: err instanceof Error ? err.stack : err });
        onProgress({ type: 'push_complete', success: false });
      }
      break;
    } else {
      onProgress({ type: 'status', message: `${failures.length} case(s) still failing after attempt ${attempt}.` });
      // Record this attempt so the next optimizer knows what was tried and still failed
      previousAttempts.push({ prompt: currentPrompt, failures });
      // Update failing replays to only those still failing
      failingReplays = failingReplays.filter((_, ri) => retryRun.results[ri]?.overall === 'fail');
    }
  }

  // If never fully passed — only push if we made some improvement over the original
  if (!everPassed) {
    if (bestFailureCount < initialRun.failures.length) {
      onProgress({ type: 'status', message: `Partially improved (${initialRun.failures.length} → ${bestFailureCount} failures) — pushing best prompt.` });
      onProgress({ type: 'push_start' });
      try {
        await pushPrompt(bestPrompt);
        onProgress({ type: 'push_complete', success: true });
      } catch (err) {
        logger.error(`pushPrompt failed (best effort)`, { error: err instanceof Error ? err.stack : err });
        onProgress({ type: 'push_complete', success: false });
      }
    } else {
      onProgress({ type: 'status', message: `Optimization did not improve results — keeping original prompt in HighLevel.` });
    }
  }

  // Collect final failures
  const finalFailures: FailureEntry[] = [];
  allTestCases.forEach((tc, i) => {
    const result = allResults[i];
    if (result) {
      for (const kpi of result.kpiResults) {
        if (kpi.result === 'fail') {
          finalFailures.push({ scenario: tc.scenario, kpi: kpi.kpi, reasoning: kpi.reasoning });
        }
      }
    }
  });

  onProgress({
    type: 'complete',
    testCases: allTestCases,
    results: allResults,
    failures: finalFailures,
    timedOut: false,
    completedCount: allResults.length,
    currentPrompt,
  });
}

// ---------------------------------------------------------------------------
// Legacy — kept for backward compat, used by old /api/simulate
// ---------------------------------------------------------------------------

export async function runFullSimulation(
  agentPrompt: string,
  onProgress: ProgressCallback,
): Promise<SimulationResult> {
  const { numTestCases } = config.simulation;
  onProgress({ type: 'status', message: 'Generating test cases...' });
  const testCases = await generateTestCases(agentPrompt, numTestCases);
  onProgress({ type: 'status', message: `Generated ${testCases.length} test cases` });
  const result = await runTestCases(agentPrompt, testCases, onProgress, testCases.map((_, i) => i));
  return { testCases: result.testCases, results: result.results, failures: result.failures };
}

export async function generateOptimizedPrompt(
  originalPrompt: string,
  failures: FailureEntry[],
): Promise<string> {
  return optimizePrompt(originalPrompt, failures);
}
