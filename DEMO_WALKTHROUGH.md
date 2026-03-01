# Demo Walkthrough — Voice AI Performance Optimizer

**Target:** 2–5 minute recording
**PDF requirements to hit:** analyze prompt → generate test cases → simulate conversations → evaluate KPIs → show before/after optimization → push to HL

---

## How the System Works (Read This First)

### The Problem It Solves
Voice AI agents in HighLevel run on system prompts. Writing a good prompt is hard — you don't know if it'll handle edge cases until it fails in production. This app automates the entire test-optimize loop: it finds failures in the prompt, fixes them, validates the fix, and pushes the improved version to HighLevel — all without manual intervention.

### The 5 Claude Chains (LLM-as-Judge + More)

| Chain | Role | What Claude Acts As |
|---|---|---|
| **Chain 1** | Test case generator | QA architect — reads the agent prompt, generates 2 diverse scenarios with outcome-based KPIs |
| **Chain 2** | Caller simulator | Roleplay caller — stays in character, gives realistic fictional details, doesn't hang up prematurely |
| **Chain 3** | Agent simulator | The HL voice agent — uses the actual system prompt as its instructions |
| **Chain 4** | KPI evaluator | **LLM-as-Judge** — reads the full transcript, scores each KPI pass/fail with one-line reasoning citing specific evidence |
| **Chain 5** | Prompt optimizer | Senior prompt engineer — outputs a targeted JSON patch (insertions + replacements) to fix failures without breaking passing behaviors |

**LLM-as-Judge (Chain 4)** is the key architectural decision. Instead of writing brittle regex or rule-based checks, the evaluator reads the entire conversation and makes a reasoned judgment on each KPI — the same way a human QA reviewer would.

### The Flywheel Flow

```
Generate 2 test cases (Chain 1)
        ↓
For each case:
  Caller turn (Chain 2) → Agent turn (Chain 3) → repeat until agent closes call
        ↓
Evaluate transcript against KPIs (Chain 4) — LLM-as-Judge
        ↓
If failures → Optimize prompt (Chain 5, patch approach) → don't push yet
        ↓
Re-run ONLY failing cases with SAME caller messages (deterministic A/B)
        ↓
If all pass → Push to HighLevel ✓
If still failing (attempt 2/2) → Push best version only if it improved
```

### Key Design Decisions Worth Mentioning

**Deterministic re-runs:** In the initial run, every caller message is stored. On re-run, those exact messages are replayed — only the agent responds with the new prompt. This is a true A/B test: same inputs, different prompt, see if output improves. Without this, a re-run might pass because the simulated caller asked easier questions, not because the optimization worked.

**Push only after passing:** The optimized prompt is never pushed to HL speculatively. It only goes live after the re-run confirms all previously failing cases now pass.

**Patch-based optimization:** Chain 5 outputs a small JSON patch (`insertions` + `replacements`) instead of rewriting the full prompt. This is ~4× faster — output is 200-300 tokens instead of 800-1000.

**Natural conversation ending:** Conversations don't have a fixed turn count. They end when the agent says a closing phrase ("goodbye", "take care", "have a great day") or when the caller explicitly ends the call ("I'll see you then", "goodbye"). Safety cap at 15 turns.

---

## Demo Script

### 0. Before You Hit Record

- HL sandbox sub-account open, Voice AI Optimizer visible in left sidebar
- Have a dental clinic or similar agent selected — one whose prompt has some gaps (so the flywheel finds failures)
- Server running locally or Railway deployment live

---

### 1. Open the App Inside HL (~20 sec)

**What to do:** Start with the HL sub-account visible. Click **Voice AI Optimizer** in the left sidebar.

**What to say:**
> "This is the Voice AI Performance Optimizer — a Validation Flywheel that automates the test-and-optimize loop for HighLevel Voice AI agents. It's embedded natively inside HighLevel as a Marketplace Custom Page, so it lives right here in the sub-account sidebar."

---

### 2. Connect HighLevel via OAuth (~20 sec)

**What to do:** Click **Connect HighLevel**. Popup opens, approve it, popup closes. Agent list loads.

**What to say:**
> "Authentication is a real HL OAuth 2.0 flow — the app requests scoped access to the sub-account's Voice AI agents. Once approved, the popup closes automatically and we're connected."

**Under the hood:**
- Popup → `/auth` → HL OAuth consent page
- HL returns auth code → backend exchanges for `access_token + refresh_token`
- Token stored in memory with `locationId`; popup closes via `window.close()`

---

### 3. Enter Anthropic API Key (~10 sec)

**What to do:** If the key card is shown, paste in your `sk-ant-` key and click Save.

**What to say:**
> "The reviewer uses their own Anthropic API key — the app doesn't rely on my credentials, so it keeps working regardless of billing status."

---

### 4. Select an Agent (~10 sec)

**What to do:** Click the agent you want to optimize (e.g. "Dental Clinic Agent").

**What to say:**
> "Agents are fetched live from HighLevel's Voice AI API. I'll select the agent whose prompt I want to analyze and optimize."

**Under the hood:** `GET /voice-ai/agents` → reads the agent's current `agentPrompt` field from HL

---

### 5. Show the Active Prompt (~15 sec)

**What to do:** Point to the **ACTIVE PROMPT** strip at the top of the Dashboard. Click it to open the full prompt modal.

**What to say:**
> "The agent's current system prompt is shown here — this is what it's running right now in HighLevel. I can click anywhere on this strip to read the full prompt. The flywheel will analyze this prompt, find its weaknesses, and automatically fix them."

**Note:** Strip is clickable — opens a modal with the full prompt text. Button says "View full →" before optimization.

---

### 6. Start the Flywheel (~10 sec)

**What to do:** Click **▶ Run Simulation**.

**What to say:**
> "One click kicks off the full validation flywheel. No configuration — it reads the prompt from HighLevel and runs the complete pipeline automatically."

---

### 7. Phase 1 — Generate Test Cases (~30 sec)

**What to watch:** Header shows **Fix Loop · Attempt 1/2**. Test case cards appear in the left panel with scenarios and KPIs.

**What to say:**
> "Step one: Claude acts as a senior QA architect. It reads the agent's system prompt and generates 2 diverse test cases — each with a realistic caller scenario and 2-4 outcome-based KPIs that define what success looks like for that call.

> The KPIs are outcome-based — they judge what the agent *accomplishes*, not how it phrases things. And they only measure agent behavior, never outcomes that depend on the caller."

---

### 8. Phase 1 — Simulate Conversations (~45 sec)

**What to watch:** Transcripts stream in the middle panel, turn by turn, in real time.

**What to say:**
> "For each test case, two Claude instances run a full multi-turn conversation. One plays the caller — staying in character, giving realistic fictional details when asked. The other plays the agent using the actual HighLevel system prompt as its instructions.

> The conversation runs naturally until the agent closes the call — says goodbye, confirms details, wraps up. No fixed turn count. And if the caller says goodbye first, we stop immediately — we don't keep prompting the agent after the caller has left."

**Under the hood:**
- **Chain 2 (Caller):** Roleplay mode, gives real-sounding names/emails, exits only on natural conversation end
- **Chain 3 (Agent):** System prompt = the HL agent's actual prompt; closing detected via phrase matching on agent AND caller messages
- Safety cap: 15 turns, 2-minute per-case timeout

---

### 9. Phase 1 — KPI Evaluation (LLM-as-Judge) (~20 sec)

**What to watch:** When a conversation ends, the test case card switches from purple "Running" to an amber "Analysing..." badge — this is Chain 4 (LLM-as-Judge) evaluating the transcript. Then it flips to PASS (green) or FAIL (red). Click a failing card to see the KPI breakdown.

**What to say:**
> "Once the conversation ends, you'll see the card switch to 'Analysing' — that's Claude acting as an objective judge, reading the full transcript and scoring every KPI pass or fail, with a one-line reasoning citing specific evidence from the conversation. This is LLM-as-Judge: using a language model as a quality evaluator rather than writing brittle rule-based checks.

> Here you can see Case 2 failed — the agent missed something. That's a real gap the optimizer now needs to fix."

**Under the hood (Chain 4 — LLM-as-Judge):**
- Claude receives: full transcript + KPI list + scenario
- Returns: `{ overall, kpiResults[{ kpi, result, reasoning }], summary }`
- One KPI failure → `overall = fail`
- Evaluates substance and intent, not exact phrasing

---

### 10. Optimization — Patch-Based Rewrite (~20 sec)

**What to watch:** Header shows **⚙ Optimizing prompt...**

**What to say:**
> "Failures found — the flywheel immediately starts optimizing. Claude acts as a senior prompt engineer: it receives the original prompt, the exact failures with their reasoning, and the passing KPIs it must not break.

> Instead of rewriting the whole prompt from scratch, it outputs a targeted JSON patch — specific instructions to insert and specific text to replace. This is about 4× faster than full regeneration, and it keeps everything that was already working intact."

**Under the hood (Chain 5 — Patch Optimizer):**
- Input: original prompt + failures[] + pass topics summary + previous failed attempts (on attempt 2)
- Output: `{ insertions: [...], replacements: [{find, replace}] }`
- `applyPatch()` applies replacements then appends insertions to the original
- `max_tokens: 1024` (was 4096 for full rewrite)
- Not pushed to HL yet — must validate first

---

### 11. Re-run — Deterministic A/B Comparison (~30 sec)

**What to watch:** Only the previously failing cases re-run. Header shows **Fix Loop · Attempt 2/2**.

**What to say:**
> "Now we re-run only the cases that failed — but here's the critical detail: we replay the exact same caller messages from the first run. The caller says the same things in the same order. Only the agent's responses change because it's using the new prompt.

> This is a true A/B comparison: same inputs, different prompt. If it passes now, we know the optimization actually fixed the specific failure — not that we got lucky with an easier caller."

---

### 12. Push to HighLevel — Only After Tests Pass (~15 sec)

**What to watch:** Header shows **⬆ Pushing to HighLevel...** — only appears when the re-run results are all green.

**What to say:**
> "All cases pass with the new prompt — only now does it push to HighLevel. We never push speculatively. The improved prompt goes live only after it's been validated against the exact same scenarios that caused the original failures."

**Under the hood:** `PATCH /voice-ai/agents/:id` with `{ agentPrompt: optimizedPrompt }` as body, `{ locationId }` as query param, `Version: 2021-04-15` header.

---

### 13. Show Results + Diff (~30 sec)

**What to watch:** Header shows **V1 · OPTIMIZED** on the active prompt strip. The strip button now says **"View diff →"**. Click it.

**What to say:**
> "Flywheel complete. The active prompt is now marked V1 Optimized. I can click anywhere on the prompt strip to read the full prompt — or click 'View diff' to see exactly what the optimizer changed. Green lines are additions, red lines are what was removed. You can see the specific instructions it added to fix the failing KPIs without touching anything that was already working."

---

### 14. Close — What This Solves (~20 sec)

**What to say:**
> "This closes the full validation loop — from analyzing a prompt, to finding failures, to auto-optimizing, to pushing the validated version back to HighLevel — all in one automated run. What would take a prompt engineer hours of manual iteration, this flywheel does in a few minutes."

---

## Cheat Sheet — Header States

| Header text | What's happening |
|---|---|
| Fix Loop · Attempt 1/2 | Initial 2 conversations running |
| ⚙ Optimizing prompt... | Chain 5 generating patch |
| Fix Loop · Attempt 2/2 | Re-running the previously failing cases with new prompt |
| ⬆ Pushing to HighLevel... | PATCH API call updating live HL agent |
| ✅ All test cases passed | No failures found — prompt already solid |

## Cheat Sheet — Test Case Card States

| Badge | Color | What's happening |
|---|---|---|
| Running + timer | Purple | Conversation in progress (Chain 2 + 3) |
| Analysing... | Amber | LLM-as-Judge evaluating transcript (Chain 4) |
| ✓ Pass | Green | All KPIs passed |
| ✗ Fail | Red | One or more KPIs failed |
| Pending | Grey | Not yet started |

---

## What's Real vs Simulated

| Feature | Status |
|---|---|
| HL OAuth 2.0 | **Real** — full token exchange |
| Fetch agents from HL | **Real** — `GET /voice-ai/agents` |
| Push optimized prompt to HL | **Real** — `PATCH /voice-ai/agents/:id` |
| Test case generation | **Real** — Chain 1, Claude reads actual prompt |
| Conversation simulation | **Simulated** — two Claude instances roleplay caller + agent (HL doesn't expose real-time call simulation in sandbox — confirmed acceptable per assignment clarifications) |
| KPI evaluation (LLM-as-Judge) | **Real** — Chain 4, Claude evaluates full transcripts |
| Prompt optimization | **Real** — Chain 5, patch targeting actual failures |

---

## Architecture Summary (For Technical Questions)

```
Frontend (Vue 3 + Pinia)
  └── SSE connection to GET /api/flywheel
  └── Events stream in real-time: testcase_start, turn, evaluated, optimize_start, optimize_complete, push_start, push_complete, complete

Backend (Express + TypeScript)
  └── simulationEngine.ts — orchestrates the flywheel
  └── promptChains.ts — 5 Claude chains
  └── hlClient.ts — HighLevel API calls (OAuth, fetch agents, patch agent)
  └── sessionStore.ts — in-memory token + Anthropic key storage

Claude Chains
  Chain 1: QA Architect → test cases JSON
  Chain 2: Caller roleplay → spoken message
  Chain 3: Agent roleplay → spoken response + isConversationEnd flag
  Chain 4: LLM-as-Judge → { overall, kpiResults[], summary }
  Chain 5: Patch engineer → { insertions[], replacements[] }
```
