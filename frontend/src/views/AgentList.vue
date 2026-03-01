<template>
  <div class="agent-list">
    <!-- Not authenticated -->
    <div v-if="!store.isAuthenticated" class="connect-prompt">
      <div class="connect-card">
        <div class="connect-icon">🔗</div>
        <h2>Connect Your HighLevel Account</h2>
        <p>Link your HighLevel account to start optimizing your Voice AI agents.</p>
        <button class="btn btn-primary btn-lg" @click="connectHL">Connect HighLevel</button>
      </div>
    </div>

    <!-- Authenticated -->
    <template v-else>

      <!-- Blocking API key prompt — shown when no key is available -->
      <div v-if="keyReady === false" class="api-key-blocking">
        <div class="api-key-blocking-card">
          <div class="api-key-blocking-icon">🔑</div>
          <h2>Anthropic API Key Required</h2>
          <p>Enter your Anthropic API key to run the validation flywheel. The key is used only for this session and never stored permanently.</p>
          <div class="api-key-row">
            <input
              v-model="apiKeyInput"
              type="password"
              class="api-key-input"
              placeholder="sk-ant-api03-..."
              @keydown.enter="saveApiKey"
              autofocus
            />
            <button class="btn btn-primary" @click="saveApiKey" :disabled="savingKey">
              {{ savingKey ? 'Saving...' : 'Continue' }}
            </button>
          </div>
          <p v-if="apiKeyError" class="api-key-error">{{ apiKeyError }}</p>
          <p class="api-key-hint">Get your key at <a href="https://console.anthropic.com" target="_blank">console.anthropic.com</a></p>
        </div>
      </div>

      <template v-else>
        <div class="page-header">
          <div>
            <h1 class="page-title">Voice AI Agents</h1>
            <p class="page-subtitle">Select an agent to run the validation flywheel</p>
          </div>
          <div class="header-actions">
            <button class="btn btn-ghost btn-sm" @click="showApiKeyField = !showApiKeyField" :title="apiKeyStatus">
              🔑 {{ apiKeyStatus }}
            </button>
            <button class="btn btn-secondary" @click="loadAgents" :disabled="loading">
              {{ loading ? 'Loading...' : '↻ Refresh' }}
            </button>
          </div>
        </div>

        <!-- Collapsible key update panel -->
        <div v-if="showApiKeyField" class="api-key-panel">
          <p class="api-key-desc">Update your Anthropic API key for this session.</p>
          <div class="api-key-row">
            <input
              v-model="apiKeyInput"
              type="password"
              class="api-key-input"
              placeholder="sk-ant-api03-..."
              @keydown.enter="saveApiKey"
            />
            <button class="btn btn-primary btn-sm" @click="saveApiKey" :disabled="savingKey">
              {{ savingKey ? 'Saving...' : 'Save' }}
            </button>
          </div>
          <p v-if="apiKeySaved" class="api-key-success">✓ Key saved for this session</p>
          <p v-if="apiKeyError" class="api-key-error">{{ apiKeyError }}</p>
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
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import axios from 'axios';
import AgentCard from '../components/AgentCard.vue';
import { useCopilotStore } from '../stores/copilot.js';

const store = useCopilotStore();
const router = useRouter();
const loading = ref(false);
const error = ref(null);

// API Key settings
const showApiKeyField = ref(false);
const apiKeyInput = ref('');
const savingKey = ref(false);
const apiKeySaved = ref(false);
const apiKeyError = ref(null);
const hasCustomKey = ref(false);
const keyReady = ref(null); // null = loading, true = ready, false = needs key

const apiKeyStatus = computed(() => hasCustomKey.value ? 'Custom Key Active' : 'Set API Key');

async function checkApiKeyStatus() {
  try {
    const { data } = await axios.get('/api/settings/anthropic-key');
    hasCustomKey.value = data.hasCustomKey;
    keyReady.value = data.keyReady;
  } catch {
    keyReady.value = true; // assume ready if check fails
  }
}

async function saveApiKey() {
  if (!apiKeyInput.value.trim()) return;
  savingKey.value = true;
  apiKeySaved.value = false;
  apiKeyError.value = null;
  try {
    await axios.post('/api/settings/anthropic-key', { apiKey: apiKeyInput.value.trim() });
    hasCustomKey.value = true;
    keyReady.value = true;
    apiKeySaved.value = true;
    apiKeyInput.value = '';
    setTimeout(() => { showApiKeyField.value = false; apiKeySaved.value = false; }, 1500);
  } catch (err) {
    apiKeyError.value = err.response?.data?.error || 'Failed to save key';
  } finally {
    savingKey.value = false;
  }
}

function connectHL() {
  const popup = window.open('/auth', 'hl-oauth', 'width=600,height=700,left=200,top=100');
  const timer = setInterval(async () => {
    if (popup && popup.closed) {
      clearInterval(timer);
      // Popup closed — check if auth succeeded
      await store.checkAuth();
      if (store.isAuthenticated) {
        loadAgents();
      }
    }
  }, 500);
}

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

onMounted(() => {
  if (store.isAuthenticated) {
    loadAgents();
    checkApiKeyStatus();
  }
});

watch(() => store.isAuthenticated, (authed) => {
  if (authed) {
    loadAgents();
    checkApiKeyStatus(); // always re-check key status after fresh OAuth
  }
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

.api-key-blocking {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
}

.api-key-blocking-card {
  text-align: center;
  max-width: 480px;
  padding: 40px;
  background: #1a1d2e;
  border: 1px solid #2d3348;
  border-radius: 16px;
}

.api-key-blocking-icon {
  font-size: 40px;
  margin-bottom: 16px;
}

.api-key-blocking-card h2 {
  font-size: 20px;
  font-weight: 700;
  color: #e2e8f0;
  margin-bottom: 10px;
}

.api-key-blocking-card p {
  font-size: 13px;
  color: #64748b;
  line-height: 1.6;
  margin-bottom: 20px;
}

.api-key-blocking-card .api-key-row {
  justify-content: center;
}

.api-key-hint {
  margin-top: 12px !important;
  margin-bottom: 0 !important;
  font-size: 12px !important;
}

.api-key-hint a {
  color: #7c3aed;
  text-decoration: none;
}

.api-key-hint a:hover {
  text-decoration: underline;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-ghost {
  background: none;
  border: 1px solid #2d3348;
  color: #64748b;
  font-size: 12px;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}

.btn-ghost:hover {
  border-color: #7c3aed;
  color: #a78bfa;
}

.api-key-panel {
  background: #13151f;
  border: 1px solid #2d3348;
  border-radius: 10px;
  padding: 16px;
  margin-bottom: 20px;
}

.api-key-desc {
  font-size: 13px;
  color: #64748b;
  margin-bottom: 12px;
  line-height: 1.5;
}

.api-key-row {
  display: flex;
  gap: 8px;
}

.api-key-input {
  flex: 1;
  background: #1a1d2e;
  border: 1px solid #2d3348;
  border-radius: 6px;
  padding: 8px 12px;
  color: #e2e8f0;
  font-size: 13px;
  font-family: monospace;
  outline: none;
}

.api-key-input:focus {
  border-color: #7c3aed;
}

.api-key-success {
  font-size: 12px;
  color: #4ade80;
  margin-top: 8px;
}

.api-key-error {
  font-size: 12px;
  color: #f87171;
  margin-top: 8px;
}
</style>
