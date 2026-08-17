<template>
  <div class="oc-tip" :data-kind="kind">
    <div class="oc-tip__label">{{ labelText }}</div>
    <div class="oc-tip__body">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{ kind?: 'tip' | 'try' | 'warn' }>(),
  { kind: 'tip' },
)

const labelText = computed(() => {
  if (props.kind === 'try') return '试一试'
  if (props.kind === 'warn') return '注意'
  return '提示'
})
</script>

<style scoped>
.oc-tip {
  margin: 1.25rem 0 1.75rem;
  padding: 14px 16px 14px 18px;
  border-radius: 12px;
  border-left: 3px solid var(--oc-accent);
  background: var(--oc-soft);
}

.oc-tip[data-kind='try'] {
  border-left-color: var(--cottage-energy);
  background: color-mix(in srgb, var(--cottage-energy) 8%, var(--vp-c-bg));
}

.oc-tip[data-kind='warn'] {
  border-left-color: var(--cottage-energy);
  background: color-mix(in srgb, var(--cottage-energy) 10%, var(--vp-c-bg));
}

.oc-tip__label {
  font-size: 0.78rem;
  font-weight: 650;
  letter-spacing: 0.02em;
  color: var(--oc-accent);
  margin-bottom: 6px;
}

.oc-tip__body :deep(p) {
  margin: 0;
  font-size: 0.92rem;
  line-height: 1.65;
  color: var(--vp-c-text-1);
}

.oc-tip__body :deep(p + p) {
  margin-top: 0.55rem;
}

.oc-tip__body :deep(code) {
  font-size: 0.85em;
}
</style>
