<template>
  <div class="test-case-card" :class="cardClass">
    <div class="test-case-card__header">
      <span class="case-number">Case {{ index + 1 }}</span>
      <KpiResultBadge v-if="result" :result="result.overall" />
      <span v-else-if="isEvaluating" class="evaluating-badge">
        <span class="spinner spinner--amber"></span> Analysing...
      </span>
      <span v-else-if="isActive" class="running-badge">
        <span class="spinner"></span> Running
        <span class="timer">{{ formattedTime }}</span>
      </span>
      <span v-else class="pending-badge">Pending</span>
    </div>

    <p class="scenario">{{ testCase.scenario }}</p>

    <div v-if="testCase.kpis && testCase.kpis.length" class="kpis">
      <div
        v-for="(kpi, i) in testCase.kpis"
        :key="i"
        class="kpi-item"
        :class="getKpiClass(kpi)"
      >
        <span class="kpi-icon">{{ getKpiIcon(kpi) }}</span>
        <span class="kpi-text">{{ kpi }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch, onUnmounted } from 'vue';
import KpiResultBadge from './KpiResultBadge.vue';

const props = defineProps({
  testCase: { type: Object, required: true },
  index: { type: Number, required: true },
  result: { type: Object, default: null },
  isActive: { type: Boolean, default: false },
  isEvaluating: { type: Boolean, default: false },
});

const cardClass = computed(() => ({
  'test-case-card--pass': props.result?.overall === 'pass',
  'test-case-card--fail': props.result?.overall === 'fail',
  'test-case-card--active': props.isActive,
}));

// Timer
const elapsed = ref(0);
let timerHandle = null;

watch(() => props.isActive, (active) => {
  if (active) {
    elapsed.value = 0;
    timerHandle = setInterval(() => { elapsed.value++ }, 1000);
  } else {
    clearInterval(timerHandle);
    timerHandle = null;
  }
}, { immediate: true });

watch(() => props.result, (result) => {
  if (result) {
    clearInterval(timerHandle);
    timerHandle = null;
  }
});

onUnmounted(() => clearInterval(timerHandle));

const formattedTime = computed(() => {
  const m = Math.floor(elapsed.value / 60);
  const s = elapsed.value % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
});

function getKpiResult(kpi) {
  if (!props.result) return null;
  return props.result.kpiResults?.find((r) => r.kpi === kpi);
}

function getKpiClass(kpi) {
  const r = getKpiResult(kpi);
  if (!r) return '';
  return r.result === 'pass' ? 'kpi-pass' : 'kpi-fail';
}

function getKpiIcon(kpi) {
  const r = getKpiResult(kpi);
  if (!r) return '◯';
  return r.result === 'pass' ? '✓' : '✗';
}
</script>

<style scoped>
.test-case-card {
  background: #13151f;
  border: 1px solid #2d3348;
  border-radius: 8px;
  padding: 14px;
  transition: border-color 0.3s;
}

.test-case-card--pass {
  border-color: #166534;
}

.test-case-card--fail {
  border-color: #991b1b;
}

.test-case-card--active {
  border-color: #7c3aed;
}

.test-case-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.case-number {
  font-size: 12px;
  font-weight: 700;
  color: #7c3aed;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.scenario {
  font-size: 13px;
  color: #94a3b8;
  line-height: 1.5;
  margin-bottom: 10px;
}

.kpis {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.kpi-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 12px;
  color: #64748b;
}

.kpi-icon {
  flex-shrink: 0;
  width: 14px;
}

.kpi-pass .kpi-icon {
  color: #4ade80;
}

.kpi-fail .kpi-icon {
  color: #f87171;
}

.kpi-pass .kpi-text {
  color: #86efac;
}

.kpi-fail .kpi-text {
  color: #fca5a5;
}

.running-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: #7c3aed;
}

.pending-badge {
  font-size: 11px;
  color: #475569;
}

.evaluating-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: #f59e0b;
}

.spinner--amber {
  border-color: rgba(245, 158, 11, 0.3);
  border-top-color: #f59e0b;
}

.timer {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: #a78bfa;
  margin-left: 2px;
}

.spinner {
  width: 8px;
  height: 8px;
  border: 1.5px solid #7c3aed;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  display: inline-block;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
