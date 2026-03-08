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

## 2026-03-01 Fix: Over-specific KPIs Causing False Failures

**Context:** Chain 1 (test case generator) was generating format-based KPIs like "Agent handles pricing question using exact two-sentence out-of-scope structure (standalone acknowledgment sentence naming 'pricing', standalone follow-up promise sentence) without merging them." These caused false failures — the agent responded correctly in spirit but didn't match the exact phrasing format, so Chain 4 (evaluator) marked it as fail.

**Root Cause:** Chain 1 system prompt didn't distinguish between outcome-based and format-based KPIs. Claude defaulted to generating highly specific, prescriptive KPIs that were testing prompt wording rather than agent behavior.

**Fix:** Added explicit KPI rules to Chain 1 prompt: KPIs must be OUTCOME-based not FORMAT-based. Added BAD/GOOD examples to guide the model away from format requirements.

**Impact:** `server/services/promptChains.ts` — Chain 1 user message now includes KPI rules and examples.

---

## 2026-03-01 Fix: Flywheel Skips Optimization When All Tests Pass

**Context:** If the agent's prompt was already well-written, all 5 test cases would pass on the first run. The flywheel would then enter Phase 2 (harden loop) and run more test cases unnecessarily — wasting API credits and time.

**Fix:** Added an early-exit check after Phase 1 initial run: if `failures.length === 0`, emit a "prompt is already optimized" status message, then emit `complete` and return immediately — skipping both the fix loop and the harden loop entirely.

**Impact:** `server/services/simulationEngine.ts` — early return after initial run if no failures.

---

## 2026-03-01 Decision: HL Integration via Marketplace Custom Page (not Custom JS injection)

**Context:** The assignment required integrating the app "into the HighLevel interface using custom js." We attempted DOM injection via Marketplace Custom JS module and Whitelabel Custom JS, but both had issues: Whitelabel rendered code as visible text (CSP blocks execution on app.gohighlevel.com), and Marketplace Custom JS had a CDN caching bug where old compiled files were served even after updating the snippet.

**Decision:** Use the Marketplace **Custom Page** module instead. This adds a native "Voice AI Optimizer" menu item to the sub-account left sidebar that loads the app in an iframe — the proper HL Marketplace integration pattern for embedding full app UIs.

**Why this satisfies the requirement:** The Custom Page module is the HL-native mechanism for placing a custom app UI within the customer (sub-account) interface. It's deployed via the same Marketplace app as the Custom JS module. The PDF's intent was native HL integration — Custom Page achieves this cleanly and is the supported approach for full app embedding.

**How evaluator installs:** Install the Marketplace app via the install link → Voice AI Optimizer appears automatically in the sub-account sidebar. No manual configuration needed.

**Impact:** Marketplace app → Modules → Custom Page configured with Live URL pointing to Railway deployment, placement = Sub-account Left Navigation Menu.

---

## 2026-03-01 Decision: Push-Only-On-Pass + Deterministic Re-runs via Caller Message Replay

**Context:** The original fix loop pushed the optimized prompt to HL immediately after generating it — before re-running the failing test cases. This meant:
1. HL received a new prompt even if it didn't actually fix the failures
2. With `maxOptimizeAttempts=2`, HL was updated twice (once per attempt) regardless of outcome
3. Each re-run simulated a fresh caller conversation — different caller messages each time — making it impossible to know if the optimization actually fixed the specific failure, since the inputs changed

**Decision 1 — Push only after passing:** Optimize prompt → re-run failing cases → if all pass, push to HL. If still failing, repeat up to `MAX_OPTIMIZE_ATTEMPTS`. Only push at the end if tests never pass (best effort). This means HL is updated at most once with a prompt that has been validated to pass.

**Decision 2 — Replay exact caller messages on re-run:** During the initial run, store each caller's messages per test case (`CaseReplay`). On re-run, replay those exact messages in order — only the agent responds with the new prompt. This makes the re-run a true A/B comparison: same inputs, different prompt, see if output improves.

**Why replay matters:** Without it, a re-run might pass just because the simulated caller happened to ask easier questions — not because the optimization worked. Replaying the same inputs isolates the variable to the prompt only.

**Impact:**
- `simulationEngine.ts` — `runTestCases()` now returns `replays[]` (callerMessages per case); new `rerunWithReplay()` function replays exact caller messages; `pushPrompt` moved to after successful re-run
- Loop count unchanged (`maxOptimizeAttempts=2`) — the loop was never running more than 2 times, the issue was push timing not loop count

---

## 2026-03-01 Fix: Re-run Creating New Test Case Slots Instead of Overwriting

**Root Cause:** `runTestCases` used `indexOffset + i` for display indices. When re-running failing cases, `retryOffset = allTestCases.indexOf(failingCases[0])` gave the index of the first failing case. If cases 0 and 1 both failed, offset=0 and re-run correctly emitted indices 0 and 1. But if only case 1 failed, offset=1 and the single re-run emitted index 1 — correct. However when `generateTestCases` returned more cases than `numTestCases` (Claude ignoring "exactly N"), extra cases got appended at wrong indices.

**Fix 1:** Hard-cap `generateTestCases` output with `.slice(0, numCases)`.

**Fix 2:** Replace `indexOffset` with explicit `indices[]` array — each case maps to its exact original index regardless of position in the failingCases array. `retryIndices = failingCases.map(tc => allTestCases.indexOf(tc))`.

---

## 2026-03-01 Fix: Flywheel Counter Showing "3/2" (Beyond Max)

**Root Cause:** `phase_change` was emitted with `attempt + 1` after each re-run, so the last attempt (attempt=2) emitted `{ attempt: 3, total: 2 }`.

**Fix:** Total is now `maxOptimizeAttempts`, re-run emits `Math.min(attempt + 1, maxOptimizeAttempts)`. Initial run shows 1/2, re-run after first optimize shows 2/2. Never exceeds total.

---

## 2026-03-01 Decision: User-Supplied Anthropic API Key (No Env Fallback)

**Context:** The app is deployed on Railway with the author's Anthropic API key. If the reviewer uses the hosted app and the author's credits run out, the app stops working. Additionally, from a UX standpoint the reviewer should use their own key.

**Decision:** Require the user to enter their own `sk-ant-*` key in the frontend before the app runs. Key is stored in session memory on the backend (`sessionStore.setAnthropicApiKey()`). `promptChains.ts` uses the session key exclusively — no fallback to the env var.

**UX:** Blocking card shown on AgentList when no key is set. Once saved, a small "🔑 Custom Key Active" button lets them update it. Key is validated to start with `sk-ant-` before saving.

**Impact:** `server/services/sessionStore.ts` — added `setAnthropicApiKey/getAnthropicApiKey`; `server/services/promptChains.ts` — `getClient()` uses session key only, throws clear error if missing; `server/routes/agents.ts` — `POST/GET /api/settings/anthropic-key`; `frontend/src/views/AgentList.vue` — blocking key entry card.

---

## 2026-03-01 Fix: "Analysing..." Status During KPI Evaluation

**Context:** After the conversation ended, the test case card stayed in "Running" state (purple spinner) during the evaluation step (Chain 4 LLM-as-Judge call), which can take 15-30s. The user had no feedback that the evaluation was in progress — it looked like the simulation was still running conversations.

**Fix:**
- Backend already emits `status: "Evaluating case X..."` before each `evaluateTranscript` call
- Store now parses that message with a regex (`/Evaluating case (\d+)/`) → sets `evaluatingCaseIndex`
- `TestCaseCard` gets a new `isEvaluating` prop → shows an amber spinner + "Analysing..." badge
- `isActive` (purple "Running" badge) is suppressed while `isEvaluating` is true
- `evaluatingCaseIndex` clears on `evaluated` SSE event

**Impact:** `frontend/src/stores/copilot.js` — `evaluatingCaseIndex` state, parsed from `status` events; `frontend/src/components/TestCaseCard.vue` — `isEvaluating` prop + amber badge + `.evaluating-badge` / `.spinner--amber` styles; `Dashboard.vue` — passes `isEvaluating` and suppresses `isActive` during eval.

---

## 2026-03-01 Feature: Prompt Modal + Inline Diff on Dashboard

**Context:** To see the full active prompt or a diff between original and optimized, users had to navigate to the separate Prompt History page. For demo purposes this breaks flow — better to show both inline on the Dashboard.

**Decision:**
1. **Prompt modal** — clicking anywhere on the active prompt strip opens a modal with the full prompt text. Strip gets a hover highlight to signal it's clickable.
2. **"View full" → "View diff"** — the strip's action button shows "View full →" before optimization (opens prompt modal). After optimization completes (2+ versions in history), it changes to "View diff →" and opens an inline diff modal showing original vs latest optimized side-by-side using the existing `PromptDiff` component.

**Impact:** `Dashboard.vue` — `showPromptModal` + `showDiffModal` refs; `openPromptModal()` / `openDiffModal()` functions; `PromptDiff` imported; modal overlay + `.modal`, `.modal--wide`, `.modal-prompt-text`, `.modal-diff` styles added; active-prompt-strip cursor + hover added.

---

## 2026-02-28 Fix: Transcript Auto-Scroll Not Working

**Root Cause:** `ref="messagesEl"` was on the inner `.messages` div which has no fixed height and therefore no scrollable overflow. The actual scrollable container is the outer `.transcript-viewer` div.

**Fix:** Moved `ref="messagesEl"` to the outer `.transcript-viewer` div. Also added a second `watch(() => props.transcript, scrollToBottom)` to trigger scroll when switching between cases.

---

## 2026-03-01 Fix: Re-run Transcript Cut Short (Optimized Agent Never Finishes)

**Context:** `rerunWithReplay()` only looped `for turn < callerMessages.length` — exactly as many turns as the original run stored. In the original run the conversation ended because the *old* agent said a closing phrase. With the optimized prompt the agent might respond differently mid-stream — and the caller never got to continue past the last stored message. The transcript was cut short right as the new agent was mid-conversation, making evaluation unfair.

**Fix:** Two-phase replay:
1. **Replay phase** — replay stored caller messages exactly (deterministic A/B comparison)
2. **Continue phase** — if the agent hasn't closed after all stored messages are replayed, continue with live caller simulation until the agent naturally closes. Gives the optimized agent a complete conversation to be evaluated on.

**Impact:** `simulationEngine.ts` — `rerunWithReplay()` now has a `conversationEnded` flag; Phase 2 live continuation uses `simulateUserTurn` + `isCallerEndingCall` guard.

---

## 2026-03-01 Fix: Conversation Not Stopping When Caller Says Goodbye

**Context:** End-of-conversation detection only checked the **agent's** response. When the caller said "Goodbye" or "I'll see you Saturday", the loop continued — called the agent again, agent responded, only then checked. This caused unnecessary extra turns and agents responding after the caller had clearly ended the call.

**Fix:** Added `isCallerEndingCall()` export in `promptChains.ts`. Called immediately after generating the caller's message in both `runTestCases` and `rerunWithReplay` Phase 2. If the caller ends the call, loop breaks before the agent responds again.

**Caller end phrases include:** "goodbye", "bye", "take care", "I'll see you", "see you Saturday", "I'm hanging up", "that's that", "farewell".

**Impact:** `promptChains.ts` — `CALLER_END_PHRASES` + `isCallerEndingCall()`; `simulationEngine.ts` — caller-end check after each `simulateUserTurn` call.

---

## 2026-03-01 Fix: Chain 4 Evaluator Too Strict (False Failures on Correct Responses)

**Context:** The evaluator (Chain 4) was failing KPIs on technicalities. E.g. agent said "so the team can get back to you" but KPI required "explaining that the details are needed so the team can follow up" — the evaluator rejected this as not explicitly stating purpose, despite the intent being identical.

**Fix:** Updated Chain 4 system prompt to judge **intent and substance**, not exact phrasing. Only fail a KPI if there is clear, concrete evidence the agent did NOT do what was required. Added explicit instruction: "do not fail on technicalities or hairsplitting."

**Impact:** `promptChains.ts` — `CHAIN4_SYSTEM` updated.

---

## 2026-03-01 Fix: Chain 4 JSON Parse Crash on Long Transcripts

**Context:** `evaluateTranscript` was using `max_tokens: 2048`. Long multi-turn conversations produced evaluation responses that exceeded this, getting cut mid-JSON. `extractJSON` failed to parse and crashed after 3 retries.

**Fix:** Increased `max_tokens` for Chain 4 calls from `2048` to `4096`.

**Impact:** `promptChains.ts` — `evaluateTranscript` `retryFn` now uses `4096`.

---

## 2026-03-01 Fix: KPI Checklist Problem ("all four required elements")

**Context:** Chain 1 was generating KPIs like "Agent provides a description of braces including candidacy information and all four required elements for braces." This always failed because the evaluator invented what those "four elements" were and found one missing.

**Fix:** Added explicit rule to Chain 1: KPIs must be simple and broad — do NOT enumerate sub-requirements or checklists within a single KPI. Added BAD/GOOD example showing the checklist anti-pattern.

**Impact:** `promptChains.ts` — Chain 1 KPI rules section updated.

---

## 2026-03-08 Feature: LiveKit Voice Mode — Agent-to-Agent Calls + Transcript Collection

**Context:** Added a Voice Mode alongside the existing text simulation flywheel. Each test case becomes a real-time voice call between two Gemini Live agents in a LiveKit room: a dental-agent (AI assistant using HL system prompt) and a caller-agent (simulated patient). Transcripts are collected and evaluated by the same Chain 4 evaluator.

**Key decisions:**

**Self-hosted LiveKit via Docker** — LiveKit Cloud requires cloud storage for egress recordings. Self-hosted with Docker gives local control and avoids cloud billing for a dev/demo tool.

**Two separate agent workers** — `@livekit/agents` requires long-running WorkerProcess instances, not request handlers. `agent/dental-agent.ts` and `agent/caller-agent.ts` run as separate Node.js workers via `npm run agents`, listening for dispatch requests from the backend.

**Sequential rooms (one call at a time)** — Gemini Realtime API has concurrent session limits. One room per test case prevents rate-limit collisions and makes debugging easier.

**`ConversationItemAdded` with `role === 'assistant'` filter** — This event fires for BOTH what the agent hears (role: 'user') AND what it says (role: 'assistant'). Without filtering, each agent published the other's speech too, causing every turn to appear twice. Fix: each agent only publishes `item.role === 'assistant'` turns.

**Impact:** `agent/dental-agent.ts`, `agent/caller-agent.ts`, `agent/index.ts`, `server/services/livekitService.ts`, `server/routes/voice.ts`, `docker-compose.yml`, `livekit.yaml`, `egress.yaml`, `tsconfig.agent.json`.

---

## 2026-03-08 Fix: Both Agents Listening to Backend-Listener Instead of Each Other

**Root Cause:** `RoomIO` (the audio I/O layer inside `@livekit/agents`) calls `participantAvailableFuture.resolve()` on the **first** participant it sees that matches `participantKinds`. The backend-listener was joining the room **before** agents were dispatched. When agents joined, the backend-listener was already present as `ParticipantKind.STANDARD` — which matched our `participantKinds: [AGENT, STANDARD, SIP]`. Both agents locked onto the backend-listener as their audio input target. Neither agent ever heard the other.

**Fix:** Moved `joinRoomAsListener` to **after** `waitForParticipants` succeeds. Agents now enter an empty room, see only each other (`ParticipantKind.AGENT`), and lock onto each other for audio. The backend-listener joins after that — both agents have already resolved their participant selection so it has no effect on audio routing.

**Key insight:** `participantAvailableFuture` is a one-shot latch. Once resolved, any subsequent `onParticipantConnected` calls are ignored (`if (this.participantAvailableFuture.done) return`). Order of joining matters critically in agent-to-agent setups.

**Impact:** `server/routes/voice.ts` — moved `joinRoomAsListener` call after `waitForParticipants`.

---

## 2026-03-08 Fix: Egress Recording — EncodedFileOutput Requires Cloud Storage Backend

**Root Cause:** `EncodedFileOutput` in the LiveKit protocol has an `output` oneof field that must be set to `s3`, `gcp`, `azure`, or `aliOSS`. It is not optional. `local_directory` in `egress.yaml` is a secondary download path **after** cloud upload — not a replacement for the storage backend. Sending `EncodedFileOutput({ filepath: 'file.ogg' })` with no `.output` field causes the egress server to reject with `"request has missing or invalid field: output"`.

**Additionally:** `RoomCompositeEgress` uses Chrome (headless browser) to compose the room layout. Chrome fails to start inside the Docker macOS environment ("Start signal not received"), making `RoomCompositeEgress` unusable locally on macOS regardless.

**Solution (Option B — backend listener audio capture):** The `backend-listener` already subscribes to all tracks via `@livekit/rtc-node`. `AudioStream` provides a `ReadableStream<AudioFrame>` over any `RemoteAudioTrack`, yielding `Int16Array` PCM frames at a configurable sample rate. These are piped directly into a local `ffmpeg` process (stdin → Ogg Vorbis file). No egress container, no cloud storage, no Chrome needed.

**ffmpeg command:** `ffmpeg -f s16le -ar 48000 -ac 1 -i pipe:0 -c:a libvorbis -q:a 4 <output.ogg>`

**`stopRecording()`** closes ffmpeg's stdin (signals EOF) and waits up to 5s for the file to be finalised before the room is deleted.

**Impact:** `server/services/livekitService.ts` — `joinRoomAsListener` now also spawns ffmpeg, subscribes `AudioStream` per track via `RoomEvent.TrackSubscribed`, returns `stopRecording()` and `recordingPath`. `server/routes/voice.ts` — calls `stopRecording()` after call ends, logs recording filename.

---

## 2026-03-01 Decision: Patch-Based Prompt Optimization (Chain 5)

**Context:** Chain 5 was regenerating the entire agent prompt from scratch (`max_tokens: 4096`). For a typical 500-800 token prompt, this was slow — Claude had to output the full text token by token. The passes list was also bloated (full scenario + KPI entries for every passing KPI).

**Decision:** Switch to a **patch approach**. Chain 5 now outputs a small JSON object:
```json
{ "insertions": ["new rule to append"], "replacements": [{"find": "old text", "replace": "new text"}] }
```
`applyPatch()` applies replacements first then appends insertions to the original prompt. Output is a complete valid prompt — original text with targeted fixes layered on.

**Why faster:** `max_tokens` dropped from `4096` to `1024` (4× less generation). Input is also smaller — passes list is now a semicolon-joined summary of KPI topics only, not full entries.

**Impact:** `promptChains.ts` — `CHAIN5_SYSTEM` rewritten; `PromptPatch` interface + `applyPatch()` added; `optimizePrompt()` now calls `extractJSON<PromptPatch>` and applies patch to original.
