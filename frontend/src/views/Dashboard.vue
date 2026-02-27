<template>
  <div class="dashboard">
    <!-- No agent selected guard -->
    <div v-if="!store.selectedAgent" class="no-agent">
      <p>No agent selected. <router-link to="/">← Go back</router-link></p>
    </div>

    <template v-else>
      <!-- Header -->
      <div class="dashboard-header">
        <div class="agent-info">
          <button class="btn btn-secondary btn-sm" @click="$router.push('/')">← Back</button>
          <div>
            <h1 class="page-title">{{ store.selectedAgent.name || 'Agent' }}</h1>
            <p class="page-subtitle">Validation Flywheel</p>
          </div>
        </div>
        <div class="header-actions">
          <div v-if="store.simulationStatus === 'done'" class="kpi-summary">
            <span class="kpi-stat">
              <span class="kpi-stat__value text-success">{{ store.passCount }}</span>
              <span class="kpi-stat__label">Pass</span>
            </span>
            <span class="kpi-divider">/</span>
            <span class="kpi-stat">
              <span class="kpi-stat__value text-danger">{{ store.failCount }}</span>
              <span class="kpi-stat__label">Fail</span>
            </span>
            <span class="pass-rate" :class="passRateClass">{{ store.passRate }}%</span>
          </div>

          <button
            v-if="store.simulationStatus === 'idle' || store.simulationStatus === 'error'"
            class="btn btn-primary"
            @click="runSimulation"
          >
            ▶ Run Simulation
          </button>

          <div v-else-if="store.simulationStatus === 'running'" class="running-indicator">
            <span class="spinner-large"></span>
            <span>Simulating...</span>
          </div>

          <template v-if="store.simulationStatus === 'done'">
            <button
              v-if="store.hasFailures"
              class="btn btn-primary"
              :disabled="store.optimizationStatus === 'optimizing'"
              @click="optimize"
            >
              {{ store.optimizationStatus === 'optimizing' ? '⚙ Optimizing...' : '⚡ Optimize Prompt' }}
            </button>
            <button class="btn btn-secondary" @click="runSimulation">↻ Re-run</button>
          </template>
        </div>
      </div>

      <!-- Error banner -->
      <div v-if="store.simulationStatus === 'error'" class="error-banner">
        ⚠ {{ store.simulationError }}
      </div>
      <div v-if="optimizationError" class="error-banner">
        ⚠ Optimization failed: {{ optimizationError }}
      </div>

      <!-- 3-Panel Layout -->
      <div class="panels">
        <!-- Panel 1: Test Cases -->
        <div class="panel">
          <h2 class="panel-title">
            Test Cases
            <span class="panel-count">{{ store.testCases.length }}</span>
          </h2>
          <div class="panel-body test-cases-panel">
            <div v-if="store.testCases.length === 0 && store.simulationStatus !== 'running'" class="empty-panel">
              <span class="text-muted">Run simulation to generate test cases</span>
            </div>
            <div v-else class="test-cases-list">
              <TestCaseCard
                v-for="(tc, i) in store.testCases"
                :key="i"
                :testCase="tc"
                :index="i"
                :result="store.results[i] || null"
                :isActive="activeCase === i"
                @click="selectCase(i)"
              />
            </div>
          </div>
        </div>

        <!-- Panel 2: Live Transcripts -->
        <div class="panel">
          <h2 class="panel-title">
            Transcript
            <span v-if="selectedCaseIndex !== null" class="panel-count">Case {{ selectedCaseIndex + 1 }}</span>
          </h2>
          <div class="panel-body transcript-panel">
            <div v-if="selectedCaseIndex === null" class="empty-panel">
              <span class="text-muted">Select a test case to view transcript</span>
            </div>
            <TranscriptViewer
              v-else
              :transcript="store.transcriptForCase(selectedCaseIndex)"
            />
          </div>
        </div>

        <!-- Panel 3: KPI Results -->
        <div class="panel">
          <h2 class="panel-title">
            KPI Results
            <span v-if="selectedResult" class="panel-count">
              <KpiResultBadge :result="selectedResult.overall" />
            </span>
          </h2>
          <div class="panel-body kpi-panel">
            <div v-if="!selectedResult" class="empty-panel">
              <span class="text-muted">Evaluation results will appear here</span>
            </div>
            <div v-else class="kpi-results">
              <div class="kpi-summary-text">{{ selectedResult.summary }}</div>
              <div class="kpi-items">
                <div
                  v-for="(kpi, i) in selectedResult.kpiResults"
                  :key="i"
                  class="kpi-result-item"
                  :class="kpi.result === 'pass' ? 'kpi-result-item--pass' : 'kpi-result-item--fail'"
                >
                  <div class="kpi-result-header">
                    <KpiResultBadge :result="kpi.result" />
                    <span class="kpi-name">{{ kpi.kpi }}</span>
                  </div>
                  <p class="kpi-reasoning">{{ kpi.reasoning }}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import TestCaseCard from '../components/TestCaseCard.vue';
import TranscriptViewer from '../components/TranscriptViewer.vue';
import KpiResultBadge from '../components/KpiResultBadge.vue';
import { useCopilotStore } from '../stores/copilot.js';

const store = useCopilotStore();
const router = useRouter();
const activeCase = ref(null);
const selectedCaseIndex = ref(null);
const optimizationError = ref(null);

const selectedResult = computed(() =>
  selectedCaseIndex.value !== null ? store.results[selectedCaseIndex.value] || null : null,
);

const passRateClass = computed(() => {
  if (store.passRate >= 80) return 'text-success';
  if (store.passRate >= 50) return 'text-warning';
  return 'text-danger';
});

function selectCase(index) {
  selectedCaseIndex.value = index;
}

let eventSource = null;

function runSimulation() {
  if (!store.selectedAgent) return;

  // Close any existing SSE connection
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }

  store.startSimulation();
  activeCase.value = null;
  selectedCaseIndex.value = null;

  const url = `/api/simulate?agentId=${encodeURIComponent(store.selectedAgent.id)}`;
  eventSource = new EventSource(url);

  eventSource.addEventListener('testcase_start', (e) => {
    const data = JSON.parse(e.data);
    store.handleSSEEvent('testcase_start', data);
    activeCase.value = data.index;
    selectedCaseIndex.value = data.index;
  });

  eventSource.addEventListener('turn', (e) => {
    store.handleSSEEvent('turn', JSON.parse(e.data));
  });

  eventSource.addEventListener('evaluated', (e) => {
    store.handleSSEEvent('evaluated', JSON.parse(e.data));
  });

  eventSource.addEventListener('complete', (e) => {
    store.handleSSEEvent('complete', JSON.parse(e.data));
    activeCase.value = null;
    eventSource.close();
    eventSource = null;
  });

  eventSource.addEventListener('error', (e) => {
    if (e.data) {
      store.handleSSEEvent('error', JSON.parse(e.data));
    } else {
      store.handleSSEEvent('error', { message: 'Connection lost' });
    }
    activeCase.value = null;
    eventSource.close();
    eventSource = null;
  });

  eventSource.onerror = () => {
    if (store.simulationStatus === 'running') {
      store.handleSSEEvent('error', { message: 'SSE connection dropped' });
    }
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  };
}

async function optimize() {
  optimizationError.value = null;
  try {
    await store.optimizePrompt();
    router.push('/result');
  } catch (err) {
    optimizationError.value = err.response?.data?.message || err.message || 'Optimization failed';
  }
}
</script>

<style scoped>
.dashboard {
  padding: 8px 0;
}

.no-agent {
  text-align: center;
  padding: 60px;
  color: #64748b;
}

.no-agent a {
  color: #7c3aed;
  text-decoration: none;
}

.dashboard-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
  flex-wrap: wrap;
  gap: 16px;
}

.agent-info {
  display: flex;
  align-items: center;
  gap: 16px;
}

.page-title {
  font-size: 22px;
  font-weight: 700;
  color: #e2e8f0;
  margin-bottom: 2px;
}

.page-subtitle {
  font-size: 13px;
  color: #64748b;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.kpi-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #1a1d2e;
  border: 1px solid #2d3348;
  border-radius: 8px;
  padding: 8px 16px;
}

.kpi-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.kpi-stat__value {
  font-size: 20px;
  font-weight: 700;
}

.kpi-stat__label {
  font-size: 10px;
  color: #64748b;
  text-transform: uppercase;
}

.kpi-divider {
  color: #2d3348;
  font-size: 20px;
}

.pass-rate {
  font-size: 18px;
  font-weight: 700;
  margin-left: 8px;
}

.running-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #7c3aed;
  font-size: 14px;
}

.spinner-large {
  width: 16px;
  height: 16px;
  border: 2px solid #3d2a6e;
  border-top-color: #7c3aed;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  display: inline-block;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error-banner {
  padding: 12px 16px;
  background: #450a0a;
  border: 1px solid #991b1b;
  border-radius: 8px;
  color: #fca5a5;
  font-size: 13px;
  margin-bottom: 20px;
}

.panels {
  display: grid;
  grid-template-columns: 1fr 1.5fr 1.5fr;
  gap: 16px;
  height: calc(100vh - 220px);
  min-height: 500px;
}

.panel {
  background: #1a1d2e;
  border: 1px solid #2d3348;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  font-weight: 600;
  color: #94a3b8;
  padding: 14px 16px;
  border-bottom: 1px solid #2d3348;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.panel-count {
  display: flex;
  align-items: center;
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.empty-panel {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100px;
  font-size: 13px;
}

.test-cases-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.test-cases-panel {
  padding: 8px;
}

.transcript-panel {
  padding: 0;
}

.kpi-summary-text {
  font-size: 13px;
  color: #94a3b8;
  line-height: 1.6;
  padding: 12px;
  background: #13151f;
  border-radius: 8px;
  margin-bottom: 12px;
}

.kpi-items {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.kpi-result-item {
  padding: 12px;
  border-radius: 8px;
  border: 1px solid #2d3348;
}

.kpi-result-item--pass {
  border-color: #166534;
  background: rgba(20, 83, 45, 0.15);
}

.kpi-result-item--fail {
  border-color: #991b1b;
  background: rgba(69, 10, 10, 0.15);
}

.kpi-result-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}

.kpi-name {
  font-size: 13px;
  font-weight: 500;
  color: #cbd5e1;
}

.kpi-reasoning {
  font-size: 12px;
  color: #64748b;
  line-height: 1.5;
}
</style>
