<script setup lang="ts">
import { ElButton, ElTag } from 'element-plus';
import { NText } from '@/ui/element-plus-primitives';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAgentStore } from '../../stores/agent';
import {
  getPendingStagedApproval,
  pendingStagedApprovalRevision,
  resolvePendingStagedApproval,
} from '../../platform/staging';

/**
 * 聊天内的暂存审阅横幅：始终可见的入口，不依赖中间预览区是否展示。
 * 待审批项按「当前展示的 Agent 自身 sessionId」解析，避免全局活跃交互会话漂移导致取不到项。
 */
const { t } = useI18n();
const agentStore = useAgentStore();
const { chat, activeChatId } = storeToRefs(agentStore);

const stagedSessionId = computed<string | null>(
  () => chat.value?.getSessionId() ?? activeChatId.value ?? null,
);
const pending = computed(() => {
  void pendingStagedApprovalRevision.value;
  return getPendingStagedApproval(stagedSessionId.value);
});
const fileCount = computed(() => {
  void pendingStagedApprovalRevision.value;
  return pending.value?.store.pendingEntriesList().length ?? 0;
});

function approveAll() {
  resolvePendingStagedApproval('approved', stagedSessionId.value);
}
function discardAll() {
  resolvePendingStagedApproval('discarded', stagedSessionId.value);
}
</script>

<template>
  <div
    v-if="pending && fileCount > 0"
    class="pending-gate-banner"
    data-kind="approval"
    data-risk="write"
  >
    <div class="pending-gate-banner-inner">
      <div class="pending-gate-banner-head">
        <ElTag size="small" class="tool-call-risk-tag" data-risk="write" effect="plain">
          {{ t('settings.riskWrite') }}
        </ElTag>
        <NText strong class="pending-gate-banner-title">
          {{ t('staged.bannerTitle') }}
        </NText>
      </div>
      <NText class="pending-gate-banner-message" depth="2">
        {{ t('staged.bannerHint', { n: fileCount }) }}
      </NText>
      <div class="pending-gate-banner-actions">
        <ElButton type="primary" size="small" @click="approveAll">
          {{ t('staged.approveMerge') }}
        </ElButton>
        <ElButton size="small" @click="discardAll">
          {{ t('staged.discardAll') }}
        </ElButton>
      </div>
    </div>
  </div>
</template>
