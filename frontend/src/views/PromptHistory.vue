<template>
  <div class="prompt-history">
    <div class="history-header">
      <button class="btn btn-secondary btn-sm" @click="$router.push('/dashboard')">← Dashboard</button>
      <div>
        <h1 class="page-title">Prompt History</h1>
        <p class="page-subtitle">{{ store.selectedAgent?.name || 'Agent' }}</p>
      </div>
    </div>

    <div v-if="store.promptHistory.length === 0" class="empty">
      <p>No prompt history yet. Run a simulation first.</p>
    </div>

    <div v-else class="versions">
      <div
        v-for="(entry, i) in [...store.promptHistory].reverse()"
        :key="i"
        class="version-card"
        :class="{ 'version-card--active': i === 0 }"
      >
        <!-- Card header -->
        <div class="version-header" @click="toggle(entry)">
          <div class="version-meta">
            <span class="version-label">{{ entry.label }}</span>
            <span v-if="i === 0" class="active-badge">● Active</span>
            <span class="version-time">{{ formatTime(entry.timestamp) }}</span>
          </div>
          <div class="version-stats">
            <span v-if="entry.passRate !== null" class="pass-rate" :class="rateClass(entry.passRate)">
              {{ entry.passRate }}% pass rate
            </span>
            <span v-if="entry.failures?.length" class="failure-count">
              {{ entry.failures.length }} {{ entry.failures.length === 1 ? 'failure' : 'failures' }} addressed
            </span>
            <span class="chevron">{{ expanded === entry ? '▲' : '▼' }}</span>
          </div>
        </div>

        <!-- Expanded: prompt text + diff vs previous -->
        <div v-if="expanded === entry" class="version-body">
          <!-- Failures addressed (if any) -->
          <div v-if="entry.failures?.length" class="failures-addressed">
            <h4 class="section-label">Failures Addressed</h4>
            <div v-for="(f, fi) in entry.failures" :key="fi" class="failure-chip">
              <span class="failure-kpi">{{ f.kpi }}</span>
              <span class="failure-scenario">{{ f.scenario }}</span>
            </div>
          </div>

          <!-- Diff vs previous version -->
          <div v-if="prevVersion(i)" class="diff-section">
            <h4 class="section-label">Changes vs {{ prevVersion(i).label }}</h4>
            <PromptDiff :original="prevVersion(i).prompt" :optimized="entry.prompt" />
          </div>

          <!-- Full prompt text -->
          <div class="prompt-section">
            <div class="prompt-section-header">
              <h4 class="section-label">Full Prompt</h4>
              <button class="btn-copy" @click.stop="copy(entry.prompt)">{{ copied ? '✓ Copied' : 'Copy' }}</button>
            </div>
            <pre class="prompt-text">{{ entry.prompt }}</pre>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useCopilotStore } from '../stores/copilot.js';
import PromptDiff from '../components/PromptDiff.vue';

const store = useCopilotStore();
const expanded = ref(null);
const copied = ref(false);

function toggle(entry) {
  expanded.value = expanded.value === entry ? null : entry;
}

// reversed list index → original list index for finding previous version
function prevVersion(reversedIndex) {
  const originalIndex = store.promptHistory.length - 1 - reversedIndex;
  return originalIndex > 0 ? store.promptHistory[originalIndex - 1] : null;
}

function formatTime(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function rateClass(rate) {
  if (rate >= 80) return 'text-success';
  if (rate >= 50) return 'text-warning';
  return 'text-danger';
}

async function copy(text) {
  await navigator.clipboard.writeText(text);
  copied.value = true;
  setTimeout(() => (copied.value = false), 2000);
}
</script>

<style scoped>
.prompt-history {
  padding: 8px 0;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.history-header {
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

.empty {
  text-align: center;
  padding: 60px;
  color: #64748b;
  font-size: 14px;
}

.versions {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.version-card {
  background: #1a1d2e;
  border: 1px solid #2d3348;
  border-radius: 12px;
  overflow: hidden;
}

.version-card--active {
  border-color: #7c3aed;
}

.version-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  cursor: pointer;
  user-select: none;
  gap: 12px;
}

.version-header:hover {
  background: rgba(255,255,255,0.02);
}

.version-meta {
  display: flex;
  align-items: center;
  gap: 10px;
}

.version-label {
  font-size: 15px;
  font-weight: 600;
  color: #e2e8f0;
}

.active-badge {
  font-size: 11px;
  font-weight: 600;
  color: #a78bfa;
  background: rgba(124, 58, 237, 0.15);
  border: 1px solid #7c3aed;
  border-radius: 20px;
  padding: 2px 8px;
}

.version-time {
  font-size: 12px;
  color: #64748b;
}

.version-stats {
  display: flex;
  align-items: center;
  gap: 12px;
}

.pass-rate {
  font-size: 13px;
  font-weight: 600;
}

.failure-count {
  font-size: 12px;
  color: #64748b;
}

.chevron {
  font-size: 11px;
  color: #64748b;
}

.version-body {
  border-top: 1px solid #2d3348;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.failures-addressed {
  padding: 16px 20px;
  border-bottom: 1px solid #2d3348;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-label {
  font-size: 11px;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 8px;
}

.failure-chip {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 12px;
  background: rgba(69,10,10,0.2);
  border: 1px solid #991b1b;
  border-radius: 6px;
}

.failure-kpi {
  font-size: 12px;
  font-weight: 600;
  color: #fca5a5;
}

.failure-scenario {
  font-size: 11px;
  color: #64748b;
  font-style: italic;
}

.diff-section {
  padding: 16px 20px;
  border-bottom: 1px solid #2d3348;
}

.prompt-section {
  padding: 16px 20px;
}

.prompt-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.btn-copy {
  font-size: 12px;
  color: #7c3aed;
  background: none;
  border: 1px solid #7c3aed;
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
}

.btn-copy:hover {
  background: rgba(124,58,237,0.1);
}

.prompt-text {
  font-size: 12px;
  color: #94a3b8;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  background: #13151f;
  border: 1px solid #2d3348;
  border-radius: 8px;
  padding: 16px;
  margin: 0;
  max-height: 400px;
  overflow-y: auto;
}
</style>
