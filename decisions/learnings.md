# Decisions & Learnings

## 2026-02-26 Decision: Auto-push vs User-Confirm
**Context:** After optimization, should the user review and confirm before pushing the new prompt to HighLevel?
**Decision:** Auto-push after optimize — no confirm step. ResultView shows diff of what was already pushed.
**Tradeoff/Reasoning:** Faster UX for demo; reduces friction in the validation flywheel loop. Risk: accidental pushes, but mitigated by the visible diff in ResultView.
**Impact:** `POST /api/optimize` calls `hlClient.updateAgent()` immediately; no `/api/confirm` route; ResultView.vue shows diff + "Pushed ✓" notice.

---

## 2026-02-26 Decision: SSE vs WebSocket for Simulation Streaming
**Context:** Simulation runs take 60+ seconds and emit incremental progress (test cases, turns, KPI results).
**Decision:** Server-Sent Events (SSE) via `GET /api/simulate`.
**Tradeoff/Reasoning:** SSE is unidirectional (server→client), simpler to implement, no socket management, native browser EventSource reconnects automatically. WebSockets add bidirectional complexity not needed here.
**Impact:** `simulation.js` sets `Content-Type: text/event-stream`; 15s heartbeat keeps connection alive; EventSource in Dashboard.vue.

---

## 2026-02-26 Decision: In-Memory Store vs Database
**Context:** Need to persist OAuth tokens (accessToken, refreshToken, expiresAt, locationId) between requests.
**Decision:** In-memory Map (`sessionStore.js`) — no database.
**Tradeoff/Reasoning:** Single-user demo tool; no need for persistence across server restarts; zero infrastructure complexity. Risk: tokens lost on server restart, but acceptable for demo.
**Impact:** `server/services/sessionStore.js`; Railway/Render deployments may restart containers periodically — user must re-auth.

---

## 2026-02-26 Decision: Hosting Approach — Widget vs Standalone
**Context:** Should the app be embedded into HighLevel UI or run as a standalone app?
**Decision:** Vue app embedded into HL UI via Custom JS module (widget approach), but also deployable as standalone app (Vercel frontend + Railway/Render backend).
**Tradeoff/Reasoning:** Widget embedding via HL Custom JS gives native HL UX. Standalone URL needed for OAuth redirect_uri. Both modes supported.
**Impact:** Vite builds to `/public`; Express serves static files; HL Custom JS snippet loads the hosted URL.

---

## 2026-02-26 Decision: Simulation Timeout Strategy
**Context:** Each simulation run involves multiple Claude API calls (5 test cases × 6 turns × 2 chains + eval), which can exceed 120s.
**Decision:** Wrap entire `runFullSimulation` in `Promise.race` with a 120s timeout (configurable via `SIMULATION_TIMEOUT_MS` env var).
**Tradeoff/Reasoning:** Prevents hanging connections; SSE `error` event emitted on timeout so client shows partial results gracefully. Env var allows fast-demo mode with fewer turns.
**Impact:** `simulationEngine.js` uses `Promise.race`; `CONVERSATION_TURNS` and `NUM_TEST_CASES` are env-configurable.

---

## 2026-02-27 Decision: Graceful Partial Completion on Simulation Timeout

**Context:** The simulation runs up to 65 sequential Claude API calls (5 cases × 6 turns × 2 chains + 5 evaluations). With a 120s timeout, it's possible the timeout fires mid-run — either mid-conversation or between test cases.

**Decision:** Replace the blunt `Promise.race` timeout (which killed everything and returned nothing) with a cooperative cancellation flag (`timedOut` boolean set by `setTimeout`). After each async call, the engine checks the flag and exits the loop early if set. Only fully completed test cases are evaluated and included in results.

**KPI standpoint:** Timed-out cases are excluded from results entirely — not marked pass or fail. Pass rate is calculated only over completed cases. Marking incomplete cases as failures would be misleading since the agent never got a chance to respond.

**User experience:** A yellow warning banner shows: "Simulation timed out — showing results for X of N test cases." The Optimize button still appears if there are failures in the completed cases — partial results are still actionable.

**Tradeoff:** If timeout fires mid-conversation-turn (while awaiting a Claude response), the current turn completes before the flag is checked — so the actual cutoff may be slightly after the timeout boundary. This is acceptable; hard-killing a Claude API call mid-response would leave partial data.

**Impact:** `simulationEngine.ts` — removed `runSimulationCore`, rewrote `runFullSimulation` with cooperative flag. `complete` SSE event now includes `timedOut: boolean` and `completedCount: number`. Store adds `simulationTimedOut` + `simulationCompletedCount`. Dashboard shows yellow warning banner on timeout.

---

## 2026-02-27 Decision: Remove CONVERSATION_TURNS — Natural Conversation Ending Instead

**Context:** The simulation was capping conversations at a fixed `CONVERSATION_TURNS` count (default 6). This caused two problems: (1) conversations got cut off mid-way before the agent could collect all info or wrap up, causing KPIs like "must confirm details" or "must say goodbye" to fail unfairly; (2) the turn count was an arbitrary param that didn't reflect how real conversations work.

**Decision:** Remove `CONVERSATION_TURNS` entirely. Conversations now run turn-by-turn until one of three exit conditions:
1. Agent produces a natural conversation-ending response (detected via phrase matching)
2. Per-conversation timeout fires (`PER_CASE_TIMEOUT_MS`, default 25s) — case skipped, not evaluated
3. Safety max-turns cap (`MAX_TURNS_PER_CASE`, default 15) hit — evaluates what it has

**Why this is better:** Short scenarios finish in 3-4 turns naturally. Complex scenarios get the turns they need. KPI evaluation is always on complete transcripts — no more unfair failures from premature cutoff. Global 120s timeout remains the outer safety net.

**Tradeoff:** Slightly less predictable runtime since conversation length varies. Mitigated by per-case timeout and max-turns cap.

**Impact:** Removed `CONVERSATION_TURNS` from `.env` and `config.ts`. Added `MAX_TURNS_PER_CASE` and `PER_CASE_TIMEOUT_MS` env vars. Chain 3 (`simulateAgentTurn`) now returns `{ content, isConversationEnd }` instead of a plain string. `simulationEngine.ts` inner loop exits on natural end signal, per-case timeout, or safety cap.

---

## 2026-02-26 Decision: TypeScript for Backend
**Context:** User requested TypeScript with Express for the backend.
**Decision:** Use TypeScript with Express, compiled via ts-node for dev and tsc for production.
**Tradeoff/Reasoning:** Type safety improves reliability; better IDE support; minor added build complexity offset by developer experience gains.
**Impact:** All server files use `.ts` extension; added `typescript`, `ts-node`, `@types/*` packages; `tsconfig.json` added to project root.

---

## 2026-02-28 Decision: Validation Flywheel Architecture (Phase 1 Fix + Phase 2 Harden)

**Context:** The original flow was one-shot: generate test cases → run → show failures → manual "Optimize Prompt" button. This was inefficient: the user had to manually trigger optimization, and re-run would generate entirely new test cases (not re-validate the original failing ones).

**Decision:** Replace the manual optimize button with a full automated flywheel driven by a single `/api/flywheel` SSE endpoint:
- **Phase 1 (Fix Loop):** Generate test cases once → run → if failures → optimize prompt → push to HL → re-run ONLY the previously failing cases → repeat up to `MAX_OPTIMIZE_ATTEMPTS` (default 3)
- **Phase 2 (Harden Loop):** Once all original failures fixed → generate fresh test cases → run → if new failures found → re-enter inner fix loop → else mark as "solid" and repeat up to `MAX_HARDEN_BATCHES` (default 3) batches

**Tradeoff/Reasoning:** The fix loop reuses the exact failing test cases (same scenario, same KPIs) so optimization is validated against the same benchmark — not a different randomly-generated scenario. The harden loop stress-tests with novel scenarios to prevent overfitting to the fix cases. Auto-pushing each optimized prompt means HL agent is always in sync.

**Impact:**
- `server/services/simulationEngine.ts` — new `runTestCases()` (no generation, takes existing cases) + `runFlywheel()` (full Phase 1 + Phase 2 orchestration); `runFullSimulation` kept for backward compat
- `server/routes/simulation.ts` — new `GET /api/flywheel` SSE endpoint
- `server/config.ts` — added `MAX_OPTIMIZE_ATTEMPTS` (default 3) and `MAX_HARDEN_BATCHES` (default 3) env vars
- `frontend/src/stores/copilot.js` — added `flywheelPhase`, `flywheelAttempt`, `flywheelTotal` state; handles `phase_change`, `optimize_start`, `optimize_complete` SSE events; prompt history entries auto-created on each `optimize_complete`
- `frontend/src/views/Dashboard.vue` — connects to `/api/flywheel`; running indicator shows phase/attempt; manual "Optimize Prompt" button removed

---

## 2026-02-28 Decision: Winston Logger + API Middleware Error Handling

**Context:** Backend was using `console.log` with no structured output, no log levels, and no request tracing. Errors in optimize/simulate endpoints were swallowed without useful context.

**Decision:** Add Winston logger with colored console output and level-based routing. Add `apiMiddleware` that attaches a `requestId` to every API request and logs HTTP responses at appropriate levels (error for 5xx, warn for 4xx, info for 2xx). Add `errorHandler` middleware that logs full stack traces with requestId.

**Impact:**
- `server/logger.ts` — Winston logger with `HH:mm:ss` timestamp, colorize, errors-with-stack format
- `server/middleware/api.ts` — `apiMiddleware` (requestId + res.on('finish') logging) + `errorHandler` global handler
- `LOG_LEVEL` env var controls verbosity (default: `debug`)

---

## 2026-02-28 Fix: HL PATCH /voice-ai/agents API — Correct Method, Headers, and Params

**Context:** The optimize endpoint was returning 422 then 403 errors when trying to update the agent system prompt.

**Root Cause 1 (422):** Was using `axios.put` with the full agent body. The correct method is `PATCH` with only `{ agentPrompt: systemPrompt }`.

**Root Cause 2 (403 "LocationId is required"):** Was sending `locationId` in the request body. The API requires `locationId` as a **query parameter**, not in the body.

**Root Cause 3:** Was sending `Version: '2021-07-28'` header. The correct version is `2021-04-15`.

**Fix:** `server/services/hlClient.ts` — `updateAgent()` uses `axios.patch`, sends `{ agentPrompt }` as body, `{ locationId }` as `params`, and `Version: '2021-04-15'` header.

**How discovered:** Used Playwright MCP to navigate to the actual GHL API docs page and read the parameter spec.

---

## 2026-02-28 Fix: SSE KPI Panel Always Showing Last Case Results

**Context:** After simulation completed, the KPI panel always showed the last test case's results (often a passing case), making it look like everything passed even when there were failures.

**Root Cause:** `testcase_start` SSE event was auto-advancing `selectedCaseIndex` on every new case, so at simulation end the selection was always at the last case.

**Fix:** Added `userHasSelected` flag in Dashboard.vue. Auto-advance only happens if the user hasn't manually clicked a case. Once user clicks a card, the selection is locked to their choice.

---

## 2026-02-28 Fix: Transcript Auto-Scroll Not Working

**Root Cause:** `ref="messagesEl"` was on the inner `.messages` div which has no fixed height and therefore no scrollable overflow. The actual scrollable container is the outer `.transcript-viewer` div.

**Fix:** Moved `ref="messagesEl"` to the outer `.transcript-viewer` div. Also added a second `watch(() => props.transcript, scrollToBottom)` to trigger scroll when switching between cases.
