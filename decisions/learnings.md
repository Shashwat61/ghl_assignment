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
