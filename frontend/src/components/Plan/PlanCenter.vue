<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ElButton, ElEmpty, ElMessage, ElTag } from 'element-plus';
import { NSpin } from '@/ui/element-plus-primitives';
import { useAgentStore } from '../../stores/agent';
import type { StoredPlan } from '../../plan/persistence';

const emit = defineEmits<{ (event: 'close'): void }>();
const agentStore = useAgentStore();
const { t } = useI18n();
const plans = ref<StoredPlan[]>([]);
const loading = ref(true);
const openingId = ref<string | null>(null);

const statusText: Record<StoredPlan['run']['status'], string> = {
  draft: 'chat.planStatusDraft',
  awaiting_approval: 'chat.planStatusAwaitingApproval',
  running: 'chat.planStatusRunning',
  waiting_for_user: 'chat.planStatusWaitingUser',
  paused: 'chat.planStatusPaused',
  verifying: 'chat.planStatusVerifying',
  awaiting_acceptance: 'chat.planStatusAwaitingAcceptance',
  completed: 'chat.planStatusCompleted',
  failed: 'chat.planStatusFailed',
  cancelled: 'chat.planStatusCancelled',
};

async function reload() {
  loading.value = true;
  try {
    plans.value = await agentStore.listWorkspacePlans();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
  } finally {
    loading.value = false;
  }
}

async function openPlan(planId: string) {
  openingId.value = planId;
  try {
    await agentStore.openPlan(planId);
    emit('close');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
  } finally {
    openingId.value = null;
  }
}

onMounted(reload);
</script>

<template>
  <section class="plan-center">
    <div v-if="loading" class="plan-center-loading"><NSpin size="small" />{{ t('chat.planCenterLoading') }}</div>
    <ElEmpty v-else-if="!plans.length" :description="t('chat.planCenterEmpty')" />
    <div v-else class="plan-center-list">
      <article v-for="item in plans" :key="item.definition.id" class="plan-center-item">
        <div class="plan-center-main">
          <div class="plan-center-title">
            <strong>{{ item.definition.goal }}</strong>
            <ElTag size="small" effect="plain">{{ t(statusText[item.run.status]) }}</ElTag>
            <ElTag v-if="item.run.archivedAt" size="small" effect="plain">{{ t('chat.planArchived') }}</ElTag>
            <ElTag v-if="item.run.repositoryCorrupt" size="small" type="danger">{{ t('chat.planRecoveryRequired') }}</ElTag>
          </div>
          <small>revision {{ item.definition.revision }} · {{ t('chat.planActualFiles', { n: item.run.changedFiles.length }) }}</small>
          <small>{{ new Date(item.run.updatedAt).toLocaleString() }}</small>
          <span v-if="item.run.pendingReason" class="plan-center-reason">{{ item.run.pendingReason }}</span>
        </div>
        <ElButton
          size="small"
          :loading="openingId === item.definition.id"
          @click="openPlan(item.definition.id)"
        >{{ item.run.archivedAt && !['completed', 'failed', 'cancelled'].includes(item.run.status) ? t('chat.planRestoreOpen') : t('chat.planOpenSession') }}</ElButton>
      </article>
    </div>
  </section>
</template>

<style scoped>
.plan-center { min-height: 160px; }
.plan-center-loading { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 160px; color: var(--el-text-color-secondary); }
.plan-center-list { display: grid; gap: 10px; }
.plan-center-item { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 12px; border: 1px solid var(--el-border-color-lighter); border-radius: 10px; }
.plan-center-main { display: grid; gap: 4px; min-width: 0; }
.plan-center-title { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.plan-center-title strong { overflow-wrap: anywhere; }
.plan-center-main small { color: var(--el-text-color-secondary); }
.plan-center-reason { color: var(--el-color-warning-dark-2); font-size: 12px; }
</style>
