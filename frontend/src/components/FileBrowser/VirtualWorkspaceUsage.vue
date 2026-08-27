<script setup lang="ts">
import { ServerOutline } from '@vicons/ionicons5';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import CottageTooltip from '@/ui/CottageTooltip.vue';
import { NIcon } from '@/ui/element-plus-primitives';
import { useWorkspaceStore } from '../../stores/workspace';

defineProps<{ compact?: boolean }>();

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
const { activeWorkspaceKind, virtualWorkspaceUsageBytes } = storeToRefs(workspaceStore);

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = units[0]!;
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index]!;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${unit}`;
};

const usage = computed(() => formatBytes(virtualWorkspaceUsageBytes.value));
const tooltip = computed(() =>
  t('layout.virtualWorkspaceUsageDetail', { size: usage.value }),
);
</script>

<template>
  <CottageTooltip
    v-if="activeWorkspaceKind === 'virtual'"
    :content="tooltip"
    :placement="compact ? 'right' : 'top'"
  >
    <span
      class="virtual-workspace-usage"
      :class="{ 'virtual-workspace-usage--compact': compact }"
      :aria-label="tooltip"
    >
      <NIcon :component="ServerOutline" />
      <span v-if="!compact">{{ t('layout.virtualWorkspaceUsage', { size: usage }) }}</span>
    </span>
  </CottageTooltip>
</template>

