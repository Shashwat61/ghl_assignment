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
            <span v-if="store.optimizationStatus === 'pushing'">⬆ Pushing to HighLevel...</span>
            <span v-else-if="store.optimizationStatus === 'optimizing'">⚙ Optimizing prompt...</span>
            <span v-else-if="store.flywheelPhase === 'fix'">
              Fix Loop · Attempt {{ store.flywheelAttempt }}/{{ store.flywheelTotal }}
            </span>
            <span v-else>Simulating...</span>
          </div>

          <template v-if="store.simulationStatus === 'done'">
            <button
              v-if="store.promptHistory.length > 1"
              class="btn btn-secondary"
              @click="$router.push('/prompts')"
            >
              📋 Prompt History ({{ store.promptHistory.length }})
            </button>
            <button class="btn btn-secondary" @click="runSimulation">↻ Re-run</button>
          </template>
        </div>
      </div>

      <!-- Active prompt strip -->
      <div v-if="store.activePrompt" class="active-prompt-strip" @click="openPromptModal">
        <div class="active-prompt-strip__label">
          <span class="dot">●</span>
          Active Prompt
          <span v-if="store.promptHistory.length > 0" class="prompt-version">
            {{ store.promptHistory[store.promptHistory.length - 1].label }}
          </span>
        </div>
        <div class="active-prompt-strip__text">{{ promptPreview }}</div>
        <button
          class="active-prompt-strip__link"
          @click.stop="store.promptHistory.length > 1 ? openDiffModal() : openPromptModal()"
        >{{ store.promptHistory.length > 1 ? 'View diff →' : 'View full →' }}</button>
      </div>

      <!-- Prompt modal (full text) -->
      <div v-if="showPromptModal" class="modal-overlay" @click.self="showPromptModal = false">
        <div class="modal">
          <div class="modal-header">
            <span class="modal-title">
              Active Prompt
              <span v-if="store.promptHistory.length > 0" class="prompt-version">
                {{ store.promptHistory[store.promptHistory.length - 1].label }}
              </span>
            </span>
            <button class="modal-close" @click="showPromptModal = false">✕</button>
          </div>
          <pre class="modal-prompt-text">{{ store.activePrompt }}</pre>
        </div>
      </div>

      <!-- Diff modal -->
      <div v-if="showDiffModal" class="modal-overlay" @click.self="showDiffModal = false">
        <div class="modal modal--wide">
          <div class="modal-header">
            <span class="modal-title">Prompt Diff — {{ store.promptHistory[0]?.label }} vs {{ store.promptHistory[store.promptHistory.length - 1]?.label }}</span>
            <button class="modal-close" @click="showDiffModal = false">✕</button>
          </div>
          <div class="modal-diff">
            <PromptDiff
              :original="store.promptHistory[0]?.prompt || ''"
              :optimized="store.promptHistory[store.promptHistory.length - 1]?.prompt || ''"
            />
          </div>
        </div>
      </div>

      <!-- Timeout banner -->
      <div v-if="store.simulationTimedOut" class="warning-banner">
        ⏱ Simulation timed out — showing results for {{ store.simulationCompletedCount }} of {{ store.testCases.length }} test cases. Pass rate calculated over completed cases only.
      </div>

      <!-- Error banner -->
      <div v-if="store.simulationStatus === 'error'" class="error-banner">
        ⚠ {{ store.simulationError }}
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
            <div v-else class="test-cases-list" ref="testCasesListEl">
              <TestCaseCard
                v-for="(tc, i) in store.testCases"
                :key="i"
                :testCase="tc"
                :index="i"
                :result="store.results[i] || null"
                :isActive="activeCase === i && store.evaluatingCaseIndex !== i"
                :isEvaluating="store.evaluatingCaseIndex === i"
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
import { ref, computed, watch, nextTick } from 'vue';
import TestCaseCard from '../components/TestCaseCard.vue';
import TranscriptViewer from '../components/TranscriptViewer.vue';
import KpiResultBadge from '../components/KpiResultBadge.vue';
import PromptDiff from '../components/PromptDiff.vue';
import { useCopilotStore } from '../stores/copilot.js';

const store = useCopilotStore();
const activeCase = ref(null);
const selectedCaseIndex = ref(null);
const userHasSelected = ref(false);
const testCasesListEl = ref(null);
const showPromptModal = ref(false);
const showDiffModal = ref(false);

function openPromptModal() { showPromptModal.value = true; }
function openDiffModal() { showDiffModal.value = true; }

const selectedResult = computed(() =>
  selectedCaseIndex.value !== null ? store.results[selectedCaseIndex.value] || null : null,
);

const promptPreview = computed(() => {
  const p = store.activePrompt;
  if (!p) return '';
  const first = p.split('\n').find((l) => l.trim()) || '';
  return first.length > 120 ? first.slice(0, 120) + '…' : first;
});

const passRateClass = computed(() => {
  if (store.passRate >= 80) return 'text-success';
  if (store.passRate >= 50) return 'text-warning';
  return 'text-danger';
});

function selectCase(index) {
  selectedCaseIndex.value = index;
  userHasSelected.value = true;
}

watch(activeCase, async (index) => {
  if (index === null) return;
  await nextTick();
  const list = testCasesListEl.value;
  if (!list) return;
  const card = list.children[index];
  if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
});

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
  userHasSelected.value = false;

  const url = `/api/flywheel?agentId=${encodeURIComponent(store.selectedAgent.id)}`;
  eventSource = new EventSource(url);
  let completed = false;

  const sseEvents = ['testcase_start', 'turn', 'evaluated', 'phase_change', 'optimize_start', 'optimize_complete', 'push_start', 'push_complete', 'status'];
  sseEvents.forEach((eventType) => {
    eventSource.addEventListener(eventType, (e) => {
      const data = JSON.parse(e.data);
      store.handleSSEEvent(eventType, data);
      if (eventType === 'testcase_start') {
        activeCase.value = data.index;
        if (!userHasSelected.value) {
          selectedCaseIndex.value = data.index;
        }
      }
    });
  });

  eventSource.addEventListener('complete', (e) => {
    completed = true;
    store.handleSSEEvent('complete', JSON.parse(e.data));
    activeCase.value = null;
    eventSource.close();
    eventSource = null;
  });

  // Named 'error' event = server explicitly emitted an error event with data
  eventSource.addEventListener('error', (e) => {
    if (e.data) {
      store.handleSSEEvent('error', JSON.parse(e.data));
      activeCase.value = null;
      eventSource.close();
      eventSource = null;
    }
    // No e.data means connection closed — handled by onerror below
  });

  eventSource.onerror = () => {
    // Fires when connection closes — ignore if we already got 'complete'
    if (!completed && store.simulationStatus === 'running') {
      store.handleSSEEvent('error', { message: 'SSE connection dropped' });
    }
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  };
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

.active-prompt-strip {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  background: #13151f;
  border: 1px solid #2d3348;
  border-radius: 8px;
  margin-bottom: 4px;
  min-width: 0;
  cursor: pointer;
}

.active-prompt-strip:hover {
  border-color: #7c3aed;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.modal {
  background: #1a1d2e;
  border: 1px solid #2d3348;
  border-radius: 12px;
  width: 100%;
  max-width: 680px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modal--wide {
  max-width: 1000px;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #2d3348;
  flex-shrink: 0;
}

.modal-title {
  font-size: 15px;
  font-weight: 600;
  color: #e2e8f0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.modal-close {
  background: none;
  border: none;
  color: #64748b;
  font-size: 16px;
  cursor: pointer;
  padding: 4px;
  line-height: 1;
}

.modal-close:hover {
  color: #e2e8f0;
}

.modal-prompt-text {
  font-size: 12px;
  color: #94a3b8;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  padding: 20px;
  margin: 0;
  overflow-y: auto;
  flex: 1;
}

.modal-diff {
  overflow-y: auto;
  flex: 1;
}

.active-prompt-strip__label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
}

.active-prompt-strip__label .dot {
  color: #7c3aed;
  font-size: 8px;
}

.prompt-version {
  color: #a78bfa;
  font-size: 10px;
  background: rgba(124,58,237,0.12);
  border-radius: 4px;
  padding: 1px 6px;
}

.active-prompt-strip__text {
  flex: 1;
  font-size: 12px;
  color: #94a3b8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-style: italic;
  min-width: 0;
}

.active-prompt-strip__link {
  font-size: 12px;
  color: #7c3aed;
  background: none;
  border: none;
  cursor: pointer;
  white-space: nowrap;
  padding: 0;
}

.active-prompt-strip__link:hover {
  text-decoration: underline;
}

.warning-banner {
  padding: 12px 16px;
  background: #451a03;
  border: 1px solid #92400e;
  border-radius: 8px;
  color: #fcd34d;
  font-size: 13px;
  margin-bottom: 12px;
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
