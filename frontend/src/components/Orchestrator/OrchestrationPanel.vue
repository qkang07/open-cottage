<script setup lang="ts">
import {
  CheckmarkCircle,
  CloseCircle,
  PauseCircle,
  PlayCircle,
  ReloadOutline,
  Time,
  } from '@vicons/ionicons5';
import {
  ElButton,
  ElCard,
  ElInput,
  ElProgress,
  ElTag
} from 'element-plus';
import {
  NIcon,
  NSpace,
  NText
} from '@/ui/element-plus-primitives';
import { computed, ref } from 'vue';
import { useAgentStore } from '../../stores/agent';
import { computeProgress } from '../../orchestrator/state';
import type { OrchestrationStep } from '../../orchestrator/types';

const agentStore = useAgentStore();
const humanAnswer = ref('');

const orchestrator = computed(() => agentStore.orchestrator);
const state = computed(() => orchestrator.value?.state);

const statusTag = computed(() => {
  if (!state.value) return { type: 'primary' as const, label: '无' };
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

const artifacts = computed(() =>
  orchestrator.value ? orchestrator.value.artifacts.getAll() : [],
);

const isHumanPaused = computed(
  () => orchestrator.value?.humanQuestion,
);

const statusIcon = computed(() => ({
  done: CheckmarkCircle,
  doing: ReloadOutline,
  pending: Time,
  failed: CloseCircle,
}));

const statusColor: Record<string, string> = {
  done: 'var(--cottage-status-done)',
  doing: 'var(--cottage-status-doing)',
  pending: 'var(--cottage-status-pending)',
  failed: 'var(--cottage-status-failed)',
};

function handlePause() {
  agentStore.pauseOrchestration();
}

function handleResume() {
  agentStore.resumeOrchestration();
}

function handleCancel() {
  agentStore.cancelOrchestration();
}

function handleAnswer() {
  if (!humanAnswer.value.trim()) return;
  agentStore.answerOrchestrationHuman(humanAnswer.value.trim());
  humanAnswer.value = '';
}

function stepIcon(step: OrchestrationStep) {
  return statusIcon.value[step.status] ?? Time;
}
</script>
<template>
  <div class="orchestration-panel">
    <NText v-if="!state" depth="3">暂无活跃编排任务</NText>
    <template v-else>
      <ElCard :title="state.goal" size="small">
        <NSpace vertical>
          <div style="display: flex; align-items: center; gap: 12px">
            <ElTag :type="statusTag.type" :bordered="false">
              {{ statusTag.label }}
            </ElTag>
            <NText depth="3" style="font-size: 12px">
              {{ progress.done }}/{{ progress.total }} 步骤
            </NText>
          </div>

          <ElProgress
            type="line"
            :percentage="progress.percent"
            :processing="state.status === 'running' || state.status === 'planning'"
            :status="state.status === 'failed' ? 'exception' : ''"
          />

          <NSpace>
            <ElButton
              v-if="state.status === 'running' || state.status === 'planning'"
              @click="handlePause"
            >
              <template #icon>
                <NIcon :component="PauseCircle" />
              </template>
              暂停
            </ElButton>
            <ElButton
              v-if="state.status === 'paused' && !isHumanPaused"
              type="primary"
              @click="handleResume"
            >
              <template #icon>
                <NIcon :component="PlayCircle" />
              </template>
              继续
            </ElButton>
            <ElButton
              v-if="state.status !== 'completed' && state.status !== 'failed'"
              type="danger"
              @click="handleCancel"
            >
              <template #icon>
                <NIcon :component="CloseCircle" />
              </template>
              取消
            </ElButton>
          </NSpace>
        </NSpace>
      </ElCard>

      <div v-if="isHumanPaused" class="orchestration-human-panel">
        <NText strong>等待用户输入</NText>
        <NText depth="3">{{ orchestrator?.humanQuestion }}</NText>
        <NSpace>
          <ElInput
            v-model="humanAnswer"
            placeholder="输入回复..."
            @keyup.enter="handleAnswer"
          />
          <ElButton type="primary" @click="handleAnswer">回复</ElButton>
        </NSpace>
      </div>

      <ElCard title="步骤" size="small">
        <div
          v-for="step in state.steps"
          :key="step.id"
          class="orchestration-panel-step"
          :class="`step-${step.status}`"
        >
          <NIcon
            :component="stepIcon(step)"
            :color="statusColor[step.status] ?? 'var(--cottage-status-pending)'"
            :class="{ 'spin-icon': step.status === 'doing' }"
          />
          <div style="flex: 1; min-width: 0">
            <NText
              :style="{
                textDecoration: step.status === 'done' ? 'line-through' : undefined,
                color: step.status === 'done' ? 'var(--cottage-text-strike)' : undefined,
              }"
            >
              {{ step.title }}
            </NText>
            <NText
              v-if="step.description"
              depth="3"
              style="display: block; font-size: 12px"
            >
              {{ step.description }}
            </NText>
            <NText
              v-if="step.error"
              type="danger"
              style="display: block; font-size: 12px"
            >
              {{ step.error }}
            </NText>
          </div>
          <ElTag
            v-if="step.status === 'doing'"
            type="info"
            size="small"
          >
            执行中
          </ElTag>
          <ElTag
            v-else-if="step.status === 'failed'"
            type="danger"
            size="small"
          >
            失败
          </ElTag>
        </div>
      </ElCard>

      <ElCard v-if="artifacts.length" title="产物" size="small">
        <div
          v-for="artifact in artifacts"
          :key="artifact.id"
          style="padding: 4px 0; font-size: 12px"
        >
          <NText code>{{ artifact.name }}</NText>
          <NText depth="3"> ({{ artifact.type }})</NText>
        </div>
      </ElCard>
    </template>
  </div>
</template>
<style scoped>
.orchestration-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
}
.orchestration-human-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: var(--cottage-radius-control);
  background: var(--cottage-bg);
}
.orchestration-panel-step {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 0;
}
.spin-icon {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
