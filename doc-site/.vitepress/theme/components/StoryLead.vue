<template>
  <section class="oc-story-lead">
    <p v-if="label" class="oc-story-lead__label">{{ label }}</p>
    <div class="oc-story-lead__body"><slot /></div>
  </section>
</template>

<script setup lang="ts">
defineProps<{ label?: string }>()
</script>
