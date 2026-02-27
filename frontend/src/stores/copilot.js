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
    testCases: [],
    liveTranscripts: {}, // { [caseIndex]: [{role, content}] }
    results: [],
    failures: [],

    // Optimization
    originalPrompt: '',
    optimizedPrompt: '',
    optimizationStatus: 'idle', // 'idle' | 'optimizing' | 'done' | 'error'
    optimizationError: null,
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
      this.testCases = [];
      this.liveTranscripts = {};
      this.results = [];
      this.failures = [];
      this.originalPrompt = '';
      this.optimizedPrompt = '';
      this.optimizationStatus = 'idle';
      this.optimizationError = null;
    },

    startSimulation() {
      if (!this.selectedAgent) return;
      this.simulationStatus = 'running';
      this.simulationError = null;
      this.testCases = [];
      this.liveTranscripts = {};
      this.results = [];
      this.failures = [];
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

        case 'complete':
          this.testCases = data.testCases;
          this.results = data.results;
          this.failures = data.failures;
          this.simulationStatus = 'done';
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
