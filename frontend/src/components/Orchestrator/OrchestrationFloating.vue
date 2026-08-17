<script setup lang="ts">
import {
  ChevronDownOutline,
  ChevronUpOutline,
  CloseCircle,
  PauseCircle,
  PlayCircle,
  ReloadOutline,
  } from '@vicons/ionicons5';
import {
  ElButton,
  ElCard,
  ElProgress,
  ElTag
} from 'element-plus';
import {
  NIcon,
  NText
} from '@/ui/element-plus-primitives';
import { computed, ref } from 'vue';
import { useAgentStore } from '../../stores/agent';
import { computeProgress } from '../../orchestrator/state';
import OrchestrationPanel from './OrchestrationPanel.vue';

const agentStore = useAgentStore();
const expanded = ref(false);

const orchestrator = computed(() => agentStore.orchestrator);
const state = computed(() => orchestrator.value?.state);

const hasOrchestration = computed(() => Boolean(state.value));
const isActive = computed(
  () => state.value?.status === 'running' || state.value?.status === 'planning',
);
const isPaused = computed(() => state.value?.status === 'paused');

const statusTag = computed(() => {
  if (!state.value) return null;
  const map: Record<string, { type: 'primary' | 'info' | 'warning' | 'success' | 'danger'; label: string }> = {
    planning: { type: 'info', label: '制定计划中' },
    running: { type: 'info', label: '执行中' },
    paused: { type: 'warning', label: '已暂停' },
    completed: { type: 'success', label: '已完成' },
    failed: { type: 'danger', label: '失败' },
  };
  return map[state.value.status] ?? { type: 'primary', label: state.value.status };
});

const progress = computed(() =>
  state.value ? computeProgress(state.value) : { total: 0, done: 0, doing: 0, failed: 0, percent: 0 },
);

const currentStep = computed(() =>
  state.value?.steps.find((s) => s.id === state.value?.currentStepId),
);

function handlePause() {
  agentStore.pauseOrchestration();
}

function handleResume() {
  agentStore.resumeOrchestration();
}

function handleCancel() {
  agentStore.cancelOrchestration();
}

function toggleExpanded() {
  expanded.value = !expanded.value;
}
</script>
<template>
  <div v-if="hasOrchestration" class="orchestration-floating">
    <ElCard size="small" class="orchestration-floating-card">
      <div class="orchestration-floating-header">
        <div class="orchestration-floating-summary">
          <ElTag
            v-if="statusTag"
            :type="statusTag.type"
            :bordered="false"
            size="small"
          >
            {{ statusTag.label }}
          </ElTag>
          <NText depth="3" class="orchestration-floating-step">
            <NIcon
              v-if="isActive"
              :component="ReloadOutline"
              class="spin-icon"
            />
            {{ currentStep ? currentStep.title : '等待中…' }}
          </NText>
        </div>
        <div class="orchestration-floating-actions">
          <ElButton v-if="isActive" text size="small" @click="handlePause">
            <template #icon>
              <NIcon :component="PauseCircle" />
            </template>
          </ElButton>
          <ElButton
            v-else-if="isPaused"
            text
            size="small"
            type="primary"
            @click="handleResume"
          >
            <template #icon>
              <NIcon :component="PlayCircle" />
            </template>
          </ElButton>
          <ElButton text size="small" type="danger" @click="handleCancel">
            <template #icon>
              <NIcon :component="CloseCircle" />
            </template>
          </ElButton>
          <ElButton text size="small" @click="toggleExpanded">
            <template #icon>
              <NIcon :component="expanded ? ChevronDownOutline : ChevronUpOutline" />
            </template>
          </ElButton>
        </div>
      </div>

      <ElProgress
        v-if="!expanded"
        type="line"
        :percentage="progress.percent"
        :processing="isActive"
        :show-indicator="false"
        :status="state?.status === 'failed' ? 'exception' : ''"
        style="margin-top: 8px"
      />

      <div v-if="expanded" class="orchestration-floating-body">
        <OrchestrationPanel />
      </div>
    </ElCard>
  </div>
</template>
<style scoped>
.orchestration-floating {
  position: sticky;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 8px 12px;
  background: linear-gradient(to top, var(--cottage-bg), transparent);
  z-index: 10;
}
.orchestration-floating-card {
  box-shadow: 0 -2px 8px rgba(31, 35, 41, 0.06);
  border: 1px solid var(--cottage-border);
}
.orchestration-floating-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.orchestration-floating-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}
.orchestration-floating-step {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.orchestration-floating-actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 4px;
}
.orchestration-floating-body {
  margin-top: 12px;
  max-height: 50vh;
  overflow-y: auto;
}
.spin-icon {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
