<script setup lang="ts">
import {
  CheckmarkCircle,
  ChevronDownOutline,
  ChevronUpOutline,
  CloseCircle,
  PauseCircle,
  PlayCircle,
  ReloadOutline,
  Time,
  } from '@vicons/ionicons5';
import {
  ElButton,
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
import type { OrchestrationState, OrchestrationStep } from '../../orchestrator/types';
import { computeProgress } from '../../orchestrator/state';
import { useAgentStore } from '../../stores/agent';

const props = defineProps<{
  state: OrchestrationState;
}>();

const agentStore = useAgentStore();
const humanAnswer = ref('');
const expanded = ref(false);

const statusTag = computed(() => {
  const map: Record<string, { type: 'primary' | 'info' | 'warning' | 'success' | 'danger'; label: string }> = {
    planning: { type: 'info', label: '制定计划中' },
    awaiting_approval: { type: 'warning', label: '待批准' },
    running: { type: 'info', label: '执行中' },
    paused: { type: 'warning', label: '已暂停' },
    completed: { type: 'success', label: '已完成' },
    failed: { type: 'danger', label: '失败' },
  };
  return map[props.state.status] ?? { type: 'primary', label: props.state.status };
});

const progress = computed(() => computeProgress(props.state));
const currentStep = computed(() =>
  props.state.steps.find((s) => s.id === props.state.currentStepId),
);
const isActive = computed(() =>
  props.state.status === 'running' || props.state.status === 'planning',
);
const isPaused = computed(() => props.state.status === 'paused');
const isAwaitingApproval = computed(
  () => props.state.status === 'awaiting_approval',
);
const isHumanPaused = computed(
  () => agentStore.orchestrator?.humanQuestion,
);
// 待批准时默认展开，便于用户审阅将要执行的步骤
const showBody = computed(() => expanded.value || isAwaitingApproval.value);

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

function handleApprove() {
  agentStore.approveOrchestrationPlan();
}

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

function toggleExpanded() {
  expanded.value = !expanded.value;
}

function stepIcon(step: OrchestrationStep) {
  return statusIcon.value[step.status] ?? Time;
}
</script>
<template>
  <div class="orchestration-card" :class="{ 'is-approval': isAwaitingApproval }">
    <div class="orch-header">
      <ElTag :type="statusTag.type" :bordered="false" size="small">
        {{ statusTag.label }}
      </ElTag>
      <NText strong class="orch-goal">{{ state.goal }}</NText>
      <div class="orch-actions">
        <template v-if="isAwaitingApproval">
          <ElButton type="primary" size="small" @click="handleApprove">
            <template #icon>
              <NIcon :component="PlayCircle" />
            </template>
            批准并执行
          </ElButton>
        </template>
        <template v-else>
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
        </template>
        <ElButton
          v-if="isActive || isPaused || isAwaitingApproval"
          text
          size="small"
          type="danger"
          @click="handleCancel"
        >
          <template #icon>
            <NIcon :component="CloseCircle" />
          </template>
        </ElButton>
        <ElButton text size="small" @click="toggleExpanded">
          <template #icon>
            <NIcon :component="showBody ? ChevronUpOutline : ChevronDownOutline" />
          </template>
        </ElButton>
      </div>
    </div>

    <div v-if="isAwaitingApproval" class="orch-approval-hint">
      <NText depth="3">以下是即将执行的计划，请审阅后点击「批准并执行」。</NText>
    </div>

    <ElProgress
      type="line"
      :percentage="progress.percent"
      :processing="isActive"
      :show-indicator="false"
      :status="state.status === 'failed' ? 'exception' : ''"
      style="margin-top: 8px"
    />

    <div v-if="currentStep && !isAwaitingApproval" class="orch-current">
      <NIcon :component="ReloadOutline" class="spin-icon" />
      <NText depth="3">当前：{{ currentStep.title }}</NText>
      <NText depth="3" class="orch-progress-count">
        {{ progress.done }}/{{ progress.total }}
      </NText>
    </div>

    <div v-if="showBody" class="orch-body">
      <div class="orch-section-title">步骤</div>
      <div
        v-for="step in state.steps"
        :key="step.id"
        class="orch-step"
        :class="`step-${step.status}`"
      >
        <NIcon
          :component="stepIcon(step)"
          :color="statusColor[step.status] ?? 'var(--cottage-status-pending)'"
          :class="{ 'spin-icon': step.status === 'doing' }"
        />
        <NText
          :style="{
            textDecoration: step.status === 'done' ? 'line-through' : undefined,
            color: step.status === 'done' ? 'var(--cottage-text-strike)' : undefined,
          }"
        >
          {{ step.title }}
        </NText>
        <ElTag
          v-if="step.status === 'doing'"
          type="info"
          size="small"
          style="margin-left: auto"
        >
          执行中
        </ElTag>
        <ElTag
          v-else-if="step.status === 'failed'"
          type="danger"
          size="small"
          style="margin-left: auto"
        >
          失败
        </ElTag>
      </div>

      <template v-if="state.artifactIds.length">
        <div class="orch-section-title">产物 ({{ state.artifactIds.length }})</div>
        <NText
          v-for="artifactId in state.artifactIds"
          :key="artifactId"
          depth="3"
          class="orch-artifact"
        >
          {{ artifactId }}
        </NText>
      </template>
    </div>

    <div v-if="isHumanPaused" class="orch-human">
      <NText strong>等待用户输入</NText>
      <NText depth="3">{{ agentStore.orchestrator?.humanQuestion }}</NText>
      <NSpace>
        <ElInput
          v-model="humanAnswer"
          placeholder="输入回复..."
          @keyup.enter="handleAnswer"
        />
        <ElButton type="primary" @click="handleAnswer">回复</ElButton>
      </NSpace>
    </div>
  </div>
</template>
<style scoped>
.orchestration-card {
  border: 1px solid var(--cottage-border);
  border-radius: var(--cottage-radius-control);
  padding: 12px;
  background: var(--cottage-panel-bg);
  margin: 8px 0;
  box-shadow: var(--cottage-shadow-card);
}
.orchestration-card.is-approval {
  border-color: var(--cottage-ink);
}
.orch-header {
  display: flex;
  align-items: center;
  gap: 10px;
}
.orch-goal {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.orch-actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 4px;
}
.orch-approval-hint {
  margin-top: 8px;
  font-size: 12px;
}
.orch-current {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  font-size: 12px;
}
.orch-progress-count {
  margin-left: auto;
  font-size: 12px;
}
.orch-body {
  margin-top: 12px;
  max-height: 50vh;
  overflow-y: auto;
}
.orch-section-title {
  font-size: 12px;
  color: var(--cottage-ink-3, #8c8c8c);
  margin: 8px 0 4px;
}
.orch-step {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}
.orch-artifact {
  display: block;
  font-size: 12px;
}
.orch-human {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
  padding: 12px;
  border-radius: var(--cottage-radius-control);
  background: var(--cottage-bg);
}
.spin-icon {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
