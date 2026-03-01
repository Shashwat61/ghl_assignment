# Architecture — Voice AI Performance Optimizer

---

## 1. What Was Asked (Assignment Requirements)

The assignment asked for an **Agent Performance Copilot** — a "Validation Flywheel" that automates the test and optimize phases for HighLevel Voice AI agents. Specifically:

| Requirement | Status |
|---|---|
| Analyze agent system prompt | ✅ Chain 1 reads the live prompt from HL API |
| Generate test cases | ✅ Chain 1 (Claude as QA Architect) |
| Simulate multi-turn conversations | ✅ Chain 2 (caller) + Chain 3 (agent) |
| Evaluate against KPIs (LLM-as-Judge) | ✅ Chain 4 |
| Show before/after optimization | ✅ Inline diff modal on Dashboard |
| Auto-push optimized prompt to HL | ✅ `PATCH /voice-ai/agents/:id` |
| HL OAuth 2.0 integration | ✅ Full token exchange + refresh |
| Embedded inside HL UI | ✅ Marketplace Custom Page (sidebar nav item) |
| Vue.js frontend | ✅ Vue 3 + Pinia + Vite |
| Node.js + Express backend | ✅ TypeScript + Express |
| Hosted deployment | ✅ Railway |
| 2-5 min demo | ✅ DEMO_WALKTHROUGH.md |
| README with architecture notes | ✅ This file |

**Clarifications confirmed with hiring team:**
- Conversation simulation via LLM roleplay (not real call simulation) is acceptable
- Auto-push without user confirmation is the correct UX
- 2 test cases for demo (5 is the production default)
- Anthropic Claude (claude-sonnet-4-6) as the LLM provider

---

## 2. System Architecture (Current — Demo Build)

```
┌─────────────────────────────────────────────────────────┐
│                  HighLevel Sub-Account                   │
│  ┌─────────────────────────────────────────────────┐    │
│  │  Marketplace Custom Page (sidebar nav item)     │    │
│  │  ┌─────────────────────────────────────────┐   │    │
│  │  │         Vue 3 SPA (iframe)              │   │    │
│  │  │  AgentList → Dashboard → PromptHistory  │   │    │
│  │  └───────────────┬─────────────────────────┘   │    │
│  └──────────────────│─────────────────────────────┘    │
└─────────────────────│───────────────────────────────────┘
                      │ HTTP + SSE
┌─────────────────────▼───────────────────────────────────┐
│              Express Backend (Railway)                   │
│                                                          │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Auth     │  │ Agents       │  │ Flywheel SSE      │  │
│  │ /auth    │  │ /api/agents  │  │ /api/flywheel     │  │
│  │ /redirect│  │ /api/settings│  │                   │  │
│  └────┬─────┘  └──────┬───────┘  └────────┬──────────┘  │
│       │               │                   │             │
│  ┌────▼───────────────▼───────────────────▼──────────┐  │
│  │              Services Layer                        │  │
│  │  sessionStore  │  hlClient  │  simulationEngine   │  │
│  │                │            │  promptChains        │  │
│  └────────────────┬────────────┴──────────────────────┘  │
└───────────────────│─────────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        │                       │
┌───────▼──────┐      ┌─────────▼──────────┐
│  HighLevel   │      │  Anthropic Claude   │
│  API         │      │  claude-sonnet-4-6  │
│  (OAuth +    │      │  (5 chains)         │
│   CRUD)      │      └────────────────────┘
└──────────────┘
```

### Data Flow — Single Flywheel Run

```
Browser                    Backend                     External
  │                           │                            │
  │── GET /api/flywheel ──────►│                            │
  │   (SSE connection)        │── GET /voice-ai/agents ───►│ HL API
  │                           │◄── agentPrompt ────────────│
  │                           │                            │
  │                           │── Chain 1 ────────────────►│ Claude
  │◄── testcase_start ────────│◄── [{scenario,kpis}] ──────│
  │                           │                            │
  │                           │  For each test case:       │
  │                           │── Chain 2 (caller) ───────►│ Claude
  │◄── turn (user) ───────────│◄── callerMessage ──────────│
  │                           │── Chain 3 (agent) ───────►│ Claude
  │◄── turn (assistant) ──────│◄── agentResponse ──────────│
  │                           │   (repeat until close)     │
  │                           │                            │
  │                           │── Chain 4 (judge) ────────►│ Claude
  │◄── evaluated ─────────────│◄── {pass/fail per KPI} ────│
  │                           │                            │
  │  [if failures found]      │                            │
  │◄── optimize_start ────────│                            │
  │                           │── Chain 5 (patch) ────────►│ Claude
  │◄── optimize_complete ─────│◄── {insertions,replacements│
  │                           │                            │
  │  [re-run same messages]   │                            │
  │◄── turn, evaluated ───────│  (replay caller messages)  │
  │                           │                            │
  │  [if all pass]            │                            │
  │◄── push_start ────────────│                            │
  │                           │── PATCH /voice-ai/agents ─►│ HL API
  │◄── push_complete ─────────│◄── 200 OK ─────────────────│
  │◄── complete ──────────────│                            │
```

---

## 3. The 5 Claude Chains

| # | Name | Claude's Role | Input | Output | Max Tokens |
|---|---|---|---|---|---|
| 1 | Test Case Generator | Senior QA Architect | Agent system prompt | `[{scenario, kpis[]}]` JSON | 2048 |
| 2 | Caller Simulator | Roleplay caller | Scenario + history | Spoken caller message | 512 |
| 3 | Agent Simulator | The HL voice agent | Agent prompt (system) + history | Spoken agent response | 1024 |
| 4 | KPI Evaluator (LLM-as-Judge) | Objective QA judge | Full transcript + KPIs | `{overall, kpiResults[], summary}` | 4096 |
| 5 | Prompt Optimizer | Senior prompt engineer | Prompt + failures + passes | `{insertions[], replacements[]}` patch | 1024 |

**LLM-as-Judge (Chain 4)** is the core evaluation mechanism. Rather than writing brittle rule-based checks, a Claude instance reads the entire conversation transcript and makes a reasoned judgment on each KPI — the same way a human QA reviewer would. It judges substance and intent, not exact phrasing, and cites specific transcript evidence in its reasoning.

**Patch-based optimization (Chain 5)** outputs a JSON diff rather than regenerating the full prompt. This is ~4× faster and surgically targets only the failing behaviors, leaving working instructions untouched.

---

## 4. Key Architectural Decisions — Pros & Cons

### 4.1 LLM-as-Judge for KPI Evaluation

**What:** Claude reads the full transcript and scores each KPI pass/fail with reasoning.

**Pros:**
- Flexible — handles natural language KPIs without writing regex or rule logic
- Self-documenting — the reasoning field explains exactly why a KPI passed or failed
- Scales to arbitrary KPI types without code changes

**Cons:**
- Non-deterministic — the same transcript can get different scores across runs (mitigated by clear pass/fail criteria in prompts)
- Expensive — 4096 token call per test case per run
- Can be overly strict or lenient depending on prompt phrasing (spent significant time tuning Chain 4 to judge intent not exact wording)

### 4.2 Caller Message Replay for Deterministic Re-runs

**What:** Initial run stores every caller message per case. Re-run replays those exact messages — only the agent responds with the new prompt.

**Pros:**
- True A/B comparison — same inputs, different prompt, isolates the variable
- Without this, a re-run might pass because the simulated caller happened to ask easier questions
- Makes optimization measurable and honest

**Cons:**
- Replay is artificially constrained — the optimized agent might handle the conversation differently mid-stream but the caller's path is fixed
- Mitigated by Phase 2 of replay: after stored messages are exhausted, continue with live simulation until natural close

### 4.3 Patch-Based Prompt Optimization (Chain 5)

**What:** Chain 5 outputs `{insertions[], replacements[]}` applied to the original prompt rather than regenerating it.

**Pros:**
- ~4× faster (output ~200 tokens vs ~800 for full rewrite)
- Surgical — only touches what needs fixing
- Preserves voice/tone of the original prompt automatically

**Cons:**
- `replacements[].find` must match exact text — if Claude hallucinates a slightly different quote, replacement silently fails (falls through to append-only)
- Harder to handle structural rewrites (e.g. "move this section before that one")
- Mitigated by: `applyPatch()` gracefully falls back to insertions-only if a replacement find fails

### 4.4 SSE (Server-Sent Events) for Streaming

**What:** `GET /api/flywheel` is a long-lived SSE connection that streams every event in real time.

**Pros:**
- Native browser support (`EventSource`), no library needed
- Auto-reconnect built into the browser
- Unidirectional (server→client) which is all we need
- Simple to implement vs WebSockets

**Cons:**
- HTTP/1.1 limits to 6 concurrent connections per domain — not an issue for single-user tool
- Railway's 60s proxy timeout kills the connection if no data is sent — solved with 10s real-event heartbeats
- No back-pressure — if the client is slow, the buffer fills

### 4.5 In-Memory Session Store (No Database)

**What:** OAuth tokens and Anthropic API key stored in a Node.js `Map`, cleared on restart.

**Pros:**
- Zero infrastructure — no DB provisioning, no connection management
- Fast — O(1) access
- Perfect for single-user demo tool

**Cons:**
- Lost on server restart — user must re-authenticate
- Single-session only — can't handle concurrent users
- Railway can restart containers on deploy or OOM — tokens evaporate

### 4.6 AbortController for Cancellation on Disconnect

**What:** `req.on('close')` calls `controller.abort()`, which propagates through the entire async chain via `checkAbort(signal)` calls.

**Pros:**
- Stops burning API credits immediately when user refreshes or closes tab
- Clean — no zombie background processes

**Cons:**
- Current `checkAbort` only fires between async calls, not mid-await (e.g. won't cancel a Claude call that's already in-flight, only prevents the next one from starting)
- True cancellation mid-call would require AbortSignal passed to the `fetch` inside the Anthropic SDK — not exposed at our level

---

## 5. What's Real vs Simulated

| Feature | Real or Simulated | Notes |
|---|---|---|
| HL OAuth 2.0 | **Real** | Full PKCE-style code exchange, refresh token stored |
| Fetch agents from HL | **Real** | `GET /voice-ai/agents` live API call |
| Read agent system prompt | **Real** | From `agent.systemPrompt` field |
| Push optimized prompt to HL | **Real** | `PATCH /voice-ai/agents/:id` with `{ agentPrompt }` |
| Test case generation | **Real** | Claude reads the actual live prompt |
| Conversation simulation | **Simulated** | Two Claude instances roleplay — HL doesn't expose real-time call simulation in sandbox |
| KPI evaluation | **Real** | Claude-as-judge on full transcripts |
| Prompt optimization | **Real** | Claude generates targeted patch from actual failure evidence |

---

## 6. Current Limitations

1. **Single-user, single-session** — no multi-tenancy, no persistent state
2. **2 test cases for demo** — production would need 5-10 per run
3. **No transcript persistence** — results disappear on page refresh or server restart
4. **Caller messages are synthetic** — no real call data feeding the test cases
5. **Synchronous flywheel** — user must stay on the page while it runs (~3-5 min)
6. **Rate limit exposure** — free Anthropic tier (30k tokens/min) can be hit on long prompts; retry backoff handles it but adds latency
7. **No multi-agent comparison** — can only optimize one agent at a time

---

## 7. Real Production Architecture

If this were a real Voice AI Copilot deployed at scale, the architecture would change fundamentally. The key shift: **you no longer need to simulate conversations** — you have a continuous stream of real call transcripts from production.

### 7.1 What Changes

```
Current (Demo):              Production:
───────────────              ──────────────
Simulate caller         →    Real call transcripts (from HL)
Simulate agent          →    Real agent recordings / STT output
On-demand flywheel      →    Continuous async background pipeline
Single agent            →    Fleet of agents across all sub-accounts
User-triggered          →    Automated nightly or threshold-triggered
In-memory state         →    Persistent DB (results, prompt history, metrics)
Single-tenant           →    Multi-tenant SaaS
```

### 7.2 Production System Diagram

```
HighLevel Platform
  │
  ├── Voice AI Agents (N agents per sub-account)
  │     │
  │     └── Real call transcripts → Webhook / HL Conversation API
  │
  ▼
┌─────────────────────────────────────────────────────────┐
│                  Transcript Ingestion Layer              │
│                                                          │
│  HL Webhook → Message Queue (SQS / BullMQ)              │
│               → Transcript Normalizer                   │
│               → Transcript Store (Postgres / S3)        │
└─────────────────────────┬───────────────────────────────┘
                          │ (async, per-call)
┌─────────────────────────▼───────────────────────────────┐
│               KPI Evaluation Pipeline (async workers)   │
│                                                          │
│  Worker picks transcript from queue                     │
│  → Load KPI config for this agent                       │
│  → Chain 4 (LLM-as-Judge) → score each KPI             │
│  → Store result in DB (agent_id, call_id, kpi, score)  │
│  → Update rolling metrics (pass rate per KPI, per day) │
└─────────────────────────┬───────────────────────────────┘
                          │ (when failure rate crosses threshold)
┌─────────────────────────▼───────────────────────────────┐
│               Optimization Trigger                       │
│                                                          │
│  Cron or threshold rule:                                │
│    IF (KPI pass rate < 80% over last N calls)           │
│    → Collect representative failing transcripts        │
│    → Run Chain 5 (patch optimizer)                     │
│    → Run shadow evaluation on held-out transcripts     │
│    → IF improvement validated → candidate prompt ready │
└─────────────────────────┬───────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────┐
│               Human Review + Approval Gate               │
│                                                          │
│  Dashboard shows:                                       │
│  - Current vs proposed prompt diff                     │
│  - Before/after KPI scores on held-out transcripts     │
│  - "Approve and push" / "Reject" buttons               │
│                                                          │
│  [OR: fully automated push for trusted sub-accounts]   │
└─────────────────────────┬───────────────────────────────┘
                          │ (on approval)
┌─────────────────────────▼───────────────────────────────┐
│               Deployment + Monitoring                    │
│                                                          │
│  PATCH /voice-ai/agents/:id → live HL agent updated    │
│  Shadow traffic: new prompt on 10% of calls first      │
│  Rollback: if post-deploy pass rate drops → revert     │
└─────────────────────────────────────────────────────────┘
```

### 7.3 Production Architecture Components

**Transcript Ingestion**
- HL webhook sends each completed call to an ingestion endpoint
- Calls go into a durable queue (BullMQ on Redis, or SQS) to handle bursts
- Transcripts normalized to a standard schema (speaker, utterance, timestamp)
- Stored in object storage (S3/R2) with metadata in Postgres

**KPI Config per Agent**
- Each agent has a configured set of KPIs stored in DB (not generated fresh each time)
- KPIs are authored once (manually or via Chain 1 bootstrapping) and version-controlled
- Allows teams to customize what they care about per agent

**Async Evaluation Workers**
- Pool of workers continuously pulling from the queue
- Each worker runs Chain 4 on one transcript → writes result to DB
- Batch metrics computed nightly: KPI pass rates, failure patterns, trend lines
- No user interaction required — fully automated

**Optimization Trigger**
- Threshold-based: if KPI X drops below Y% over the last N calls → trigger optimization
- Optimizer uses a sample of recent failing transcripts (not just the latest one) for richer signal
- Runs Chain 5 on the current live prompt + aggregated failure patterns
- Validates proposed prompt against a held-out set of transcripts before surfacing to user

**Human Review Gate (vs Demo Auto-Push)**
- In production, auto-pushing is risky — a bad prompt change affects real customer calls
- Instead: surface the proposed change with before/after evidence for a human to approve
- Exception: if evaluation shows 100% pass rate on held-out set + agent owner has opted into auto-push

**Shadow Traffic / Canary**
- New prompt rolled to 10% of calls first
- Compare KPI metrics on shadow vs control cohort over 24h
- Auto-rollback if shadow performs worse

### 7.4 Additional Production Concerns

**Multi-tenancy**
- Each sub-account (location) has its own agent fleet and KPI config
- Row-level security in DB on `location_id`
- Rate limits per account to prevent one tenant exhausting Claude API

**Cost Management**
- Chain 4 (evaluation) runs on every call — this is the expensive part
- Mitigations: batch calls, use Haiku for initial triage (flag only likely failures for Sonnet re-evaluation), cache evaluations by transcript hash
- Chain 5 (optimization) runs rarely — only when pass rate drops

**Prompt Version Control**
- Every prompt version stored with: timestamp, who pushed it, what failures it addressed, KPI scores on validation set
- Full rollback history
- A/B comparison between any two versions

**Observability**
- Evaluation results feed a metrics dashboard (KPI pass rates over time per agent)
- Anomaly detection: sudden drop in a specific KPI = likely prompt regression or new caller behavior
- Alerting: PagerDuty/Slack when a critical KPI drops below threshold

---

## 8. Future Considerations (Near-Term)

If building on top of this demo codebase toward production:

| Enhancement | Why | Complexity |
|---|---|---|
| Persist session to Redis | Survive server restarts, enable multi-user | Low |
| Real transcript ingestion via HL webhook | Replace simulated conversations with real data | Medium |
| KPI config per agent (DB-stored) | Stop regenerating KPIs from scratch every run | Low |
| Evaluation caching | Don't re-evaluate identical transcripts | Low |
| Haiku for Chain 2/3 (simulation) | 10× cheaper, fast enough for roleplay | Low |
| Approval gate before push | Safer for production agents | Medium |
| Prompt version history in DB | Persistent cross-session | Medium |
| Multi-agent batch flywheel | Run optimization across entire agent fleet overnight | High |
| Shadow traffic / canary rollout | Safe deployment for production agents | High |
| Fine-tuned evaluator | Replace generic Claude-as-judge with a specialized evaluator trained on voice AI QA | Very High |

---

## 9. File Structure

```
ghl_assignment/
├── server/
│   ├── index.ts                    # Express entry, static serving
│   ├── config.ts                   # Zod env validation
│   ├── logger.ts                   # Winston logger
│   ├── routes/
│   │   ├── auth.ts                 # OAuth flow (/auth, /redirect, /auth/status)
│   │   ├── agents.ts               # /api/agents, /api/settings/anthropic-key
│   │   └── simulation.ts           # GET /api/flywheel (SSE), GET /api/simulate
│   ├── services/
│   │   ├── sessionStore.ts         # In-memory token + API key store
│   │   ├── hlClient.ts             # HL API wrapper (OAuth, agents, PATCH)
│   │   ├── promptChains.ts         # 5 Claude chains + extractJSON + callWithRetry
│   │   └── simulationEngine.ts     # Flywheel orchestration + abort signal
│   └── middleware/
│       ├── auth.ts                 # requireAuth
│       └── api.ts                  # apiMiddleware + errorHandler
│
├── frontend/src/
│   ├── views/
│   │   ├── AgentList.vue           # Agent selection + API key entry
│   │   ├── Dashboard.vue           # 3-panel: test cases | transcript | KPI results
│   │   └── PromptHistory.vue       # Prompt version history + diff
│   ├── components/
│   │   ├── TestCaseCard.vue        # Card with Running/Analysing/Pass/Fail states
│   │   ├── TranscriptViewer.vue    # Auto-scrolling conversation viewer
│   │   ├── PromptDiff.vue          # Side-by-side diff using `diff` package
│   │   └── KpiResultBadge.vue
│   └── stores/copilot.js           # All app state (Pinia)
│
├── public/                         # Vite build output
├── railway.toml                    # Railway deployment config
├── DEMO_WALKTHROUGH.md             # Step-by-step demo script
├── ARCHITECTURE.md                 # This file
├── learnings.md                    # All decisions + tradeoffs log
└── README.md                       # Setup + deployment instructions
```
