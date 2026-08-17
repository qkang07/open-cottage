<script setup lang="ts">
import {
  CheckmarkOutline,
  CopyOutline } from '@vicons/ionicons5';

import CottageTooltip from '@/ui/CottageTooltip.vue';
import { NIcon } from '@/ui/element-plus-primitives';
import { computed, ref } from 'vue';
import { highlightCode } from './markdownComponents';
const props = defineProps<{
  code: string;
  language: string;
  className?: string;
}>();
const copied = ref(false);
const lines = computed(() => props.code.split(/\r?\n/));
const highlightedLines = computed(() =>
  lines.value.map((line) => highlightCode(line || ' ', props.language)),
);
const handleCopy = () => {
  void navigator.clipboard.writeText(props.code).then(() => {
    copied.value = true;
    window.setTimeout(() => {
      copied.value = false;
    }, 2000);
  });
};
</script>
<template>
  <div class="code-highlight-root">
    <div
      style="
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 36px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 14px;
        background: var(--cottage-accent-bg);
        border-bottom: 1px solid var(--cottage-border);
        border-radius: var(--cottage-radius-control) var(--cottage-radius-control) 0 0;
        z-index: 1;
      "
    >
      <span
        style="
          font-size: 12px;
          color: var(--cottage-muted);
          font-weight: 500;
          text-transform: uppercase;
        "
      >
        {{ language }}
      </span>
      <CottageTooltip :content="copied ? '已复制' : '复制'" placement="top" delay="lazy">
        <button
          type="button"
          style="
            padding: 3px 8px;
            font-size: 12px;
            line-height: 1;
            color: var(--cottage-muted);
            background: var(--cottage-surface);
            border: 1px solid var(--cottage-border);
            border-radius: var(--cottage-radius-control);
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 4px;
            transition: all 0.2s;
          "
          :style="{ color: copied ? 'var(--cottage-success)' : 'var(--cottage-muted)' }"
          @click="handleCopy"
        >
          <NIcon :component="copied ? CheckmarkOutline : CopyOutline" :size="14" />
          {{ copied ? '已复制' : '复制' }}
        </button>
      </CottageTooltip>
    </div>
    <div :class="['code-highlight-body', className]">
      <table class="code-highlight-table">
        <tbody>
          <tr v-for="(_, index) in lines" :key="index">
            <td class="code-highlight-gutter">
              {{ index + 1 }}
            </td>
            <td class="code-highlight-line">
              <code
                class="hljs"
                v-html="highlightedLines[index] ?? ''"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
