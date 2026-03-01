<template>
  <div class="app">
    <!-- Block direct access outside HL iframe -->
    <div v-if="!isInIframe" class="not-embedded">
      <div class="not-embedded-card">
        <div class="not-embedded-icon">⚡</div>
        <h2>Voice AI Performance Optimizer</h2>
        <p>This app runs inside <strong>HighLevel</strong> as a Marketplace integration.<br>
        Install it from the HL Marketplace and open it from your sub-account sidebar.</p>
      </div>
    </div>

    <template v-else>
      <StatusBar />
      <main class="main-content">
        <router-view />
      </main>
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import StatusBar from './components/StatusBar.vue';
import { useCopilotStore } from './stores/copilot.js';

const store = useCopilotStore();
// True when running inside an iframe (i.e. embedded in HL Custom Page)
const isInIframe = ref(window.self !== window.top);

onMounted(() => {
  if (isInIframe.value) {
    store.checkAuth();
  }
});
</script>

<style>
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, sans-serif;
  background: #0f1117;
  color: #e2e8f0;
  min-height: 100vh;
}

.app {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.main-content {
  flex: 1;
  padding: 24px;
  max-width: 1400px;
  margin: 0 auto;
  width: 100%;
}

.not-embedded {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: #0f1117;
}

.not-embedded-card {
  text-align: center;
  max-width: 420px;
  padding: 48px 40px;
  background: #1a1d2e;
  border: 1px solid #2d3348;
  border-radius: 16px;
}

.not-embedded-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.not-embedded-card h2 {
  font-size: 20px;
  font-weight: 700;
  color: #e2e8f0;
  margin-bottom: 14px;
}

.not-embedded-card p {
  font-size: 14px;
  color: #64748b;
  line-height: 1.7;
}

.not-embedded-card strong {
  color: #a78bfa;
}

/* Global utility classes */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.2s;
}

.btn-primary {
  background: #7c3aed;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #6d28d9;
}

.btn-secondary {
  background: #1e2130;
  color: #e2e8f0;
  border: 1px solid #2d3348;
}

.btn-secondary:hover:not(:disabled) {
  background: #252840;
}

.btn-danger {
  background: #dc2626;
  color: white;
}

.btn-danger:hover:not(:disabled) {
  background: #b91c1c;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}

.badge-pass {
  background: #14532d;
  color: #4ade80;
}

.badge-fail {
  background: #450a0a;
  color: #f87171;
}

.badge-pending {
  background: #1e293b;
  color: #94a3b8;
}

.card {
  background: #1a1d2e;
  border: 1px solid #2d3348;
  border-radius: 12px;
  padding: 20px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  color: #e2e8f0;
  margin-bottom: 16px;
}

.text-muted {
  color: #64748b;
}

.text-success {
  color: #4ade80;
}

.text-danger {
  color: #f87171;
}

.text-warning {
  color: #fbbf24;
}
</style>
