<script setup lang="ts">
import DOMPurify from 'dompurify';
import { computed, ref } from 'vue';
import { getWordAnchorFromSelection } from '../../chat/previewSelection';
import type { WordAnchor } from '../../chat/fileReferences';
const props = defineProps<{
  html: string;
  onSelectionChange?: (anchor: WordAnchor | null) => void;
}>();
const rootRef = ref<HTMLElement | null>(null);
// 对 docx 转换出的 HTML 进行消毒，防止注入恶意脚本
const safeHtml = computed(() =>
  DOMPurify.sanitize(props.html, {
    ADD_TAGS: ['img'],
    ADD_ATTR: ['src', 'alt', 'style', 'class', 'colspan', 'rowspan'],
  }),
);
const handleMouseUp = () => {
  if (!rootRef.value || !props.onSelectionChange) return;
  const anchor = getWordAnchorFromSelection(rootRef.value);
  props.onSelectionChange(anchor);
};
</script>
<template>
  <article
    ref="rootRef"
    class="office-preview word-preview selectable-preview"
    v-html="safeHtml"
    @mouseup="handleMouseUp"
  />
</template>
