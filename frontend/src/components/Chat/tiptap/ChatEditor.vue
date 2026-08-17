<script setup lang="ts">
import type { Editor } from '@tiptap/vue-3';
import { EditorContent } from '@tiptap/vue-3';
defineProps<{
  editor: Editor | null | undefined;
  className?: string;
}>();
</script>
<template>
  <div :class="className">
    <EditorContent :editor="editor ?? undefined" />
  </div>
</template>
