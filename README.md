# GHL Voice AI Agent Performance Copilot

A **Validation Flywheel** copilot that automates testing and optimization of HighLevel Voice AI agent prompts.

## What It Does

1. **Fetches** an agent's system prompt from HighLevel
2. **Generates** 5 test cases via Claude (QA architect persona)
3. **Simulates** multi-turn conversations (Claude-vs-Claude, 6 turns each)
4. **Evaluates** each conversation against KPIs
5. **Auto-pushes** an optimized prompt to HighLevel when failures are found
6. **Shows** a before/after diff in ResultView

---

## Tech Stack

- **Backend:** TypeScript + Express
- **Frontend:** Vue 3 + Vite + Pinia
- **AI:** Claude Sonnet 4.6 (via Anthropic SDK)
- **Streaming:** Server-Sent Events (SSE)
- **Auth:** HighLevel OAuth 2.0

---

## Quick Start

### 1. Install Dependencies

```bash
npm run setup
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Fill in your credentials:

```
HL_CLIENT_ID=your_hl_client_id
HL_CLIENT_SECRET=your_hl_client_secret
HL_REDIRECT_URI=http://localhost:3000/redirect
ANTHROPIC_API_KEY=your_anthropic_api_key
SESSION_SECRET=your-random-secret-string
```

### 3. Development Mode

Run backend and frontend separately:

```bash
# Terminal 1: Backend (TypeScript with ts-node)
npm run dev

# Terminal 2: Frontend (Vite dev server with proxy)
cd frontend && npm run dev
# Open http://localhost:5173
```

### 4. Production / Demo Mode

```bash
npm run demo
# Builds frontend → public/, then starts Express serving everything at :3000
open http://localhost:3000
```

---

## Demo Script

1. Open `http://localhost:3000`
2. Click **"Connect HighLevel"** → Complete OAuth consent → Returns to app (status bar shows "Connected")
3. Select an agent from the grid → Navigates to Dashboard
4. Click **"Run Simulation"** → Watch 5 test cases stream live with conversation turns and KPI badges
5. Click **"Optimize Prompt"** → Auto-pushes → Navigates to ResultView
6. ResultView shows before/after diff + **"Prompt pushed to HighLevel ✓"** notice

---

## Fast Demo Mode

To speed up simulation (fewer turns/cases):

```bash
CONVERSATION_TURNS=2 NUM_TEST_CASES=2 npm run demo
```

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/auth` | Redirects to HL OAuth |
| GET | `/redirect` | OAuth callback (HL app config) |
| GET | `/auth/callback` | Alias for `/redirect` |
| GET | `/auth/status` | Returns auth state |
| GET | `/auth/logout` | Clears session |
| GET | `/api/agents` | Lists all Voice AI agents |
| GET | `/api/agents/:id` | Gets a single agent |
| GET | `/api/simulate?agentId=` | SSE stream — full simulation |
| POST | `/api/optimize` | Optimize + auto-push to HL |

### SSE Events (`GET /api/simulate`)

| Event | Payload |
|-------|---------|
| `status` | `{ message: string }` |
| `testcase_start` | `{ index: number, testCase: { scenario, kpis[] } }` |
| `turn` | `{ caseIndex: number, role: 'user'\|'assistant', content: string }` |
| `evaluated` | `{ index: number, evaluation: { overall, kpiResults[], summary } }` |
| `complete` | `{ testCases[], results[], failures[] }` |
| `error` | `{ message: string }` |

---

## Project Structure

```
ghl_assignment/
├── server/                    # TypeScript Express backend
│   ├── index.ts               # Entry point
│   ├── config.ts              # Zod-validated env config
│   ├── routes/
│   │   ├── auth.ts            # OAuth routes
│   │   ├── agents.ts          # Agent CRUD
│   │   └── simulation.ts      # SSE simulate + optimize
│   ├── services/
│   │   ├── sessionStore.ts    # In-memory token store
│   │   ├── hlClient.ts        # HL API Axios wrapper
│   │   ├── promptChains.ts    # 5 Claude chains
│   │   └── simulationEngine.ts # Orchestration + timeout
│   └── middleware/
│       ├── auth.ts            # requireAuth guard
│       └── api.ts             # Request logging + error handler
├── frontend/                  # Vue 3 + Vite SPA
│   └── src/
│       ├── views/             # AgentList, Dashboard, ResultView
│       ├── components/        # AgentCard, TestCaseCard, PromptDiff, etc.
│       ├── stores/copilot.js  # Pinia store
│       └── router/index.js
├── public/                    # Vite build output (served by Express)
├── decisions/learnings.md     # Architecture decisions log
└── plan.md                    # Full implementation plan
```

---

## Deployment

### Vercel (Frontend) + Railway/Render (Backend)

1. **Backend (Railway/Render):**
   - Set all env vars in dashboard
   - Start command: `npm start` (runs `node dist/server/index.js`)
   - Build command: `npm run build:server`
   - Update `HL_REDIRECT_URI` to your Railway/Render URL

2. **Frontend (Vercel):**
   - Build command: `cd frontend && npm run build`
   - Output directory: `public`
   - Set `VITE_API_BASE_URL` to your Railway/Render URL if deploying separately

3. **HighLevel App Config:**
   - Redirect URI: `https://your-backend.railway.app/redirect`
   - Add your hosted URL as Custom JS module for widget embedding

### HighLevel Widget Embedding

Add to HL Custom JS:
```html
<script>
  // Load the copilot as an embedded widget
  const iframe = document.createElement('iframe');
  iframe.src = 'https://your-deployed-url.com';
  iframe.style = 'width:100%;height:600px;border:none;';
  document.body.appendChild(iframe);
</script>
```
