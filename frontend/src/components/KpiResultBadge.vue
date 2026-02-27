<template>
  <span class="kpi-badge" :class="badgeClass">
    {{ label }}
  </span>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  result: {
    type: String,
    required: true,
    validator: (v) => ['pass', 'fail', 'pending'].includes(v),
  },
});

const badgeClass = computed(() => `badge badge-${props.result}`);
const label = computed(() => {
  const labels = { pass: '✓ Pass', fail: '✗ Fail', pending: '— Pending' };
  return labels[props.result] || props.result;
});
</script>

<style scoped>
.kpi-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.03em;
}
</style>
