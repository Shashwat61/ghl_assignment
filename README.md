# Voice AI Performance Optimizer — Agent Copilot

A **Validation Flywheel** that automates the Test and Optimize phases for HighLevel Voice AI agents. It reads an agent's live system prompt, auto-generates test cases with KPIs, simulates multi-turn conversations, evaluates results using LLM-as-Judge, and auto-optimizes the prompt — all in one continuous loop embedded natively inside HighLevel.

---

## Live Demo

**Deployed on Railway:** `https://ghlassignment-production.up.railway.app`

Access via the HighLevel Marketplace Custom Page — see [Installation](#installation--running-inside-highlevel) below.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│              HighLevel Sub-Account (Sidebar)                 │
│   ┌─────────────────────────────────────────────────────┐   │
│   │     Voice AI Optimizer (Custom Page — iframe)       │   │
│   │       Vue 3 SPA: AgentList → Dashboard              │   │
│   └───────────────────────┬─────────────────────────────┘   │
└───────────────────────────│─────────────────────────────────┘
                            │ HTTP + SSE
┌───────────────────────────▼─────────────────────────────────┐
│                Express + TypeScript (Railway)                │
│  /auth · /api/agents · /api/flywheel (SSE) · /api/optimize  │
└──────────────┬──────────────────────────┬───────────────────┘
               │                          │
    ┌──────────▼──────────┐   ┌───────────▼──────────────────┐
    │   HL Voice AI API   │   │  Anthropic Claude Sonnet 4.6  │
    │   (agents R/W)      │   │  5 prompt chains              │
    └─────────────────────┘   └──────────────────────────────┘
```

### The 5 Claude Prompt Chains

| # | Role | What Claude Does |
|---|---|---|
| 1 | QA Architect | Reads agent prompt → generates test cases with outcome-based KPIs |
| 2 | Caller Simulator | Roleplays a realistic caller, stays in character |
| 3 | Agent Simulator | Runs the actual HL system prompt as its instructions |
| 4 | **LLM-as-Judge** | Reads full transcript → scores each KPI pass/fail with reasoning |
| 5 | Prompt Engineer | Outputs a targeted JSON patch (insertions + replacements) to fix failures |

### Validation Flywheel

```
Generate 2 test cases (Chain 1)
  → Simulate full conversations (Chain 2 + 3)
  → Evaluate KPIs — LLM-as-Judge (Chain 4)
  → If failures: optimize prompt patch (Chain 5)  ← don't push yet
  → Re-run failing cases with SAME caller messages (deterministic A/B)
  → If all pass → push to HighLevel ✅
  → If still failing (attempt 2/2) → push best version only if it improved
```

**Key design decisions:**
- **Push only after passing** — optimized prompt never goes live speculatively
- **Caller message replay** — re-runs use exact same caller messages for a true A/B comparison
- **Patch-based optimization** — Chain 5 outputs `{insertions[], replacements[]}` not a full rewrite (~4× faster)
- **Abort on disconnect** — `AbortController` cancels all in-flight Claude calls immediately when browser closes/refreshes

> For a deeper dive — pros/cons of every decision, SSE data flow, and what a production-grade version of this would look like — see **[ARCHITECTURE.md](./ARCHITECTURE.md)**.

---

## What Is Real vs Simulated

| Feature | Status | Notes |
|---|---|---|
| HL OAuth 2.0 | ✅ **Real** | Full token exchange + refresh |
| Fetch agents from HL | ✅ **Real** | `GET /voice-ai/agents` live API |
| Push optimized prompt | ✅ **Real** | `PATCH /voice-ai/agents/:id` |
| Test case generation | ✅ **Real** | Claude reads the actual live prompt |
| Conversation simulation | 🟡 **Simulated** | Two Claude instances roleplay — HL doesn't expose real-time call simulation in sandbox. Confirmed acceptable per assignment clarifications. |
| KPI evaluation | ✅ **Real** | LLM-as-Judge on full transcripts |
| Prompt optimization | ✅ **Real** | Claude patches targeting actual failure evidence |

---

## Installation — Running Inside HighLevel

### Step 1 — Install the Marketplace App

1. Open this install link in your browser (log in to HighLevel if prompted):
   [Install Voice AI Optimizer](https://marketplace.gohighlevel.com/oauth/chooselocation?response_type=code&redirect_uri=https%3A%2F%2Fghlassignment-production.up.railway.app%2Fredirect&client_id=69a04ea04cec9149c3512b09-mm3ipmsa&scope=conversations.readonly+conversations.write+conversations%2Fmessage.readonly+conversations%2Fmessage.write+conversations%2Freports.readonly+conversations%2Flivechat.write+voice-ai-dashboard.readonly+voice-ai-agents.readonly+voice-ai-agents.write+voice-ai-agent-goals.readonly+voice-ai-agent-goals.write&version_id=69a04ea04cec9149c3512b09)
2. Select a sub-account to install to and click **Install**. You will be redirected — that's expected.
3. Navigate to `app.gohighlevel.com` → your sub-account. **Voice AI Optimizer** will appear at the bottom of the left sidebar.

> **Note:** The app only runs embedded inside HighLevel. Opening the Railway URL directly will show a "not embedded" screen — this is intentional.

### Step 2 — Enter Your Anthropic API Key

The app requires your own Anthropic API key. It is stored only in memory for the session and never persisted.

1. Click **Voice AI Optimizer** in the HL sidebar to open the app
2. Connect your HL account via the OAuth popup
3. Enter your `sk-ant-` API key when prompted
4. Get a key at [console.anthropic.com](https://console.anthropic.com)

### Step 3 — Run the Flywheel

1. Select a Voice AI agent that has a system prompt
2. Click **▶ Run Simulation**
3. Watch the flywheel stream live — conversations, KPI scores, optimization, push
4. Click the active prompt strip to view the full prompt or diff after optimization

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | TypeScript · Express · ts-node |
| Frontend | Vue 3 · Vite · Pinia |
| AI | Claude Sonnet 4.6 (Anthropic SDK) |
| Streaming | Server-Sent Events (SSE) |
| Auth | HighLevel OAuth 2.0 |
| Deployment | Railway (backend serves built frontend) |

---

## Project Structure

```
ghl_assignment/
├── server/
│   ├── index.ts                 # Express entry + static serving
│   ├── config.ts                # Zod-validated env config
│   ├── routes/
│   │   ├── auth.ts              # OAuth (/auth, /redirect, /auth/status)
│   │   ├── agents.ts            # /api/agents, /api/settings/anthropic-key
│   │   └── simulation.ts        # /api/flywheel (SSE), /api/optimize
│   └── services/
│       ├── sessionStore.ts      # In-memory token + API key
│       ├── hlClient.ts          # HL API wrapper
│       ├── promptChains.ts      # 5 Claude chains + retry logic
│       └── simulationEngine.ts  # Flywheel orchestration + abort signal
├── frontend/src/
│   ├── views/                   # AgentList, Dashboard, PromptHistory
│   ├── components/              # TestCaseCard, TranscriptViewer, PromptDiff
│   └── stores/copilot.js        # All state + SSE event handlers
├── public/                      # Vite build output (served by Express)
├── ARCHITECTURE.md              # Full system design + production architecture
├── DEMO_WALKTHROUGH.md          # Step-by-step demo script with talking points
├── learnings.md                 # All architectural decisions + tradeoffs log
└── railway.toml                 # Railway deployment config
```

---

## Environment Variables

> **Reviewers:** You only need to supply your Anthropic API key — entered in the app UI, not `.env`. All HL credentials are pre-configured on the Railway deployment.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `HL_CLIENT_ID` | ✅ | — | Pre-set on Railway |
| `HL_CLIENT_SECRET` | ✅ | — | Pre-set on Railway |
| `HL_REDIRECT_URI` | ✅ | `http://localhost:3000/redirect` | Pre-set on Railway |
| `ANTHROPIC_API_KEY` | — | `''` | Optional env fallback — app uses key entered in UI |
| `NUM_TEST_CASES` | — | `2` | Test cases per run |
| `MAX_OPTIMIZE_ATTEMPTS` | — | `2` | Fix loop cap |
| `MAX_TURNS_PER_CASE` | — | `15` | Safety cap on conversation length |
| `PER_CASE_TIMEOUT_MS` | — | `120000` | 2 min per case |
| `SIMULATION_TIMEOUT_MS` | — | `660000` | 11 min total flywheel timeout |
