<template>
  <header class="status-bar">
    <div class="status-bar__left">
      <div class="logo">
        <span class="logo-icon">⚡</span>
        <span class="logo-text">Voice AI Copilot</span>
      </div>
    </div>

    <div class="status-bar__right">
      <template v-if="store.isAuthenticated">
        <div class="auth-status auth-status--connected">
          <span class="status-dot status-dot--green"></span>
          <span>Connected</span>
          <span v-if="store.locationId" class="location-id">{{ store.locationId }}</span>
        </div>
        <button class="btn btn-secondary btn-sm" @click="store.logout()">Disconnect</button>
      </template>
      <template v-else>
        <div class="auth-status auth-status--disconnected">
          <span class="status-dot status-dot--red"></span>
          <span>Not connected</span>
        </div>
        <a href="/auth" class="btn btn-primary btn-sm">Connect HighLevel</a>
      </template>
    </div>
  </header>
</template>

<script setup>
import { useCopilotStore } from '../stores/copilot.js';
const store = useCopilotStore();
</script>

<style scoped>
.status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  background: #13151f;
  border-bottom: 1px solid #2d3348;
  position: sticky;
  top: 0;
  z-index: 100;
}

.status-bar__left,
.status-bar__right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.logo {
  display: flex;
  align-items: center;
  gap: 8px;
}

.logo-icon {
  font-size: 20px;
}

.logo-text {
  font-size: 16px;
  font-weight: 700;
  color: #e2e8f0;
}

.auth-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #94a3b8;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.status-dot--green {
  background: #4ade80;
  box-shadow: 0 0 6px #4ade80;
}

.status-dot--red {
  background: #f87171;
}

.location-id {
  font-size: 11px;
  color: #475569;
  font-family: monospace;
}

.btn-sm {
  padding: 6px 14px;
  font-size: 13px;
}
</style>
