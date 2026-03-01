import { config } from '../config';
import { logger } from '../logger';
import {
  TestCase,
  ConversationTurn,
  EvaluationResult,
  FailureEntry,
  PassEntry,
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
  | { type: 'phase_change'; phase: 'fix' | 'harden'; attempt: number; total: number }
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
// Run a fixed set of test cases against a prompt (no generation)
// ---------------------------------------------------------------------------

export async function runTestCases(
  agentPrompt: string,
  testCases: TestCase[],
  onProgress: ProgressCallback,
  indexOffset = 0,
): Promise<SimulationResult> {
  const results: EvaluationResult[] = [];
  const failures: FailureEntry[] = [];

  let timedOut = false;
  const timeoutHandle = setTimeout(() => { timedOut = true; }, config.simulation.timeoutMs);

  try {
    for (let i = 0; i < testCases.length; i++) {
      if (timedOut) break;

      const testCase = testCases[i];
      const displayIndex = indexOffset + i;
      onProgress({ type: 'testcase_start', index: displayIndex, testCase });

      const history: ConversationTurn[] = [];
      const transcript: ConversationTurn[] = [];

      let caseTimedOut = false;
      const caseTimeoutHandle = setTimeout(() => { caseTimedOut = true; }, config.simulation.perCaseTimeoutMs);

      try {
        for (let turn = 0; turn < config.simulation.maxTurnsPerCase; turn++) {
          if (timedOut || caseTimedOut) break;

          const userMessage = await simulateUserTurn(testCase.scenario, history);
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

  return { testCases, results, failures };
}

// ---------------------------------------------------------------------------
// Full flywheel — Phase 1 (fix) + Phase 2 (harden)
// ---------------------------------------------------------------------------

export async function runFlywheel(
  _agentId: string,
  initialPrompt: string,
  onProgress: ProgressCallback,
  pushPrompt: (prompt: string) => Promise<void>,
): Promise<void> {
  const { numTestCases, maxOptimizeAttempts, maxHardenBatches } = config.simulation;
  let currentPrompt = initialPrompt;
  let allTestCases: TestCase[] = [];
  let allResults: EvaluationResult[] = [];

  // ---- Phase 1: Fix loop ----
  onProgress({ type: 'status', message: 'Phase 1: Generating initial test cases...' });
  const initialCases = await generateTestCases(currentPrompt, numTestCases);
  allTestCases = [...initialCases];

  onProgress({ type: 'phase_change', phase: 'fix', attempt: 1, total: maxOptimizeAttempts });
  let { results, failures } = await runTestCases(currentPrompt, initialCases, onProgress, 0);
  allResults = [...results];

  // Fix loop — re-run only the failing test cases after each optimize
  let failingCases = initialCases.filter((_, i) => results[i]?.overall === 'fail');
  logger.info(`Phase 1 initial run done — results: ${results.length}, failures: ${failures.length}, failingCases: ${failingCases.length}`);

  // If all test cases pass on the first run, prompt is already optimized — skip flywheel
  if (failures.length === 0) {
    onProgress({ type: 'status', message: 'All test cases passed — prompt is already optimized!' });
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

  for (let attempt = 1; attempt <= maxOptimizeAttempts && failures.length > 0; attempt++) {
    logger.info(`Fix loop attempt ${attempt}/${maxOptimizeAttempts} — ${failures.length} failures`);

    onProgress({ type: 'optimize_start', attempt });
    logger.debug(`Optimizing prompt (attempt ${attempt}):\n` + currentPrompt);
    const passes = collectPasses(allTestCases, allResults);
    try {
      currentPrompt = await optimizePrompt(currentPrompt, failures, passes);
    } catch (err) {
      logger.error(`optimizePrompt failed on attempt ${attempt}`, { error: err instanceof Error ? err.stack : err });
      break;
    }
    logger.debug(`Optimized prompt (attempt ${attempt}):\n` + currentPrompt);
    onProgress({ type: 'optimize_complete', optimizedPrompt: currentPrompt, attempt });

    onProgress({ type: 'push_start' });
    try {
      await pushPrompt(currentPrompt);
      onProgress({ type: 'push_complete', success: true });
    } catch (err) {
      logger.error(`pushPrompt failed on attempt ${attempt}`, { error: err instanceof Error ? err.stack : err });
      onProgress({ type: 'push_complete', success: false });
    }

    if (failingCases.length === 0) break;

    onProgress({ type: 'phase_change', phase: 'fix', attempt: Math.min(attempt + 1, maxOptimizeAttempts), total: maxOptimizeAttempts });
    onProgress({ type: 'status', message: `Re-running ${failingCases.length} previously failing case(s)...` });

    // Re-run only the failing cases, mapped back to their original indices
    const retryOffset = allTestCases.indexOf(failingCases[0]);
    const retryResult = await runTestCases(currentPrompt, failingCases, onProgress, retryOffset);

    // Merge retry results back into allResults at the correct indices
    failingCases.forEach((tc, ri) => {
      const idx = allTestCases.indexOf(tc);
      if (idx !== -1 && retryResult.results[ri]) {
        allResults[idx] = retryResult.results[ri];
      }
    });

    failures = retryResult.failures;
    failingCases = failingCases.filter((_, ri) => retryResult.results[ri]?.overall === 'fail');

    if (failures.length === 0) {
      onProgress({ type: 'status', message: `All previously failing cases now pass after attempt ${attempt}!` });
    }
  }

  if (failures.length > 0) {
    onProgress({ type: 'status', message: `Fix loop exhausted (${maxOptimizeAttempts} attempts) — ${failures.length} case(s) still failing. Moving on with best prompt so far.` });
  }

  // ---- Phase 2: Harden loop ----
  if (failures.length === 0) {
    for (let batch = 1; batch <= maxHardenBatches; batch++) {
      onProgress({ type: 'phase_change', phase: 'harden', attempt: batch, total: maxHardenBatches });
      onProgress({ type: 'status', message: `Phase 2 batch ${batch}/${maxHardenBatches}: Generating new test cases...` });

      const newCases = await generateTestCases(currentPrompt, numTestCases);
      const offset = allTestCases.length;
      allTestCases = [...allTestCases, ...newCases];

      const hardenResult = await runTestCases(currentPrompt, newCases, onProgress, offset);
      allResults = [...allResults, ...hardenResult.results];

      if (hardenResult.failures.length > 0) {
        // New failures found — go back into fix loop
        onProgress({ type: 'status', message: `New failures found in harden batch ${batch} — re-entering fix loop` });
        failures = hardenResult.failures;
        failingCases = newCases.filter((_, i) => hardenResult.results[i]?.overall === 'fail');

        for (let attempt = 1; attempt <= maxOptimizeAttempts && failures.length > 0; attempt++) {
          onProgress({ type: 'optimize_start', attempt });
          const hardenPasses = collectPasses(allTestCases, allResults);
          try {
            currentPrompt = await optimizePrompt(currentPrompt, failures, hardenPasses);
          } catch (err) {
            logger.error(`optimizePrompt failed (harden batch, attempt ${attempt})`, { error: err instanceof Error ? err.stack : err });
            break;
          }
          onProgress({ type: 'optimize_complete', optimizedPrompt: currentPrompt, attempt });
          onProgress({ type: 'push_start' });
          try {
            await pushPrompt(currentPrompt);
            onProgress({ type: 'push_complete', success: true });
          } catch (err) {
            logger.error(`pushPrompt failed (harden batch, attempt ${attempt})`, { error: err instanceof Error ? err.stack : err });
            onProgress({ type: 'push_complete', success: false });
          }

          const retryOffset = allTestCases.indexOf(failingCases[0]);
          const retryResult = await runTestCases(currentPrompt, failingCases, onProgress, retryOffset);

          failingCases.forEach((tc, ri) => {
            const idx = allTestCases.indexOf(tc);
            if (idx !== -1 && retryResult.results[ri]) {
              allResults[idx] = retryResult.results[ri];
            }
          });

          failures = retryResult.failures;
          failingCases = failingCases.filter((_, ri) => retryResult.results[ri]?.overall === 'fail');
        }

        if (failures.length > 0) break; // gave up fixing, stop hardening
      } else {
        onProgress({ type: 'status', message: `Harden batch ${batch} passed — prompt is solid` });
      }
    }
  }

  // Collect final failures across all results
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
  return runTestCases(agentPrompt, testCases, onProgress, 0);
}

export async function generateOptimizedPrompt(
  originalPrompt: string,
  failures: FailureEntry[],
): Promise<string> {
  return optimizePrompt(originalPrompt, failures);
}
