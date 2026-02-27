# HighLevel Voice AI Agent Performance Copilot — Implementation Plan (v2)

## Context
Build a "Validation Flywheel" copilot that automates testing and optimization of HighLevel Voice AI agent prompts. The tool fetches an agent's system prompt, generates test cases via Claude, simulates multi-turn conversations (Claude-vs-Claude), evaluates results against KPIs, and auto-pushes an optimized prompt to HL. The user sees a before/after diff in ResultView — but the push happens automatically (no confirm step).

**Confirmed choices:** Claude (claude-sonnet-4-6), Express serves frontend static files, 5 test cases per run, 120s simulation timeout, hosted deployment (Vercel + Railway/Render).

---

## Key Decisions vs Original Plan

| Decision | Original Plan | Updated (from context file) |
|---|---|---|
| Post-optimize flow | User reviews diff → clicks "Confirm and Push" | Auto-push after optimize; ResultView shows diff of what was pushed |
| `/api/confirm` route | Exists | **Removed** — push happens inside `POST /api/optimize` |
| OAuth callback path | `/redirect` | Keep `/redirect` (matches HL app config); alias `/auth/callback` → same handler |
| Hosting | localhost demo only | Must have hosted URL (Vercel frontend + Railway/Render backend) |
| Simulation timeout | Not specified | 120s configurable per simulation run |
| Widget embedding | Standalone app | Vue app embedded into HL UI via Custom JS module |
| Backend language | JavaScript | **TypeScript** with Zod env validation |

---

## Project File Structure

```
ghl_assignment/
├── package.json                    # Backend deps + scripts (TypeScript)
├── tsconfig.json                   # TypeScript compiler config
├── .env                            # Secrets (gitignored)
├── .env.example                    # Committed template
├── .gitignore
├── README.md
├── plan.md                         # This file
├── decisions/
│   └── learnings.md               # All decisions + tradeoffs
│
├── server/                         # TypeScript Express backend
│   ├── index.ts                    # Express entry: mounts routes, serves /public static
│   ├── config.ts                   # Zod-validated env, exports constants
│   ├── routes/
│   │   ├── auth.ts                 # GET /auth, GET /redirect, GET /auth/callback, GET /auth/status, GET /auth/logout
│   │   ├── agents.ts               # GET /api/agents, GET /api/agents/:id
│   │   └── simulation.ts           # GET /api/simulate (SSE), POST /api/optimize (auto-pushes)
│   ├── services/
│   │   ├── sessionStore.ts         # In-memory Map: { accessToken, refreshToken, expiresAt, locationId }
│   │   ├── hlClient.ts             # Axios wrapper for HL API
│   │   ├── promptChains.ts         # All 5 Claude chains + extractJSON helper
│   │   └── simulationEngine.ts     # Orchestrates pipeline, 120s timeout, aggregates failures
│   └── middleware/
│       ├── auth.ts                 # requireAuth: checks sessionStore.hasValidToken
│       └── api.ts                  # apiMiddleware: request logging/tracing; errorHandler: global error handler
│
├── frontend/                       # Vue 3 + Vite SPA
│   ├── package.json                # Vue 3 + Vite + Pinia + vue-router + diff + axios
│   ├── vite.config.js              # outDir: ../public; proxy /api + /auth + /redirect → :3000
│   ├── index.html
│   └── src/
│       ├── main.js
│       ├── App.vue                 # router-view + StatusBar
│       ├── router/index.js         # /, /dashboard, /result
│       ├── stores/copilot.js       # Pinia store
│       ├── views/
│       │   ├── AgentList.vue       # Grid of AgentCards; "Connect HighLevel" if not authed
│       │   ├── Dashboard.vue       # 3-panel: test cases | live transcripts | KPI results
│       │   └── ResultView.vue      # Side-by-side diff (auto-pushed, no confirm button)
│       └── components/
│           ├── AgentCard.vue
│           ├── TestCaseCard.vue
│           ├── TranscriptViewer.vue
│           ├── KpiResultBadge.vue
│           ├── PromptDiff.vue      # Uses `diff` npm pkg
│           └── StatusBar.vue
│
└── public/                         # Vite build output (gitignored except .gitkeep)
```

---

## Dependencies

### Backend (`package.json`)
```json
{
  "type": "commonjs",
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "axios": "^1.7.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.0",
    "express": "^4.18.0",
    "express-session": "^1.18.0",
    "uuid": "^10.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/express-session": "^1.18.0",
    "@types/node": "^20.12.0",
    "@types/uuid": "^10.0.0",
    "ts-node": "^10.9.2",
    "typescript": "^5.4.0"
  }
}
```

### Frontend (`frontend/package.json`)
```json
{
  "type": "module",
  "dependencies": {
    "vue": "^3.4.0", "vue-router": "^4.3.0", "pinia": "^2.1.0",
    "axios": "^1.7.0", "diff": "^5.2.0", "@vueuse/core": "^10.9.0"
  },
  "devDependencies": { "@vitejs/plugin-vue": "^5.0.0", "vite": "^5.2.0" }
}
```

---

## Environment Variables (`.env.example`)
```
HL_CLIENT_ID=
HL_CLIENT_SECRET=
HL_REDIRECT_URI=http://localhost:3000/redirect
ANTHROPIC_API_KEY=
SESSION_SECRET=replace-with-random-string
PORT=3000
CONVERSATION_TURNS=6
NUM_TEST_CASES=5
SIMULATION_TIMEOUT_MS=120000
```

---

## The 5 Claude Prompt Chains (`server/services/promptChains.ts`)

All chains use `claude-sonnet-4-6`. JSON responses wrapped in `extractJSON()` (strips markdown fences, falls back to regex match, max 2 retries).

### Chain 1 — Generate Test Cases
- **Input:** `agentPrompt`, `numCases`
- **Output:** `Array<{ scenario, kpis[] }>` (5 items)
- **Persona:** QA architect

### Chain 2 — Simulate User Turn
- **Input:** `scenario`, `history`
- **Output:** `userMessage` string (1-3 sentences)
- **Persona:** Caller who never breaks character

### Chain 3 — Simulate Agent Turn
- **Input:** `agentPrompt` (used as system prompt), `history`
- **Output:** `agentResponse` string
- **Persona:** Claude embodies the HL agent faithfully

### Chain 4 — Evaluate Transcript
- **Input:** `transcript`, `kpis[]`, `scenario`
- **Output:** `{ overall: 'pass'|'fail', kpiResults: [{kpi, result, reasoning}], summary }`
- **Persona:** Objective QA evaluator; `overall` = fail if ANY KPI fails

### Chain 5 — Optimize Prompt
- **Input:** `originalPrompt`, `failures[]` `{scenario, kpi, reasoning}`
- **Output:** Raw improved prompt string (no preamble, drop-in replacement)
- **Persona:** Expert prompt engineer

---

## Simulation Engine (`server/services/simulationEngine.ts`)

```
runFullSimulation(agentPrompt, onProgress):
  - Wraps entire run in Promise.race with 120s timeout
  1. Chain 1 → testCases[]
  2. For each testCase (0..NUM_TEST_CASES-1):
     a. Loop CONVERSATION_TURNS times:
        - Chain 2 → userMessage → push to history + transcript
        - Chain 3 → agentResponse → push to history + transcript
        - onProgress('turn', { caseIndex, role, content })
     b. Chain 4 → evaluation
     c. onProgress('evaluated', { index, evaluation })
  3. Aggregate failures (all fail KPIs across all cases)
  4. Return { testCases, results, failures }

generateOptimizedPrompt(originalPrompt, failures):
  → Chain 5 → optimizedPrompt string
```

---

## Key Route Details

### `GET /auth`
Redirects to HL OAuth consent URL with required scopes.

### `GET /redirect` ← HL OAuth callback
1. Exchange `code` → tokens via `hlClient.exchangeCode()`
2. Store `{ accessToken, refreshToken, expiresAt, locationId }` in sessionStore
3. `res.redirect('/')` → back to Vue SPA

### `GET /api/agents` + `GET /api/agents/:id`
Protected by `requireAuth` middleware. Proxies HL API calls.

### `GET /api/simulate?agentId=xxx` (SSE)
- Headers: `Content-Type: text/event-stream`
- Events: `status`, `testcase_start`, `turn`, `evaluated`, `complete`, `error`
- Heartbeat: `': ping\n\n'` every 15s
- Timeout: 120s (config-driven)

### `POST /api/optimize` ← **AUTO-PUSHES, no confirm step**
Body: `{ agentId, failures, originalPrompt }`
1. Calls Chain 5 → optimizedPrompt
2. Calls `hlClient.updateAgent(agentId, optimizedPrompt)` immediately
3. Returns `{ optimizedPrompt, originalPrompt }` (for diff display in ResultView)

---

## Frontend State Flow

```
AgentList → (selectAgent) → Dashboard → (POST /api/optimize) → ResultView
                                ↑ SSE populates results/failures    ↑ shows diff of pushed prompt
```

**Pinia store (`stores/copilot.js`) key state:**
```js
{
  isAuthenticated: false,
  agents: [],
  selectedAgent: null,
  simulationStatus: 'idle',      // 'idle'|'running'|'done'|'error'
  testCases: [],
  liveTranscripts: {},           // { [caseIndex]: [{role, content}] }
  results: [],
  failures: [],
  originalPrompt: '',
  optimizedPrompt: '',
  optimizationStatus: 'idle',    // 'idle'|'optimizing'|'done'|'error'
}
```

**ResultView.vue** — shows diff only, no confirm button. Displays success notice that prompt was already pushed.

---

## Middleware

### `server/middleware/auth.ts`
`requireAuth` — checks `sessionStore.hasValidToken()`. Returns 401 if not authenticated.

### `server/middleware/api.ts`
- `apiMiddleware` — attaches UUID request ID, logs request/response with duration
- `errorHandler` — global Express error handler, returns JSON error responses

---

## Environment Validation
`server/config.ts` uses **Zod** to validate all environment variables at startup. Invalid or missing required vars cause an immediate `process.exit(1)` with a clear error message.

---

## decisions/learnings.md — Tracking Agent

See `decisions/learnings.md` for all architectural decisions with context, tradeoffs, and file impact.

Initial entries:
1. Auto-push vs user-confirm
2. SSE vs WebSocket for simulation streaming
3. In-memory store vs DB
4. Hosting approach (widget vs standalone)
5. Simulation timeout strategy
6. TypeScript for backend

---

## Implementation Order

1. ✅ Create `decisions/learnings.md` with initial entries
2. ✅ `package.json` + `tsconfig.json` + `.env.example` + `.gitignore`
3. ✅ `server/config.ts` (Zod validation) + `server/services/sessionStore.ts`
4. ✅ `server/services/hlClient.ts`
5. ✅ `server/middleware/auth.ts` + `server/middleware/api.ts` + `server/routes/auth.ts` + `server/routes/agents.ts` + `server/index.ts`
6. ✅ `server/services/promptChains.ts`
7. ✅ `server/services/simulationEngine.ts` (with 120s timeout)
8. ✅ `server/routes/simulation.ts` (SSE + auto-push optimize)
9. ✅ Frontend scaffold: `vite.config.js`, `main.js`, `router`, `stores/copilot.js`
10. ✅ `AgentList.vue` + `AgentCard.vue`
11. ✅ `Dashboard.vue` + `TranscriptViewer.vue` + `TestCaseCard.vue` + `KpiResultBadge.vue`
12. ✅ `ResultView.vue` + `PromptDiff.vue` (no confirm button)
13. ✅ `StatusBar.vue` + `App.vue`
14. ✅ `README.md` + `plan.md`

---

## Verification / Demo Script

```bash
npm run setup
cp .env.example .env   # fill credentials
npm run demo           # builds frontend + starts :3000
open http://localhost:3000
```

1. Click "Connect HighLevel" → consent → back to app (status bar: connected)
2. Select agent → Dashboard
3. "Run Simulation" → 5 test cases stream live, 60 turns, KPI badges
4. "Optimize Prompt" → auto-pushes → navigates to ResultView with diff
5. ResultView shows before/after diff + "Prompt pushed to HighLevel ✓" notice

---

## Edge Cases and Mitigations

| Risk | Mitigation |
|---|---|
| `locationId` missing from OAuth response | Check HL userinfo endpoint; store whatever HL returns |
| Claude returns non-JSON (Chain 1/4) | `extractJSON()` strips fences; max 2 retries |
| SSE drops mid-simulation | 15s heartbeat ping; EventSource auto-reconnects |
| HL PUT body shape unknown | Mirror GET response; only mutate prompt field |
| Token expiry mid-demo | `requireAuth` checks `expiresAt`; auto-refresh on 401 |
| Simulation too slow for demo | `CONVERSATION_TURNS` + `NUM_TEST_CASES` env vars for fast-demo mode |
| 120s timeout hit | SSE `error` event emitted; partial results shown |
| Invalid env vars | Zod schema validates at startup; process exits with clear error |
