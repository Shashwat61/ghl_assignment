<template>
  <div class="result-view">
    <!-- Guard: no optimization done -->
    <div v-if="!store.optimizedPrompt" class="no-result">
      <p>No optimization result found. <router-link to="/dashboard">← Go to Dashboard</router-link></p>
    </div>

    <template v-else>
      <!-- Header -->
      <div class="result-header">
        <div class="header-left">
          <button class="btn btn-secondary btn-sm" @click="$router.push('/dashboard')">← Dashboard</button>
          <div>
            <h1 class="page-title">Optimization Result</h1>
            <p class="page-subtitle">{{ store.selectedAgent?.name || 'Agent' }}</p>
          </div>
        </div>
        <div class="pushed-notice">
          <span class="pushed-icon">✓</span>
          <span>Prompt pushed to HighLevel</span>
        </div>
      </div>

      <!-- Stats bar -->
      <div class="stats-bar">
        <div class="stat-item">
          <span class="stat-label">Test Cases</span>
          <span class="stat-value">{{ store.testCases.length }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Pass Rate</span>
          <span class="stat-value" :class="passRateClass">{{ store.passRate }}%</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Failures Fixed</span>
          <span class="stat-value">{{ store.failures.length }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Before Lines</span>
          <span class="stat-value">{{ beforeLineCount }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">After Lines</span>
          <span class="stat-value">{{ afterLineCount }}</span>
        </div>
      </div>

      <!-- Failure summary -->
      <div v-if="store.failures.length > 0" class="failures-summary card">
        <h2 class="section-title">Issues Addressed</h2>
        <div class="failures-list">
          <div v-for="(failure, i) in store.failures" :key="i" class="failure-item">
            <div class="failure-item__header">
              <span class="failure-num">{{ i + 1 }}</span>
              <span class="failure-kpi">{{ failure.kpi }}</span>
            </div>
            <p class="failure-scenario">{{ failure.scenario }}</p>
            <p class="failure-reasoning">{{ failure.reasoning }}</p>
          </div>
        </div>
      </div>

      <!-- Diff -->
      <div class="diff-section card">
        <h2 class="section-title">Prompt Diff</h2>
        <PromptDiff
          :original="store.originalPrompt"
          :optimized="store.optimizedPrompt"
        />
      </div>

      <!-- Actions -->
      <div class="result-actions">
        <button class="btn btn-secondary" @click="$router.push('/')">← Back to Agents</button>
        <button class="btn btn-primary" @click="runAgain">↻ Run Again</button>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import PromptDiff from '../components/PromptDiff.vue';
import { useCopilotStore } from '../stores/copilot.js';

const store = useCopilotStore();
const router = useRouter();

const passRateClass = computed(() => {
  if (store.passRate >= 80) return 'text-success';
  if (store.passRate >= 50) return 'text-warning';
  return 'text-danger';
});

const beforeLineCount = computed(() => store.originalPrompt.split('\n').length);
const afterLineCount = computed(() => store.optimizedPrompt.split('\n').length);

function runAgain() {
  store.resetSimulation();
  router.push('/dashboard');
}
</script>

<style scoped>
.result-view {
  padding: 8px 0;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.no-result {
  text-align: center;
  padding: 60px;
  color: #64748b;
}

.no-result a {
  color: #7c3aed;
  text-decoration: none;
}

.result-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
}

.header-left {
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

.pushed-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  background: rgba(20, 83, 45, 0.3);
  border: 1px solid #166534;
  border-radius: 8px;
  color: #4ade80;
  font-size: 14px;
  font-weight: 600;
}

.pushed-icon {
  font-size: 16px;
}

.stats-bar {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 12px;
}

.stat-item {
  background: #1a1d2e;
  border: 1px solid #2d3348;
  border-radius: 8px;
  padding: 16px;
  text-align: center;
}

.stat-label {
  display: block;
  font-size: 11px;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 4px;
}

.stat-value {
  display: block;
  font-size: 24px;
  font-weight: 700;
  color: #e2e8f0;
}

.failures-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.failure-item {
  padding: 12px;
  background: rgba(69, 10, 10, 0.2);
  border: 1px solid #991b1b;
  border-radius: 8px;
}

.failure-item__header {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 6px;
}

.failure-num {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  background: #991b1b;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: white;
}

.failure-kpi {
  font-size: 13px;
  font-weight: 600;
  color: #fca5a5;
}

.failure-scenario {
  font-size: 12px;
  color: #94a3b8;
  margin-bottom: 4px;
  font-style: italic;
}

.failure-reasoning {
  font-size: 12px;
  color: #64748b;
  line-height: 1.5;
}

.diff-section {
  overflow: hidden;
  padding: 0;
}

.diff-section .section-title {
  padding: 16px 20px;
  border-bottom: 1px solid #2d3348;
  margin-bottom: 0;
}

.result-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}
</style>
