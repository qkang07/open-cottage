<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { NSpin, NText } from '@/ui/element-plus-primitives';
import type { AgentStatus } from '../../agent/CottageAgent';

const props = defineProps<{
  status: AgentStatus;
}>();

const { t } = useI18n();

const view = computed(() => {
  switch (props.status.phase) {
    case 'thinking':
      return {
        label: t('chat.statusThinking'),
        hint: t('chat.statusThinkingHint'),
      };
    case 'streaming':
      return {
        label: t('chat.statusReplying'),
        hint: t('chat.statusReplyingHint'),
      };
    case 'tool_args':
      return {
        label: t('chat.statusBuildingTool', { name: props.status.toolName }),
        hint: t('chat.statusBuildingToolHint'),
      };
    case 'tool_call':
      return {
        label: t('chat.statusRunningTool', { name: props.status.toolName }),
        hint: t('chat.statusRunningToolHint'),
      };
    case 'approval':
      return {
        label:
          props.status.toolName === 'doom_loop'
            ? t('chat.statusAwaitDoomLoop')
            : t('chat.statusAwaitApproval', { name: props.status.toolName }),
        hint: t('chat.statusAwaitApprovalHint'),
      };
    default:
      return null;
  }
});
</script>

<template>
  <div v-if="view" class="agent-status-bar">
    <NSpin size="small" />
    <NText strong class="agent-status-bar-label">{{ view.label }}</NText>
    <NText depth="3" class="agent-status-bar-hint">{{ view.hint }}</NText>
  </div>
</template>
