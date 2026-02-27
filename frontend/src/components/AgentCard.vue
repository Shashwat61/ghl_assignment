<template>
  <div class="agent-card" @click="$emit('select', agent)">
    <div class="agent-card__header">
      <div class="agent-icon">🤖</div>
      <div class="agent-status" :class="statusClass">{{ statusLabel }}</div>
    </div>
    <div class="agent-card__body">
      <h3 class="agent-name">{{ agent.name || 'Unnamed Agent' }}</h3>
      <p class="agent-desc">{{ truncatedDescription }}</p>
    </div>
    <div class="agent-card__footer">
      <span v-if="agent.phoneNumber" class="agent-phone">{{ agent.phoneNumber }}</span>
      <button class="btn btn-primary btn-sm select-btn">Select Agent</button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  agent: {
    type: Object,
    required: true,
  },
});

defineEmits(['select']);

const statusLabel = computed(() => {
  return props.agent.status === 'active' ? 'Active' : (props.agent.status || 'Unknown');
});

const statusClass = computed(() => {
  return props.agent.status === 'active' ? 'status-active' : 'status-inactive';
});

const truncatedDescription = computed(() => {
  const desc = props.agent.description || props.agent.systemPrompt || 'No description available';
  return desc.length > 120 ? desc.slice(0, 120) + '...' : desc;
});
</script>

<style scoped>
.agent-card {
  background: #1a1d2e;
  border: 1px solid #2d3348;
  border-radius: 12px;
  padding: 20px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.agent-card:hover {
  border-color: #7c3aed;
  transform: translateY(-2px);
  box-shadow: 0 4px 20px rgba(124, 58, 237, 0.15);
}

.agent-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.agent-icon {
  font-size: 28px;
}

.agent-status {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 10px;
  border-radius: 12px;
}

.status-active {
  background: #14532d;
  color: #4ade80;
}

.status-inactive {
  background: #1e293b;
  color: #94a3b8;
}

.agent-card__body {
  flex: 1;
}

.agent-name {
  font-size: 16px;
  font-weight: 600;
  color: #e2e8f0;
  margin-bottom: 6px;
}

.agent-desc {
  font-size: 13px;
  color: #64748b;
  line-height: 1.5;
}

.agent-card__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.agent-phone {
  font-size: 12px;
  color: #475569;
  font-family: monospace;
}

.select-btn {
  padding: 6px 14px;
  font-size: 12px;
}
</style>
