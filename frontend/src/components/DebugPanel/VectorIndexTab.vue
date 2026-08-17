<script setup lang="ts">
import IndexPanel from '../Rag/IndexPanel.vue';

defineProps<{
  visible: boolean;
}>();
</script>

<template>
  <div class="vector-index-tab">
    <IndexPanel />
  </div>
</template>

<style scoped>
.vector-index-tab {
  height: 100%;
  min-height: 0;
  overflow: auto;
}
</style>
