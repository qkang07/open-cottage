<template>
  <aside class="oc-story-beat">
    <p v-if="title" class="oc-story-beat__title">{{ title }}</p>
    <div class="oc-story-beat__body"><slot /></div>
  </aside>
</template>

<script setup lang="ts">
defineProps<{ title?: string }>()
</script>
