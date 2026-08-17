<script setup lang="ts">
import {
  CheckmarkCircle,
  EllipseOutline,
  ReloadOutline,
  Time,
  } from '@vicons/ionicons5';
import {
  ElProgress,
  ElTag
} from 'element-plus';
import {
  NIcon,
  NSpace,
  NText
} from '@/ui/element-plus-primitives';
import { computed } from 'vue';
import { DEFAULT_MAX_TURNS } from '../../config/constants';
import type { TaskPlan, TaskState, TaskSpec } from '../../task/types';
const props = defineProps<{
  state: TaskState;
  plan: TaskPlan | null;
  spec?: TaskSpec | null;
  isRunning: boolean;
}>();
const maxTurns = computed(() => props.spec?.maxTurns ?? DEFAULT_MAX_TURNS);
const turnCount = computed(() => props.state.turnCount);
const percent = computed(() =>
  Math.min(100, Math.round((turnCount.value / maxTurns.value) * 100)),
);
const status = computed(() => (props.isRunning ? 'running' : props.state.status));
const doneCount = computed(
  () => props.plan?.steps.filter((s) => s.status === 'done').length ?? 0,
);
const totalSteps = computed(() => props.plan?.steps.length ?? 0);
const stepPercent = computed(() =>
  totalSteps.value > 0 ? Math.round((doneCount.value / totalSteps.value) * 100) : 0,
);
const stateTypeMap: Record<string, 'primary' | 'info' | 'success' | 'warning' | 'danger'> = {
  running: 'info',
  paused: 'warning',
  completed: 'success',
  failed: 'danger',
  draft: 'primary',
  cancelled: 'primary',
};
const stateLabelMap: Record<string, string> = {
  running: '运行中',
  paused: '已暂停',
  completed: '已完成',
  failed: '失败',
  draft: '草稿',
  cancelled: '已取消',
};
const statusIcon: Record<string, typeof CheckmarkCircle> = {
  done: CheckmarkCircle,
  doing: ReloadOutline,
  pending: Time,
};
const statusColor: Record<string, string> = {
  done: 'var(--cottage-status-done-bg)',
  doing: 'var(--cottage-status-doing-bg)',
  pending: 'var(--cottage-status-pending-bg)',
};
</script>
<template>
  <div style="margin-bottom: 12px">
    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px">
      <ElTag :type="stateTypeMap[status] ?? 'default'" :bordered="false">
        {{ stateLabelMap[status] ?? status }}
      </ElTag>
      <div style="flex: 1">
        <ElProgress
          type="line"
          :percentage="percent"
          :processing="isRunning"
          :status="percent >= 100 && !isRunning ? 'exception' : ''"
        >
          <span style="font-size: 12px">{{ turnCount }}/{{ maxTurns }} 轮</span>
        </ElProgress>
      </div>
    </div>
    <div v-if="totalSteps > 0" style="margin-bottom: 8px">
      <NText depth="3" style="font-size: 12px">
        计划步骤：{{ doneCount }}/{{ totalSteps }} 完成
      </NText>
      <ElProgress
        type="line"
        :percentage="stepPercent"
        :show-indicator="false"
        color="var(--cottage-status-done)"
        style="margin-top: 2px"
      />
    </div>
    <div v-if="plan?.steps.length" style="margin-top: 8px">
      <div
        v-for="step in plan.steps"
        :key="step.id"
        :style="{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '4px 8px',
          borderRadius: '4px',
          backgroundColor: statusColor[step.status] ?? 'transparent',
          marginBottom: '2px',
          borderLeft:
            step.status === 'doing'
              ? '3px solid var(--cottage-ink)'
              : '3px solid transparent',
        }"
      >
        <NIcon
          :component="statusIcon[step.status] ?? EllipseOutline"
          :class="{ 'spin-icon': step.status === 'doing' }"
          :color="
            step.status === 'done'
              ? 'var(--cottage-status-done)'
              : step.status === 'doing'
                ? 'var(--cottage-status-doing)'
                : 'var(--cottage-status-pending)'
          "
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
          style="margin-left: auto; font-size: 11px"
        >
          执行中
        </ElTag>
      </div>
    </div>
    <NSpace v-else-if="isRunning">
      <NIcon :component="ReloadOutline" class="spin-icon" />
      <NText depth="3">等待 Agent 提交计划…</NText>
    </NSpace>
  </div>
</template>
<style scoped>
.spin-icon {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
