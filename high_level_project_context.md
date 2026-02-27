# HighLevel Voice AI Performance Optimizer — Project Context

## Assignment Summary
Build an **Agent Performance Copilot** that automates the "Test" and "Optimize" phases for HighLevel Voice AI agents. It's a "Validation Flywheel" — auto-generates test cases from an agent's prompt, simulates multi-turn conversations, evaluates against KPIs, and auto-optimizes the prompt using an LLM.

**Deliverables:**
- Full JS code for widget + backend
- Backend: Node.js + Express
- Frontend: Vue.js (embedded into HL via Custom JS module)
- README with architecture notes
- 2-5 min demo showing: analyze prompt → test cases → before/after optimization

---

## Stack
- **Backend:** Node.js + Express
- **Frontend:** Vue.js (injected into HL UI via Marketplace Custom JS module)
- **LLM:** OpenAI or Claude (to be confirmed with hiring team)
- **Storage:** In-memory only (JS Map/object) — no DB needed
- **Auth:** OAuth2.0 with HighLevel

---

## HighLevel Setup (Already Done)
- Marketplace developer account created
- App created (currently in DRAFT) with the following scopes:
  - `voice-ai-dashboard.readonly`
  - `voice-ai-agents.readonly`
  - `voice-ai-agents.write`
  - `voice-ai-agent-goals.readonly`
  - `voice-ai-agent-goals.write`
  - `conversations.readonly`
  - `conversations.write`
  - `conversations/message.readonly`
  - `conversations/message.write`
  - `conversations/reports.readonly`
  - `conversations/livechat.write`
- Client ID and Client Secret obtained (from Profile page in Marketplace)
- Redirect URL set: `http://localhost:3000/redirect`

---

## Architecture

### Backend — 4 Modules

**1. OAuth Module**
```
GET /auth → redirect to HL OAuth consent screen
GET /auth/callback → exchange code for access token → store in memory
POST /auth/refresh → refresh token logic
```

**2. HL API Module**
```
getAgents()               → GET /voice-ai/agents
getAgentPrompt(agentId)   → GET /voice-ai/agents/:id
updateAgentPrompt(agentId, newPrompt) → PUT /voice-ai/agents/:id
```

**3. Simulation Engine (Core)**
```
generateTestCases(agentPrompt)
  → LLM call → returns array of [{ scenario, kpis }]

runConversation(agentPrompt, scenario)
  → loop N turns (5-8):
      userMessage   = UserLLM.chat(scenario, history)   // LLM plays user
      agentResponse = AgentLLM.chat(agentPrompt, history) // LLM plays agent
      history.push(both messages)
  → returns full transcript

evaluateTranscript(transcript, kpis)
  → LLM call → returns { kpi: pass/fail, reasoning } structured JSON
```

**4. Optimizer**
```
optimizePrompt(agentPrompt, allFailures)
  → LLM call → returns improved prompt string
```

### Frontend — Vue.js, 3 Views
```
AgentList   → user selects which agent to optimize
Dashboard   → shows test cases, runs simulation, displays transcripts + KPI results
ResultView  → before/after prompt comparison + confirm button to push to HL
```

---

## Core Loop (End to End)
```
1. User selects agent from list
2. Fetch agent prompt from HL API
3. LLM generates N test cases + KPIs from the prompt
4. For each test case:
   a. Run multi-turn conversation simulation (user LLM vs agent LLM)
   b. Evaluate full transcript against KPIs (LLM-as-judge)
5. Aggregate all failures across test cases
6. LLM generates optimized prompt fixing all failures
7. Show before/after prompt diff to user
8. User confirms → write optimized prompt back to HL API
```

---

## Key Design Decisions
- **Auto-push confirmed** — LLM generates optimized prompt and automatically pushes it to HL without user confirmation.
- **Conversation simulation is LLM-based, not real calls** — Two LLM instances roleplay user and agent across multiple turns. This is acceptable per the assignment ("note what is functional vs mocked").
- **No DB** — All test results, transcripts, KPI scores stored in-memory for the session. Enough for demo purposes.

---

## Prompt Chaining Logic
1. **Generate test cases:** `agentPrompt` → LLM → `[{scenario, kpis}]`
2. **Simulate user turn:** `scenario + history` → UserLLM → `userMessage`
3. **Simulate agent turn:** `agentPrompt + history` → AgentLLM → `agentResponse`
4. **Evaluate:** `transcript + kpis` → EvaluatorLLM → `{pass/fail per KPI}`
5. **Optimize:** `agentPrompt + allFailures` → OptimizerLLM → `improvedPrompt`

---

## Clarifications (Confirmed by Hiring Team)
1. **Express.js** — confirmed fine
2. **LLM provider** — our choice
3. **Conversation simulation** — mocking is acceptable (HL Voice AI APIs won't work in sandbox anyway). Can also read agent data through UI if needed.
4. **Auto-push** — optimized prompt should auto-push to HL, no manual confirmation needed
5. **Widget scope** — only within HL UI, no standalone app needed
6. **Test cases** — 5 per agent
7. **Conversation timeout** — 120 seconds configurable timeout per simulation
8. **Hosting** — must be hosted URL (Vercel for frontend, Railway or Render for backend). Localhost is NOT acceptable for final demo.

---

## Next Steps (Start Here)
1. Scaffold Express project
2. Implement OAuth flow (`/auth` → `/auth/callback` → store token in memory)
3. Test HL API — verify you can fetch agents list with a real token
4. Build simulation engine (generate 5 test cases → run conversation with 120s timeout → evaluate)
5. Build Vue.js widget (AgentList → Dashboard → ResultView)
6. Configure Custom JS module in HL Marketplace app to load the Vue widget from hosted URL
7. Deploy backend to Railway/Render, frontend to Vercel
8. End-to-end demo run

---

## HL API Reference
- Docs: https://marketplace.gohighlevel.com/docs/Authorization/OAuth2.0
- API base: `https://services.leadconnectorhq.com`
- Auth header: `Authorization: Bearer {access_token}`
- API version header: `Version: 2021-07-28`
