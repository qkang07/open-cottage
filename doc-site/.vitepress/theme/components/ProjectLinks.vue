<template>
  <div class="oc-project-links" aria-label="官方链接">
    <template v-if="hasLinks">
      <a
        v-if="siteLinks.demo"
        class="oc-project-links__item"
        :href="siteLinks.demo"
        target="_blank"
        rel="noreferrer"
      >
        打开官方 Demo <span aria-hidden="true">↗</span>
      </a>
      <a
        v-if="siteLinks.source"
        class="oc-project-links__item"
        :href="siteLinks.source"
        target="_blank"
        rel="noreferrer"
      >
        获取开源代码 <span aria-hidden="true">↗</span>
      </a>
    </template>
    <p v-else class="oc-project-links__pending">
      官方 Demo 与开源仓库链接将在此提供。
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { siteLinks } from '../../site-links.mjs'

const hasLinks = computed(() => Boolean(siteLinks.demo || siteLinks.source))
</script>

<style scoped>
.oc-project-links {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 1.25rem 0;
}

.oc-project-links__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border: 1px solid var(--vp-c-brand-1);
  border-radius: 6px;
  color: var(--vp-c-brand-1);
  font-size: 0.9rem;
  font-weight: 600;
  text-decoration: none;
}

.oc-project-links__item:hover {
  background: var(--vp-c-brand-soft);
}

.oc-project-links__item:focus-visible {
  outline: 3px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}

.oc-project-links__pending {
  margin: 0;
  color: var(--vp-c-text-2);
  font-size: 0.9rem;
}
</style>
