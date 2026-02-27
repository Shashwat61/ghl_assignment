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

## 2026-02-26 Decision: TypeScript for Backend
**Context:** User requested TypeScript with Express for the backend.
**Decision:** Use TypeScript with Express, compiled via ts-node for dev and tsc for production.
**Tradeoff/Reasoning:** Type safety improves reliability; better IDE support; minor added build complexity offset by developer experience gains.
**Impact:** All server files use `.ts` extension; added `typescript`, `ts-node`, `@types/*` packages; `tsconfig.json` added to project root.
