<script setup lang="ts">
import {
  CloseOutline,
  DocumentOutline,
  FolderOutline } from '@vicons/ionicons5';

import CottageTooltip from '@/ui/CottageTooltip.vue';
import { NIcon } from '@/ui/element-plus-primitives';
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';
const props = defineProps(nodeViewProps);
</script>
<template>
  <NodeViewWrapper
    as="span"
    :class="
      props.selected
        ? 'file-reference-chip-inline file-reference-chip-inline-selected'
        : 'file-reference-chip-inline'
    "
    data-drag-handle
  >
    <CottageTooltip :content="String(props.node.attrs.path ?? '')" placement="top" delay="lazy">
      <span class="file-reference-chip-inner">
        <NIcon
          :component="props.node.attrs.entryType === 'directory' ? FolderOutline : DocumentOutline"
          class="file-reference-chip-icon"
        />
        <span class="file-reference-chip-label">{{ props.node.attrs.label }}</span>
      </span>
    </CottageTooltip>
    <span
      class="file-reference-chip-close"
      role="button"
      tabindex="0"
      @click.stop="props.deleteNode"
      @keydown.enter.prevent="props.deleteNode"
      @keydown.space.prevent="props.deleteNode"
    >
      <NIcon :component="CloseOutline" />
    </span>
  </NodeViewWrapper>
</template>
