# Voice AI Performance Optimizer — Agent Copilot

A **Validation Flywheel** that automates the Test and Optimize phases for HighLevel Voice AI agents. It analyzes an agent's system prompt, auto-generates test cases with KPIs, simulates multi-turn conversations, evaluates results, and auto-optimizes the prompt — all in one continuous loop.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    HighLevel Dashboard                       │
│                  (Custom JS sidebar widget)                  │
└──────────────────────┬──────────────────────────────────────┘
                       │ iframe
┌──────────────────────▼──────────────────────────────────────┐
│                Vue 3 SPA (Frontend)                          │
│   AgentList → Dashboard (3-panel) → Prompt History          │
│   Pinia store · SSE client · Real-time transcript viewer    │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP / SSE
┌──────────────────────▼──────────────────────────────────────┐
│              Express + TypeScript (Backend)                  │
│                                                              │
│  /auth          OAuth 2.0 flow with HL Marketplace          │
│  /api/agents    Fetch agents from HL Voice AI API           │
│  /api/flywheel  SSE stream — full validation flywheel       │
│  /api/optimize  One-shot optimize + auto-push to HL         │
└──────────┬───────────────────────────┬──────────────────────┘
           │                           │
┌──────────▼──────────┐   ┌───────────▼──────────────────────┐
│  HL Voice AI API     │   │     Anthropic Claude Sonnet 4.6  │
│  (agents read/write) │   │     5 prompt chains (see below)  │
└─────────────────────┘   └───────────────────────────────────┘
```

### Prompt Chain Pipeline

| Chain | Role | Input → Output |
|-------|------|----------------|
| 1 — Test Case Generator | QA Architect | Agent prompt → `[{ scenario, kpis[] }]` |
| 2 — User Simulator | Caller roleplay | Scenario + history → caller message |
| 3 — Agent Simulator | Agent roleplay | Agent prompt + history → agent response + `isConversationEnd` |
| 4 — KPI Evaluator | LLM-as-judge | Transcript + KPIs → `{ overall, kpiResults[], summary }` |
| 5 — Prompt Optimizer | Prompt engineer | Original prompt + failures + passing KPIs → improved prompt |

### Validation Flywheel Loop

```
Phase 1 — Fix Loop (up to 2 attempts):
  Generate 5 test cases → Run all → Collect failures
  → Optimize prompt (preserving passing KPIs) → Push to HL
  → Re-run ONLY failing cases → Repeat until fixed or attempts exhausted

Phase 2 — Harden Loop (up to 2 batches):
  Generate NEW test cases → Run them
  → If new failures: re-enter fix loop
  → If all pass: repeat with fresh cases
  → Final complete event with full results
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | TypeScript + Express + ts-node |
| Frontend | Vue 3 + Vite + Pinia |
| AI | Claude Sonnet 4.6 (Anthropic SDK) |
| Streaming | Server-Sent Events (SSE) |
| Auth | HighLevel OAuth 2.0 |
| Deployment | Railway (single service — backend serves frontend) |

---

## What Is Functional vs Mocked

| Feature | Status | Notes |
|---------|--------|-------|
| HL OAuth 2.0 | ✅ Real | Full token exchange + refresh |
| Fetch agents from HL API | ✅ Real | `GET /voice-ai/agents` |
| Push optimized prompt to HL | ✅ Real | `PATCH /voice-ai/agents/:id` |
| Test case generation | ✅ Real (LLM) | Claude generates scenarios + KPIs from prompt |
| Conversation simulation | 🟡 Simulated | Two Claude instances roleplay caller + agent (no actual phone calls) |
| KPI evaluation | ✅ Real (LLM) | Claude-as-judge evaluates full transcripts |
| Prompt optimization | ✅ Real (LLM) | Claude rewrites prompt targeting failures |

> Voice AI calls are simulated via LLM-vs-LLM conversation — acceptable per the assignment since HL Voice AI APIs don't expose real-time call simulation in sandbox.

---

## Team of One — Product, Design, Engineering & QA

**Product:** Defined the flywheel loop (fix → harden) based on the requirement to close the testing-to-optimization loop automatically. Chose auto-push over user confirmation to minimize friction.

**Design:** Built a 3-panel dashboard (Test Cases · Transcript · KPI Results) with live streaming — designed for observability so the user can watch the flywheel run in real time. Dark theme matching HL's aesthetic. Embedded as a sidebar widget so it feels native inside HL.

**Engineering:** TypeScript backend with SSE streaming, Zod-validated config, Winston structured logging, cooperative timeout strategy (flag-based, not Promise.race) so partial results are always preserved on timeout.

**QA:** The tool QAs itself — each flywheel run is its own validation pass. Architecture decisions logged in `decisions/learnings.md`. Prompt chain retries (2x) on JSON parse failures.

---

## Installation — HighLevel Sandbox Setup

### Prerequisites
- HighLevel agency account with Marketplace developer access
- A Voice AI agent already created in HL with a system prompt

### Step 1 — Install the App via HL Marketplace

The app is integrated into HighLevel natively using the **Custom Page** module in the HL Marketplace — this adds **Voice AI Optimizer** as a menu item in the sub-account's left sidebar.

1. Go to `marketplace.gohighlevel.com` → **My Apps** → open **voice ai optimizer**
2. Go to **Modules → Custom Page → + New custom page**
3. Fill in:
   - **Title:** `Voice AI Optimizer`
   - **Placement:** `Left menu navigation`
   - **Visible on:** `Sub-account Left Navigation Menu`
   - **Live URL:** `https://ghlassignment-production.up.railway.app`
   - **Testing URL:** `https://ghlassignment-production.up.railway.app`
4. Click **Save**
5. Install the app on your sub-account via **Advanced Settings → Auth → Install Link**
6. Navigate to your sub-account — **Voice AI Optimizer** appears in the left sidebar

### Step 2 — Connect Your HighLevel Account

1. Click **Voice AI Optimizer** in the left sidebar of your sub-account
2. Click **"Connect HighLevel"** — completes OAuth in a popup
3. After the popup closes, agents load automatically

### Step 3 — Run the Validation Flywheel

1. Select a Voice AI agent from the list
2. Click **"▶ Run Simulation"**
3. Watch the flywheel run live:
   - **Phase 1 (Fix Loop):** Generates 5 test cases → simulates conversations → evaluates KPIs → auto-optimizes and re-tests failing cases
   - **Phase 2 (Harden Loop):** Generates fresh test cases to stress-test the improved prompt
4. View **Prompt History** to see before/after versions with pass rates
5. The optimized prompt is **automatically pushed** to your HL Voice AI agent

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/auth` | Redirects to HL OAuth consent |
| GET | `/redirect` | OAuth callback — exchanges code for token |
| GET | `/auth/status` | Returns `{ authenticated, locationId }` |
| GET | `/auth/logout` | Clears session |
| GET | `/api/agents` | Lists all Voice AI agents |
| GET | `/api/flywheel?agentId=` | SSE stream — full validation flywheel |
| POST | `/api/optimize` | One-shot optimize + auto-push |

### SSE Events (`GET /api/flywheel`)

| Event | Payload |
|-------|---------|
| `status` | `{ message }` |
| `phase_change` | `{ phase: 'fix'\|'harden', attempt, total }` |
| `testcase_start` | `{ index, testCase: { scenario, kpis[] } }` |
| `turn` | `{ caseIndex, role: 'user'\|'assistant', content }` |
| `evaluated` | `{ index, evaluation: { overall, kpiResults[], summary } }` |
| `optimize_start` | `{ attempt }` |
| `optimize_complete` | `{ optimizedPrompt, attempt }` |
| `complete` | `{ testCases[], results[], failures[], currentPrompt, timedOut, completedCount }` |
| `error` | `{ message }` |

---

## Project Structure

```
ghl_assignment/
├── server/                      # TypeScript Express backend
│   ├── index.ts                 # Entry point + Express setup
│   ├── config.ts                # Zod-validated env config
│   ├── logger.ts                # Winston structured logger
│   ├── routes/
│   │   ├── auth.ts              # OAuth routes
│   │   ├── agents.ts            # Agent list/get
│   │   └── simulation.ts        # /flywheel + /optimize SSE endpoints
│   ├── services/
│   │   ├── sessionStore.ts      # In-memory token store
│   │   ├── hlClient.ts          # HL API Axios wrapper
│   │   ├── promptChains.ts      # 5 Claude chains
│   │   └── simulationEngine.ts  # Flywheel orchestration
│   └── middleware/
│       ├── auth.ts              # requireAuth guard
│       └── api.ts               # Request logging + error handler
├── frontend/                    # Vue 3 + Vite SPA
│   └── src/
│       ├── views/               # AgentList, Dashboard, PromptHistory
│       ├── components/          # TestCaseCard, TranscriptViewer, KpiResultBadge, PromptDiff
│       ├── stores/copilot.js    # Pinia store — all state + SSE handlers
│       └── router/index.js
├── public/                      # Vite build output (served by Express)
├── decisions/learnings.md       # Architecture decisions + bug fixes log
└── README.md
```

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `HL_CLIENT_ID` | ✅ | — | HL Marketplace app client ID |
| `HL_CLIENT_SECRET` | ✅ | — | HL Marketplace app client secret |
| `HL_REDIRECT_URI` | ✅ | `http://localhost:3000/redirect` | OAuth callback URL |
| `ANTHROPIC_API_KEY` | ✅ | — | Anthropic API key |
| `SESSION_SECRET` | — | `dev-secret` | Express session secret |
| `NUM_TEST_CASES` | — | `5` | Test cases per flywheel run |
| `MAX_TURNS_PER_CASE` | — | `15` | Max conversation turns per case |
| `PER_CASE_TIMEOUT_MS` | — | `120000` | Per-case timeout (ms) |
| `SIMULATION_TIMEOUT_MS` | — | `660000` | Total flywheel timeout (ms) |
| `MAX_OPTIMIZE_ATTEMPTS` | — | `2` | Fix loop attempts |
| `MAX_HARDEN_BATCHES` | — | `2` | Harden loop batches |
