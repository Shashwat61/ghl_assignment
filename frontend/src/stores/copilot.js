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
    optimizationStatus: 'idle', // 'idle' | 'optimizing' | 'pushing' | 'done' | 'error'
    optimizationError: null,
    pushSuccess: null, // true | false | null

    // Flywheel phase progress
    flywheelPhase: null, // 'fix' | 'harden' | null
    flywheelAttempt: 0,
    flywheelTotal: 0,
    flywheelStatusMessage: '',
    evaluatingCaseIndex: null, // index of case currently being evaluated

    // Prompt history (in-memory, per agent session)
    // [{ prompt, label, timestamp, passRate, failures }]
    promptHistory: [],

    // Voice Mode
    voiceMode: false,
    voiceSessionId: null,
    voiceRunStatus: 'idle', // 'idle' | 'running' | 'done' | 'error'
    voiceError: null,
    voiceResults: [], // [{ index, testCase, evaluation, recordingFile }]
    voiceTestCases: [], // parallel test cases list for voice mode
    voiceStatusMessage: '',
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
      this.pushSuccess = null;
      this.flywheelPhase = null;
      this.flywheelAttempt = 0;
      this.flywheelTotal = 0;
      this.flywheelStatusMessage = '';
      this.evaluatingCaseIndex = null;
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
          this.evaluatingCaseIndex = null;
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

        case 'push_start':
          this.optimizationStatus = 'pushing';
          break;

        case 'push_complete':
          this.pushSuccess = data.success;
          this.optimizationStatus = 'done';
          break;

        case 'optimize_start':
          this.optimizationStatus = 'optimizing';
          this.pushSuccess = null;
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

        case 'status': {
          this.flywheelStatusMessage = data.message;
          // Detect "Evaluating case X..." to show amber analysing badge
          const evalMatch = data.message.match(/Evaluating case (\d+)/);
          if (evalMatch) {
            this.evaluatingCaseIndex = parseInt(evalMatch[1], 10) - 1;
          }
          break;
        }

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

    toggleVoiceMode() {
      this.voiceMode = !this.voiceMode;
    },

    resetVoiceRun() {
      this.voiceRunStatus = 'idle';
      this.voiceError = null;
      this.voiceResults = [];
      this.voiceTestCases = [];
      this.voiceSessionId = null;
      this.voiceStatusMessage = '';
    },

    async startVoiceRun(agentId) {
      this.resetVoiceRun();
      this.voiceRunStatus = 'running';

      try {
        const { data } = await axios.post('/api/voice/run', { agentId });
        this.voiceSessionId = data.sessionId;
      } catch (err) {
        this.voiceRunStatus = 'error';
        this.voiceError = err.response?.data?.error || err.message || 'Failed to start voice run';
        return;
      }

      // Open SSE stream
      const es = new EventSource(`/api/voice/stream?sessionId=${encodeURIComponent(this.voiceSessionId)}`);

      const handleEvent = (type, data) => {
        switch (type) {
          case 'voice_status':
            this.voiceStatusMessage = data.message || '';
            break;

          case 'voice_case_start':
            if (!this.voiceTestCases[data.index]) {
              this.voiceTestCases[data.index] = data.testCase;
            }
            break;

          case 'voice_case_complete':
            this.voiceResults[data.index] = {
              index: data.index,
              testCase: data.testCase,
              evaluation: data.evaluation,
              recordingFile: data.recordingFile || null,
            };
            if (!this.voiceTestCases[data.index]) {
              this.voiceTestCases[data.index] = data.testCase;
            }
            if (data.transcript && data.transcript.length > 0) {
              this.liveTranscripts[data.index] = data.transcript;
            }
            break;

          case 'voice_case_error':
            this.voiceResults[data.index] = {
              index: data.index,
              error: data.message,
            };
            break;

          case 'voice_complete':
            this.voiceRunStatus = 'done';
            es.close();
            break;

          case 'voice_error':
            this.voiceRunStatus = 'error';
            this.voiceError = data.message;
            es.close();
            break;
        }
      };

      ['voice_status', 'voice_case_start', 'voice_case_complete', 'voice_case_error'].forEach((evt) => {
        es.addEventListener(evt, (e) => handleEvent(evt, JSON.parse(e.data)));
      });

      es.addEventListener('voice_complete', (e) => handleEvent('voice_complete', JSON.parse(e.data)));
      es.addEventListener('voice_error', (e) => handleEvent('voice_error', JSON.parse(e.data)));

      es.onerror = () => {
        if (this.voiceRunStatus === 'running') {
          this.voiceRunStatus = 'error';
          this.voiceError = 'SSE connection dropped';
        }
        es.close();
      };
    },
  },
});
