<script setup lang="ts">
import {
  DocumentOutline,
  FolderOutline,
} from '@vicons/ionicons5';
import {
  NIcon,
  NText
} from '@/ui/element-plus-primitives';
import { ref, watch } from 'vue';
type MentionEntry = {
  path: string;
  entryType: 'file' | 'directory';
};
const props = defineProps<{
  entries: MentionEntry[];
  activeIndex: number;
  menuStyle: Record<string, string>;
}>();
const emit = defineEmits<{
  select: [entry: MentionEntry];
  hoverIndex: [index: number];
}>();
const listRef = ref<HTMLDivElement | null>(null);
watch(
  () => props.activeIndex,
  (index) => {
    const el = listRef.value?.querySelector(`[data-mention-index="${index}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  },
);
</script>
<template>
  <div v-if="!entries.length" class="chat-mention-menu" :style="menuStyle">
    <NText depth="3">无匹配文件或文件夹</NText>
  </div>
  <div v-else ref="listRef" class="chat-mention-menu" role="listbox" :style="menuStyle">
    <button
      v-for="(entry, index) in entries"
      :key="`${entry.entryType}:${entry.path}`"
      type="button"
      role="option"
      :aria-selected="index === activeIndex"
      :data-mention-index="index"
      :class="
        index === activeIndex
          ? 'chat-mention-item chat-mention-item-active'
          : 'chat-mention-item'
      "
      @mouseenter="emit('hoverIndex', index)"
      @mousedown.prevent="emit('select', entry)"
    >
      <NIcon
        :component="entry.entryType === 'directory' ? FolderOutline : DocumentOutline"
      />
      <span>
        {{ entry.path }}{{ entry.entryType === 'directory' ? '/' : '' }}
      </span>
    </button>
  </div>
</template>
