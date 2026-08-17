<script setup lang="ts">
import { NSpin, NText } from '@/ui/element-plus-primitives';
import {
  formatProgressDetail,
  formatProgressPercent,
} from '../../rag/indexProgressSteps';
import type { IndexProgress } from '../../rag/types';

defineProps<{
  progress: IndexProgress;
  compact?: boolean;
}>();
</script>
<template>
  <div :class="compact ? 'index-progress-compact' : 'index-progress-line'">
    <div class="index-progress-status-line">
      <NSpin v-if="compact" size="small" style="--n-size: 12px" />
      <NText
        :depth="compact ? '3' : undefined"
        class="index-progress-status-text"
        :ellipsis="{ tooltip: true }"
      >
        {{ formatProgressDetail(progress) }}
      </NText>
      <NText
        :depth="compact ? '3' : undefined"
        class="index-progress-status-percent"
      >
        {{ formatProgressPercent(progress) }}%
      </NText>
    </div>
  </div>
</template>
