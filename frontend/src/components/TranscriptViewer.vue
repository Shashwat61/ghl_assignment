<template>
  <div class="transcript-viewer" ref="messagesEl">
    <div v-if="!transcript || transcript.length === 0" class="empty-state">
      <span class="text-muted">No messages yet</span>
    </div>
    <div v-else class="messages">
      <div
        v-for="(turn, i) in transcript"
        :key="i"
        class="message"
        :class="turn.role === 'user' ? 'message--user' : 'message--agent'"
      >
        <div class="message-meta">
          <span class="message-role">{{ turn.role === 'user' ? '👤 Caller' : '🤖 Agent' }}</span>
        </div>
        <div class="message-content">{{ turn.content }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue';

const props = defineProps({
  transcript: {
    type: Array,
    default: () => [],
  },
});

const messagesEl = ref(null);

async function scrollToBottom() {
  await nextTick();
  if (messagesEl.value) {
    messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
  }
}

// Scroll on new messages
watch(() => props.transcript?.length, scrollToBottom);

// Scroll when transcript is swapped out entirely (case switch)
watch(() => props.transcript, scrollToBottom);
</script>

<style scoped>
.transcript-viewer {
  height: 100%;
  overflow-y: auto;
  padding: 8px;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100px;
  font-size: 13px;
}

.messages {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.message {
  padding: 10px 12px;
  border-radius: 8px;
  max-width: 90%;
}

.message--user {
  background: #1e2130;
  border: 1px solid #2d3348;
  align-self: flex-start;
}

.message--agent {
  background: #1e1633;
  border: 1px solid #3d2a6e;
  align-self: flex-end;
}

.message-meta {
  margin-bottom: 4px;
}

.message-role {
  font-size: 11px;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.message-content {
  font-size: 13px;
  color: #cbd5e1;
  line-height: 1.5;
}
</style>
