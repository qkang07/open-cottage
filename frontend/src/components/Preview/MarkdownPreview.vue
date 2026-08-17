<script setup lang="ts">
import { computed } from 'vue';
import { MdPreview } from 'md-editor-v3';
import DOMPurify from 'dompurify';
import { useThemeStore } from '@/stores/theme';

defineProps<{
  content: string;
}>();

const themeStore = useThemeStore();
const theme = computed<'light' | 'dark'>(() =>
  themeStore.isDark ? 'dark' : 'light',
);

// 复用项目已引入的 DOMPurify，对渲染后的 HTML 做一次消毒，防止 XSS。
const sanitize = (html: string): string => DOMPurify.sanitize(html);
</script>
<template>
  <MdPreview
    class="cottage-md-preview"
    :model-value="content"
    :theme="theme"
    preview-theme="github"
    code-theme="github"
    :no-katex="true"
    :no-mermaid="true"
    :sanitize="sanitize"
  />
</template>
