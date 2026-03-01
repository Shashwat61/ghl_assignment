# Demo Walkthrough — Voice AI Performance Optimizer

**Target:** 2–5 minute recording
**PDF requirements to hit:** analyze prompt → generate test cases → simulate conversations → evaluate KPIs → show before/after optimization → push to HL

---

## 0. Before You Hit Record

- HL sandbox sub-account open, Voice AI Optimizer visible in left sidebar
- Agent selected has a system prompt with some gaps (so the flywheel actually finds failures)
- Railway deployment is live and healthy

---

## 1. Open the App Inside HL (~20 sec)

**What to do:** Start with the HL sub-account visible. Click **Voice AI Optimizer** in the left sidebar.

**What to say:**
> "This is the Voice AI Performance Optimizer — a Validation Flywheel that automates the test and optimize phases for HighLevel Voice AI agents. It's embedded natively inside HighLevel using the Marketplace Custom Page module, so it lives right here in the sub-account sidebar — no separate tab needed."

---

## 2. Connect HighLevel via OAuth (~20 sec)

**What to do:** Click **Connect HighLevel**. Popup opens, approve it, popup closes. Agent list loads.

**What to say:**
> "Authentication is a real HL OAuth 2.0 flow — the app requests scoped access to the sub-account's Voice AI agents. Once approved, the popup closes automatically and we're connected."

**Under the hood:**
- Popup opens `/auth` → redirects to HL OAuth consent
- HL returns an auth code → backend exchanges it for `access_token + refresh_token`
- Token stored in memory with `locationId`
- Popup closes itself via `window.close()`

---

## 3. Select an Agent (~10 sec)

**What to do:** Click the agent you want to optimize (e.g. "Dental Clinic Agent").

**What to say:**
> "Agents are fetched live from HighLevel's Voice AI API. I select the agent whose prompt I want to analyze and optimize."

**Under the hood:** `GET /voice-ai/agents` → reads the agent's current system prompt from HL

---

## 4. Show the Agent's Current Prompt (~15 sec)

**What to do:** Point to the Active Prompt strip at the top of the Dashboard.

**What to say:**
> "The agent's current system prompt is shown here. This is what it's currently running in HighLevel. The flywheel will analyze this prompt, find its weaknesses, and automatically fix them."

---

## 5. Start the Flywheel (~10 sec)

**What to do:** Click **▶ Run Simulation**.

**What to say:**
> "One click kicks off the full validation flywheel. No manual configuration — it reads the prompt directly from HighLevel and runs the full pipeline automatically."

---

## 6. Phase 1 — Generate Test Cases (~30 sec)

**What to watch:** Test case cards appear in the left panel with scenarios and KPIs.

**What to say:**
> "Step one: the flywheel uses Claude as a QA architect to generate 5 diverse test cases from the agent's system prompt. Each test case has a realistic caller scenario — a frustrated patient asking about insurance, someone asking about treatment costs — and 2 to 4 outcome-based KPIs that define what success looks like for that call."

**Under the hood (Chain 1):**
- Claude reads the agent prompt and generates `[{ scenario, kpis[] }]`
- KPIs are outcome-based: "Agent collects caller name and email before closing" — not format-based like "Agent uses exactly two sentences"

---

## 7. Phase 1 — Simulate Conversations (~45 sec)

**What to watch:** Transcripts stream in the middle panel, turn by turn, in real time.

**What to say:**
> "For each test case, two Claude instances have a full multi-turn conversation: one plays the caller, one plays the agent using the actual HighLevel system prompt as its instructions. You can watch every turn stream live.

> The conversation runs naturally until the agent closes the call — says goodbye, confirms contact details, wraps up. No fixed turn count — conversations end the way real calls do."

**Under the hood:**
- **Chain 2 (User Simulator):** Claude roleplays the caller — gives realistic fictional names/emails when asked, stays in character, only says goodbye after the agent fully wraps up
- **Chain 3 (Agent Simulator):** Claude uses the actual system prompt as its system message; end-of-call is detected via closing phrases ("goodbye", "take care", "have a great day")
- Per-case timeout: 2 minutes; safety cap: 15 turns

---

## 8. Phase 1 — KPI Evaluation (~20 sec)

**What to watch:** Test case cards flip to PASS (green) or FAIL (red). Click a failing card to see the KPI breakdown in the right panel.

**What to say:**
> "Once the conversation ends, Claude acts as an objective judge — it reads the full transcript and scores every KPI as pass or fail, with a one-line reasoning citing specific evidence from the conversation.

> Here you can see Case 2 failed — the agent didn't collect the caller's email before closing. That's a real gap in the system prompt."

**Under the hood (Chain 4):**
- Claude receives transcript + KPI list → returns `{ overall, kpiResults[], summary }`
- One KPI failure → overall = fail

---

## 9. Optimization — Rewriting the Prompt (~20 sec)

**What to watch:** Header shows **"⚙ Optimizing prompt..."**

**What to say:**
> "Failures found — the flywheel immediately starts optimizing. Claude acts as a senior prompt engineer: it receives the original prompt, the exact failures with their reasoning, and the list of passing KPIs it must not break. It rewrites the complete system prompt to fix every failure while preserving what already works."

**Under the hood:**
- **Chain 5 (Prompt Optimizer):** Claude receives `originalPrompt + failures[] + passes[]` → outputs a complete drop-in replacement prompt
- Not pushed to HL yet — we validate first

---

## 10. Re-run the Failing Cases (~30 sec)

**What to watch:** Only the previously failing cases re-run (header: **"Fix Loop · Attempt 2/2"**). Their cards update.

**What to say:**
> "Now we re-run only the cases that failed — but here's the key: we replay the exact same caller messages from the first run. The caller says the same things in the same order; only the agent's responses change because it's now using the new prompt. This is a true A/B comparison — same inputs, different prompt."

---

## 11. Push to HighLevel — Only After Tests Pass (~10 sec)

**What to watch:** Header shows **"⬆ Pushing to HighLevel..."** — only after re-run shows all green.

**What to say:**
> "All cases pass with the new prompt — only now does it push to HighLevel. We don't push speculatively; we push a prompt we've validated works against the exact same scenarios that failed before."

**Under the hood:**
- `PATCH /voice-ai/agents/:id` — live HL agent updated only after confirmed pass

---

## 11. Phase 2 — Harden Loop (~30 sec)

**What to watch:** Header switches to **"Harden · Batch 1/2"**. New test case cards appear.

**What to say:**
> "Original failures are fixed. Now Phase 2 — the harden loop. We generate a completely fresh batch of test cases and run them against the improved prompt. This prevents overfitting — the optimizer can't have just learned the specific fix cases. If these new scenarios also pass, the prompt is solid."

---

## 12. Show the Results + Prompt History (~30 sec)

**What to do:** Flywheel completes. Point to the pass rate in the header. Click **📋 Prompt History**.

**What to say:**
> "Flywheel complete. We can see the final pass rate across all test cases. In Prompt History, every version of the prompt is recorded — the original and each optimized version — with their pass rates. Here's the diff: the highlighted additions are the specific instructions the optimizer added to fix the failing KPIs."

---

## 13. Close — What This Solves (~20 sec)

**What to say:**
> "This closes the full validation loop — from analyzing a prompt to testing it, finding failures, auto-optimizing, and pushing the improved version back to HighLevel — all in one automated run. What would take a prompt engineer hours of manual iteration, this flywheel does in a few minutes."

---

## Cheat Sheet — What Shows in the Header

| Header text | What's happening |
|---|---|
| Simulating... | Generating test cases |
| Fix Loop · Attempt 1/2 | Initial 5 conversations running |
| ⚙ Optimizing prompt... | Claude rewriting the system prompt |
| ⬆ Pushing to HighLevel... | PATCH API call updating live HL agent |
| Fix Loop · Attempt 2/2 | Re-running the previously failing cases |
| Harden · Batch 1/2 | Fresh test cases stress-testing the improved prompt |

---

## What's Real vs Simulated (Per PDF Requirement)

| Feature | Status |
|---|---|
| HL OAuth 2.0 | Real — full token exchange |
| Fetch agents from HL | Real — `GET /voice-ai/agents` |
| Push optimized prompt to HL | Real — `PATCH /voice-ai/agents/:id` |
| Test case generation | Real — Claude generates from actual prompt |
| Conversation simulation | Simulated — two Claude instances roleplay caller + agent (HL doesn't expose real-time call simulation in sandbox — confirmed acceptable per assignment clarifications) |
| KPI evaluation | Real — Claude-as-judge on full transcripts |
| Prompt optimization | Real — Claude rewrites targeting actual failures |
