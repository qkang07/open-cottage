<script setup lang="ts">
import { ElButton, ElTag } from 'element-plus';
import { NSpace, NText } from '@/ui/element-plus-primitives';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ToolCallInteraction } from '../../chat/toolCallInteraction';
import { toolLocaleAlias, toolRisk } from '../../agent/toolDescriptions';
import type { CapabilityRiskLevel } from '../../platform/capabilities/types';
import AskUserPrompt from './AskUserPrompt.vue';

const props = defineProps<{
  callId: string;
  toolName: string;
  interaction: ToolCallInteraction;
}>();

const emit = defineEmits<{
  resolveToolApproval: [callId: string, approved: boolean];
  resolveAskUser: [callId: string, chosen: string];
  cancelAskUser: [callId: string];
}>();

const { t } = useI18n();

const RISK_I18N: Record<CapabilityRiskLevel, string> = {
  read: 'settings.riskRead',
  write: 'settings.riskWrite',
  external: 'settings.riskExternal',
  destructive: 'settings.riskDestructive',
};

const pending = computed(() => props.interaction.status === 'pending');
const toolApproval = computed(() =>
  props.interaction.kind === 'tool_approval' ? props.interaction : null,
);
const askUser = computed(() =>
  props.interaction.kind === 'ask_user' ? props.interaction : null,
);
const riskLevel = computed(() => toolRisk(props.toolName) ?? null);
const isDoomLoop = computed(
  () => toolApproval.value?.approvalKind === 'doom_loop',
);

const approvalTitle = computed(() => {
  if (!toolApproval.value) return '';
  if (toolApproval.value.title) return toolApproval.value.title;
  if (isDoomLoop.value) return t('chat.doomLoopDetected');
  return t('chat.needConfirm', { tool: toolLocaleAlias(props.toolName) });
});

const statusLabel = computed(() => {
  switch (props.interaction.status) {
    case 'pending':
      return null;
    case 'resolved':
      return t('chat.componentResolved');
    case 'cancelled':
      return t('chat.componentCancelled');
    default:
      return props.interaction.status;
  }
});

const riskLabel = computed(() => {
  const level = riskLevel.value;
  return level ? t(RISK_I18N[level]) : null;
});
</script>

<template>
  <div
    class="chat-component-card"
    :data-kind="interaction.kind"
    :data-approval-kind="toolApproval?.approvalKind ?? undefined"
    :data-status="interaction.status"
  >
    <template v-if="toolApproval">
      <div class="chat-component-card-head">
        <ElTag
          v-if="isDoomLoop"
          size="small"
          type="warning"
          effect="plain"
        >
          {{ t('chat.doomLoopTag') }}
        </ElTag>
        <ElTag
          v-else-if="riskLevel && riskLabel"
          size="small"
          class="tool-call-risk-tag"
          :data-risk="riskLevel"
          effect="plain"
        >
          {{ riskLabel }}
        </ElTag>
        <NText strong>
          {{ approvalTitle }}
        </NText>
        <ElTag v-if="statusLabel" size="small" type="info">{{ statusLabel }}</ElTag>
      </div>
      <NText
        v-if="!isDoomLoop || toolName !== 'doom_loop'"
        depth="3"
        class="chat-component-card-tool"
      >
        相关工具：{{ toolLocaleAlias(toolName) }}
      </NText>
      <NText depth="2" class="chat-component-card-message">
        {{ toolApproval.message }}
      </NText>
      <NSpace v-if="pending" wrap class="chat-component-card-actions">
        <ElButton
          type="primary"
          size="small"
          @click="emit('resolveToolApproval', callId, true)"
        >
          {{ isDoomLoop ? '允许再试一次' : t('chat.allow') }}
        </ElButton>
        <ElButton
          size="small"
          @click="emit('resolveToolApproval', callId, false)"
        >
          {{ isDoomLoop ? '拒绝并换思路' : t('chat.reject') }}
        </ElButton>
      </NSpace>
      <NText
        v-else-if="toolApproval.decision"
        depth="3"
        class="chat-component-card-decision"
      >
        {{
          toolApproval.decision.approved
            ? isDoomLoop
              ? '已允许再试一次'
              : t('chat.allow')
            : isDoomLoop
              ? '已拒绝，跳过此次调用'
              : t('chat.reject')
        }}
      </NText>
    </template>

    <template v-else-if="askUser">
      <AskUserPrompt
        :question="askUser.question"
        :options="askUser.options"
        :answered="askUser.decision?.chosen ?? null"
        :status-text="pending ? null : statusLabel"
        @submit="(choice) => emit('resolveAskUser', callId, choice)"
        @cancel="emit('cancelAskUser', callId)"
      />
    </template>
  </div>
</template>

<style scoped>
.chat-component-card {
  margin-top: 8px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--cottage-border, rgba(0, 0, 0, 0.08));
  background: var(--cottage-surface-raised, rgba(0, 0, 0, 0.02));
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
}
.chat-component-card[data-status='pending'] {
  border-color: var(--cottage-accent, #3b82f6);
}
.chat-component-card[data-approval-kind='doom_loop'][data-status='pending'] {
  border-color: var(--el-color-warning);
  background: color-mix(in srgb, var(--el-color-warning) 8%, transparent);
}
.chat-component-card-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.chat-component-card-tool {
  display: block;
  margin-bottom: 4px;
  font-size: 12px;
}
.chat-component-card-message {
  display: block;
  margin-bottom: 8px;
  white-space: pre-wrap;
}
.chat-component-card-decision {
  display: block;
  margin-top: 4px;
}
</style>
