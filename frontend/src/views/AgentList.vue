<template>
  <div class="agent-list">
    <!-- Not authenticated -->
    <div v-if="!store.isAuthenticated" class="connect-prompt">
      <div class="connect-card">
        <div class="connect-icon">🔗</div>
        <h2>Connect Your HighLevel Account</h2>
        <p>Link your HighLevel account to start optimizing your Voice AI agents.</p>
        <a href="/auth" class="btn btn-primary btn-lg">Connect HighLevel</a>
      </div>
    </div>

    <!-- Authenticated -->
    <template v-else>
      <div class="page-header">
        <div>
          <h1 class="page-title">Voice AI Agents</h1>
          <p class="page-subtitle">Select an agent to run the validation flywheel</p>
        </div>
        <button class="btn btn-secondary" @click="loadAgents" :disabled="loading">
          {{ loading ? 'Loading...' : '↻ Refresh' }}
        </button>
      </div>

      <!-- Error state -->
      <div v-if="error" class="error-banner">
        <span>⚠ {{ error }}</span>
        <button class="btn btn-secondary btn-sm" @click="loadAgents">Retry</button>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="loading-state">
        <div class="loading-spinner"></div>
        <span>Loading agents...</span>
      </div>

      <!-- Empty state -->
      <div v-else-if="!loading && store.agents.length === 0 && !error" class="empty-state">
        <div class="empty-icon">🤖</div>
        <h3>No Voice AI Agents Found</h3>
        <p>Create a Voice AI agent in your HighLevel account to get started.</p>
      </div>

      <!-- Agent grid -->
      <div v-else class="agent-grid">
        <AgentCard
          v-for="agent in store.agents"
          :key="agent.id"
          :agent="agent"
          @select="handleSelect"
        />
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import AgentCard from '../components/AgentCard.vue';
import { useCopilotStore } from '../stores/copilot.js';

const store = useCopilotStore();
const router = useRouter();
const loading = ref(false);
const error = ref(null);

async function loadAgents() {
  if (!store.isAuthenticated) return;
  loading.value = true;
  error.value = null;
  try {
    await store.fetchAgents();
  } catch (err) {
    error.value = err.response?.data?.message || err.message || 'Failed to load agents';
  } finally {
    loading.value = false;
  }
}

function handleSelect(agent) {
  store.selectAgent(agent);
  router.push('/dashboard');
}

onMounted(loadAgents);
watch(() => store.isAuthenticated, (authed) => {
  if (authed) loadAgents();
});
</script>

<style scoped>
.agent-list {
  padding: 8px 0;
}

.connect-prompt {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
}

.connect-card {
  text-align: center;
  max-width: 400px;
  padding: 40px;
  background: #1a1d2e;
  border: 1px solid #2d3348;
  border-radius: 16px;
}

.connect-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.connect-card h2 {
  font-size: 22px;
  font-weight: 700;
  margin-bottom: 12px;
  color: #e2e8f0;
}

.connect-card p {
  color: #64748b;
  margin-bottom: 24px;
  line-height: 1.6;
}

.btn-lg {
  padding: 12px 28px;
  font-size: 15px;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 24px;
}

.page-title {
  font-size: 24px;
  font-weight: 700;
  color: #e2e8f0;
  margin-bottom: 4px;
}

.page-subtitle {
  font-size: 14px;
  color: #64748b;
}

.error-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: #450a0a;
  border: 1px solid #991b1b;
  border-radius: 8px;
  color: #fca5a5;
  font-size: 13px;
  margin-bottom: 20px;
}

.loading-state {
  display: flex;
  align-items: center;
  gap: 12px;
  justify-content: center;
  padding: 60px;
  color: #64748b;
}

.loading-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid #2d3348;
  border-top-color: #7c3aed;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.empty-state {
  text-align: center;
  padding: 60px;
  color: #64748b;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.empty-state h3 {
  font-size: 18px;
  font-weight: 600;
  color: #94a3b8;
  margin-bottom: 8px;
}

.agent-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 20px;
}
</style>
