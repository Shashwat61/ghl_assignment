import { defineStore } from 'pinia';
import axios from 'axios';

export const useCopilotStore = defineStore('copilot', {
  state: () => ({
    // Auth
    isAuthenticated: false,
    locationId: null,
    userId: null,

    // Agents
    agents: [],
    selectedAgent: null,

    // Simulation
    simulationStatus: 'idle', // 'idle' | 'running' | 'done' | 'error'
    simulationError: null,
    simulationTimedOut: false,
    simulationCompletedCount: 0,
    testCases: [],
    liveTranscripts: {}, // { [caseIndex]: [{role, content}] }
    results: [],
    failures: [],

    // Optimization
    originalPrompt: '',
    optimizedPrompt: '',
    optimizationStatus: 'idle', // 'idle' | 'optimizing' | 'done' | 'error'
    optimizationError: null,

    // Flywheel phase progress
    flywheelPhase: null, // 'fix' | 'harden' | null
    flywheelAttempt: 0,
    flywheelTotal: 0,
    flywheelStatusMessage: '',

    // Prompt history (in-memory, per agent session)
    // [{ prompt, label, timestamp, passRate, failures }]
    promptHistory: [],
  }),

  getters: {
    passCount: (state) => state.results.filter((r) => r.overall === 'pass').length,
    failCount: (state) => state.results.filter((r) => r.overall === 'fail').length,
    passRate: (state) => {
      if (state.results.length === 0) return 0;
      return Math.round(
        (state.results.filter((r) => r.overall === 'pass').length / state.results.length) * 100,
      );
    },
    hasFailures: (state) => state.failures.length > 0,
    transcriptForCase: (state) => (index) => state.liveTranscripts[index] || [],
    activePrompt: (state) =>
      state.promptHistory.length > 0
        ? state.promptHistory[state.promptHistory.length - 1].prompt
        : state.originalPrompt,
  },

  actions: {
    async checkAuth() {
      try {
        const { data } = await axios.get('/auth/status');
        this.isAuthenticated = data.authenticated;
        this.locationId = data.locationId || null;
        this.userId = data.userId || null;
      } catch {
        this.isAuthenticated = false;
      }
    },

    async fetchAgents() {
      const { data } = await axios.get('/api/agents');
      this.agents = data.agents || [];
    },

    selectAgent(agent) {
      this.selectedAgent = agent;
      this.resetSimulation();
    },

    resetSimulation() {
      this.simulationStatus = 'idle';
      this.simulationError = null;
      this.simulationTimedOut = false;
      this.simulationCompletedCount = 0;
      this.testCases = [];
      this.liveTranscripts = {};
      this.results = [];
      this.failures = [];
      this.originalPrompt = '';
      this.optimizedPrompt = '';
      this.optimizationStatus = 'idle';
      this.optimizationError = null;
      this.flywheelPhase = null;
      this.flywheelAttempt = 0;
      this.flywheelTotal = 0;
      this.flywheelStatusMessage = '';
      this.promptHistory = [];
    },

    startSimulation() {
      if (!this.selectedAgent) return;
      this.simulationStatus = 'running';
      this.simulationError = null;
      this.testCases = [];
      this.liveTranscripts = {};
      this.results = [];
      this.failures = [];
      // Capture prompt at run time — use active (optimized) or agent's original
      const agentPrompt = this.selectedAgent.systemPrompt || this.selectedAgent.description || '';
      if (!this.originalPrompt) {
        this.originalPrompt = agentPrompt;
      }
    },

    handleSSEEvent(eventType, data) {
      switch (eventType) {
        case 'testcase_start':
          this.testCases[data.index] = data.testCase;
          this.liveTranscripts[data.index] = [];
          break;

        case 'turn':
          if (!this.liveTranscripts[data.caseIndex]) {
            this.liveTranscripts[data.caseIndex] = [];
          }
          this.liveTranscripts[data.caseIndex].push({
            role: data.role,
            content: data.content,
          });
          break;

        case 'evaluated':
          this.results[data.index] = data.evaluation;
          break;

        case 'complete': {
          this.testCases = data.testCases;
          this.results = data.results;
          this.failures = data.failures;
          this.simulationTimedOut = data.timedOut || false;
          this.simulationCompletedCount = data.completedCount ?? data.results.length;
          this.simulationStatus = 'done';
          this.flywheelPhase = null;
          this.optimizationStatus = 'idle';

          const finalPassRate = data.results.length > 0
            ? Math.round((data.results.filter((r) => r.overall === 'pass').length / data.results.length) * 100)
            : 0;

          // Record original prompt in history on first simulation
          if (this.promptHistory.length === 0 && this.originalPrompt) {
            this.promptHistory.push({
              prompt: this.originalPrompt,
              label: 'v1 · Original',
              timestamp: new Date().toISOString(),
              passRate: finalPassRate,
              failures: data.failures,
            });
          }

          // Update pass rate on the last history entry (the active/optimized prompt)
          if (this.promptHistory.length > 0) {
            const last = this.promptHistory[this.promptHistory.length - 1];
            last.passRate = finalPassRate;
          }

          // Sync currentPrompt from flywheel if provided
          if (data.currentPrompt && data.currentPrompt !== this.originalPrompt) {
            this.optimizedPrompt = data.currentPrompt;
          }
          break;
        }

        case 'phase_change':
          this.flywheelPhase = data.phase;
          this.flywheelAttempt = data.attempt;
          this.flywheelTotal = data.total;
          break;

        case 'optimize_start':
          this.optimizationStatus = 'optimizing';
          break;

        case 'optimize_complete': {
          this.optimizationStatus = 'done';
          this.optimizedPrompt = data.optimizedPrompt;
          const version = this.promptHistory.length + 1;
          this.promptHistory.push({
            prompt: data.optimizedPrompt,
            label: `v${version} · Optimized`,
            timestamp: new Date().toISOString(),
            passRate: null,
            failures: this.failures,
          });
          break;
        }

        case 'status':
          this.flywheelStatusMessage = data.message;
          break;

        case 'error':
          this.simulationStatus = 'error';
          this.simulationError = data.message;
          break;
      }
    },

    async optimizePrompt() {
      if (!this.selectedAgent || this.failures.length === 0) return;

      this.optimizationStatus = 'optimizing';
      this.optimizationError = null;

      const agentPrompt =
        this.selectedAgent.systemPrompt ||
        this.selectedAgent.description ||
        'You are a helpful voice AI assistant.';

      this.originalPrompt = agentPrompt;

      try {
        const { data } = await axios.post('/api/optimize', {
          agentId: this.selectedAgent.id,
          failures: this.failures,
          originalPrompt: agentPrompt,
        });

        this.optimizedPrompt = data.optimizedPrompt;
        this.originalPrompt = data.originalPrompt;
        this.optimizationStatus = 'done';
        const version = this.promptHistory.length + 1;
        this.promptHistory.push({
          prompt: data.optimizedPrompt,
          label: `v${version} · Optimized`,
          timestamp: new Date().toISOString(),
          passRate: null, // will be filled after re-run
          failures: this.failures,
        });
      } catch (err) {
        this.optimizationStatus = 'error';
        this.optimizationError = err.response?.data?.message || err.message || 'Optimization failed';
        throw err;
      }
    },

    logout() {
      axios.get('/auth/logout').catch(() => {});
      this.isAuthenticated = false;
      this.locationId = null;
      this.agents = [];
      this.selectedAgent = null;
      this.resetSimulation();
    },
  },
});
