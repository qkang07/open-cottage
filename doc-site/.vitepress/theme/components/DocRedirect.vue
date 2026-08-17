<template>
  <p class="oc-doc-redirect">
    此页面已迁移到 <a :href="target">{{ label }}</a>。
  </p>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { withBase } from 'vitepress'

const props = defineProps<{
  to: string
  label: string
}>()

const target = withBase(props.to)

onMounted(() => {
  window.location.replace(target)
})
</script>

<style scoped>
.oc-doc-redirect {
  margin: 3rem auto;
  color: var(--vp-c-text-2);
  text-align: center;
}
</style>
