<template>
  <ol class="oc-steps">
    <li v-for="(step, i) in items" :key="i" class="oc-steps__item">
      <div class="oc-steps__n">{{ String(i + 1).padStart(2, '0') }}</div>
      <div class="oc-steps__body">
        <h4 class="oc-steps__title">{{ step.title }}</h4>
        <p class="oc-steps__text">{{ step.text }}</p>
      </div>
    </li>
  </ol>
</template>

<script setup lang="ts">
defineProps<{
  items: { title: string; text: string }[]
}>()
</script>

<style scoped>
.oc-steps {
  list-style: none;
  padding: 0;
  margin: 1.25rem 0 2rem;
  display: grid;
  gap: 12px;
}

.oc-steps__item {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 14px;
  align-items: start;
  padding: 14px 16px;
  border-radius: 12px;
  background: var(--oc-soft);
  border: 1px solid var(--oc-line);
}

.oc-steps__n {
  font-family: var(--oc-mono);
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--oc-accent);
  letter-spacing: 0.04em;
  padding-top: 3px;
}

.oc-steps__title {
  margin: 0 0 4px;
  font-size: 1rem;
  font-weight: 650;
}

.oc-steps__text {
  margin: 0;
  font-size: 0.92rem;
  color: var(--vp-c-text-2);
  line-height: 1.6;
}
</style>
