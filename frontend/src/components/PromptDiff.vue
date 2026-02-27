<template>
  <div class="prompt-diff">
    <div class="diff-columns">
      <div class="diff-col diff-col--before">
        <div class="diff-col__header">
          <span class="diff-label diff-label--before">Before</span>
          <span class="diff-line-count">{{ beforeLines }} lines</span>
        </div>
        <div class="diff-col__content">
          <div
            v-for="(part, i) in diffParts"
            :key="i"
          >
            <div
              v-if="!part.added"
              v-for="(line, j) in getLines(part.value)"
              :key="j"
              class="diff-line"
              :class="part.removed ? 'diff-line--removed' : 'diff-line--unchanged'"
            >
              <span class="diff-marker">{{ part.removed ? '-' : ' ' }}</span>
              <span class="diff-text">{{ line }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="diff-col diff-col--after">
        <div class="diff-col__header">
          <span class="diff-label diff-label--after">After (Pushed ✓)</span>
          <span class="diff-line-count">{{ afterLines }} lines</span>
        </div>
        <div class="diff-col__content">
          <div
            v-for="(part, i) in diffParts"
            :key="i"
          >
            <div
              v-if="!part.removed"
              v-for="(line, j) in getLines(part.value)"
              :key="j"
              class="diff-line"
              :class="part.added ? 'diff-line--added' : 'diff-line--unchanged'"
            >
              <span class="diff-marker">{{ part.added ? '+' : ' ' }}</span>
              <span class="diff-text">{{ line }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import * as Diff from 'diff';

const props = defineProps({
  original: { type: String, default: '' },
  optimized: { type: String, default: '' },
});

const diffParts = computed(() => Diff.diffLines(props.original, props.optimized));

const beforeLines = computed(() => props.original.split('\n').length);
const afterLines = computed(() => props.optimized.split('\n').length);

function getLines(text) {
  return text.split('\n').filter((_, i, arr) => !(i === arr.length - 1 && _ === ''));
}
</script>

<style scoped>
.prompt-diff {
  font-family: 'SFMono-Regular', 'Consolas', 'Liberation Mono', monospace;
  font-size: 12px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #2d3348;
}

.diff-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
}

.diff-col {
  overflow: hidden;
}

.diff-col + .diff-col {
  border-left: 1px solid #2d3348;
}

.diff-col__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: #13151f;
  border-bottom: 1px solid #2d3348;
}

.diff-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.diff-label--before {
  color: #f87171;
}

.diff-label--after {
  color: #4ade80;
}

.diff-line-count {
  font-size: 11px;
  color: #475569;
}

.diff-col__content {
  max-height: 500px;
  overflow-y: auto;
  background: #0f1117;
}

.diff-line {
  display: flex;
  padding: 1px 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.diff-line--unchanged {
  color: #64748b;
}

.diff-line--removed {
  background: rgba(248, 113, 113, 0.08);
  color: #fca5a5;
}

.diff-line--added {
  background: rgba(74, 222, 128, 0.08);
  color: #86efac;
}

.diff-marker {
  flex-shrink: 0;
  width: 16px;
  color: inherit;
  opacity: 0.7;
}

.diff-text {
  flex: 1;
}
</style>
