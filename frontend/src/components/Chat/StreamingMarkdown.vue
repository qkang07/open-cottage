<script setup lang="ts">
import { computed } from 'vue';
import { renderMarkdown, splitStreamingMarkdownBlocks } from './markdownRender';

const props = defineProps<{
  text: string;
  streaming?: boolean;
}>();

/** 已封闭段落的 html 缓存，避免每个 stream tick 重跑 markdown-it */
const sealedHtmlCache = new Map<string, string>();

const blocks = computed(() => {
  const raw = splitStreamingMarkdownBlocks(props.text);
  if (!props.streaming && props.text.length === 0) {
    sealedHtmlCache.clear();
  }
  return raw.map((block) => {
    if (!block.tail) {
      const cached = sealedHtmlCache.get(block.key);
      if (cached !== undefined) {
        return { ...block, html: cached };
      }
      const html = block.html || renderMarkdown(block.text);
      sealedHtmlCache.set(block.key, html);
      return { ...block, html };
    }
    return block;
  });
});
</script>

<template>
  <div class="markdown-body">
    <div
      v-for="block in blocks"
      :key="block.key"
      :class="block.tail ? 'md-stream-tail' : 'md-stream-block'"
      v-html="block.html"
    />
  </div>
</template>
