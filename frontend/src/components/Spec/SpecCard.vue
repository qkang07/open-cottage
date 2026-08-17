<script setup lang="ts">
import {
  CheckmarkCircle,
  ChevronDownOutline,
  ChevronUpOutline,
  CloseCircle,
  ReloadOutline,
  Time,
} from '@vicons/ionicons5';
import { ElButton, ElProgress, ElTag } from 'element-plus';
import { NIcon, NText } from '@/ui/element-plus-primitives';
import { computed, ref } from 'vue';
import type { SpecDoc, SpecTask } from '../../spec/types';
import { computeSpecProgress } from '../../spec/types';
import { useAgentStore } from '../../stores/agent';

const props = defineProps<{ doc: SpecDoc }>();

const agentStore = useAgentStore();
const expanded = ref(false);

const statusTag = computed(() => {
  const map: Record<
    string,
    { type: 'primary' | 'info' | 'warning' | 'success' | 'danger'; label: string }
  > = {
    drafting: { type: 'info', label: '起草中' },
    awaiting_approval: { type: 'warning', label: '待批准' },
    executing: { type: 'info', label: '执行中' },
    paused: { type: 'warning', label: '已暂停' },
    completed: { type: 'success', label: '已完成' },
    failed: { type: 'danger', label: '失败' },
  };
  return map[props.doc.status] ?? { type: 'primary', label: props.doc.status };
});

const isAwaitingApproval = computed(
  () => props.doc.status === 'awaiting_approval',
);
const isExecuting = computed(() => props.doc.status === 'executing');
const progress = computed(() => computeSpecProgress(props.doc));
const currentTask = computed(() =>
  props.doc.tasks.find((t) => t.status === 'doing'),
);
// 待批准时默认展开，便于用户审阅完整计划
const showBody = computed(() => expanded.value || isAwaitingApproval.value);

const taskIcon: Record<string, typeof Time> = {
  done: CheckmarkCircle,
  doing: ReloadOutline,
  pending: Time,
  failed: CloseCircle,
};
const taskColor: Record<string, string> = {
  done: 'var(--cottage-status-done)',
  doing: 'var(--cottage-status-doing)',
  pending: 'var(--cottage-status-pending)',
  failed: 'var(--cottage-status-failed)',
};

function iconOf(task: SpecTask) {
  return taskIcon[task.status] ?? Time;
}

function toggleExpanded() {
  expanded.value = !expanded.value;
}
</script>
<template>
  <div class="spec-card" :class="{ 'is-approval': isAwaitingApproval }">
    <div class="spec-header">
      <ElTag :type="statusTag.type" :bordered="false" size="small">
        {{ statusTag.label }}
      </ElTag>
      <NText strong class="spec-goal">{{ doc.goal }}</NText>
      <div class="spec-actions">
        <ElButton size="small" @click="agentStore.copyLegacySpecToPlan(doc)">
          复制为新计划
        </ElButton>
        <ElButton text size="small" @click="toggleExpanded">
          <template #icon>
            <NIcon :component="showBody ? ChevronUpOutline : ChevronDownOutline" />
          </template>
        </ElButton>
      </div>
    </div>

    <ElProgress
      type="line"
      :percentage="progress.percent"
      :processing="isExecuting"
      :show-indicator="false"
      :status="doc.status === 'failed' ? 'exception' : ''"
      style="margin-top: 8px"
    />

    <div v-if="currentTask && isExecuting" class="spec-current">
      <NIcon :component="ReloadOutline" class="spin-icon" />
      <NText depth="3">当前：{{ currentTask.title }}</NText>
      <NText depth="3" class="spec-progress-count">
        {{ progress.done }}/{{ progress.total }}
      </NText>
    </div>

    <div v-if="showBody" class="spec-body">
      <template v-if="doc.requirements.length">
        <div class="spec-section-title">需求</div>
        <ul class="spec-list">
          <li v-for="(r, i) in doc.requirements" :key="`req-${i}`">{{ r }}</li>
        </ul>
      </template>

      <template v-if="doc.design">
        <div class="spec-section-title">设计改动</div>
        <NText depth="2" class="spec-design">{{ doc.design }}</NText>
      </template>

      <div class="spec-section-title">任务清单</div>
      <div
        v-for="task in doc.tasks"
        :key="task.id"
        class="spec-task"
        :class="`task-${task.status}`"
      >
        <NIcon
          :component="iconOf(task)"
          :color="taskColor[task.status] ?? 'var(--cottage-status-pending)'"
          :class="{ 'spin-icon': task.status === 'doing' }"
        />
        <NText
          :style="{
            textDecoration: task.status === 'done' ? 'line-through' : undefined,
            color: task.status === 'done' ? 'var(--cottage-text-strike)' : undefined,
          }"
        >
          {{ task.title }}
        </NText>
        <ElTag
          v-if="task.status === 'doing'"
          type="info"
          size="small"
          style="margin-left: auto"
        >
          执行中
        </ElTag>
        <ElTag
          v-else-if="task.status === 'failed'"
          type="danger"
          size="small"
          style="margin-left: auto"
        >
          失败
        </ElTag>
      </div>

      <template v-if="doc.acceptance.length">
        <div class="spec-section-title">验收标准</div>
        <ul class="spec-list">
          <li v-for="(a, i) in doc.acceptance" :key="`acc-${i}`">{{ a }}</li>
        </ul>
      </template>
    </div>
  </div>
</template>
<style scoped>
.spec-card {
  border: 1px solid var(--cottage-border);
  border-radius: var(--cottage-radius-control);
  padding: 12px;
  background: var(--cottage-panel-bg);
  margin: 8px 0;
  box-shadow: var(--cottage-shadow-card);
}
.spec-card.is-approval {
  border-color: var(--cottage-ink);
}
.spec-header {
  display: flex;
  align-items: center;
  gap: 10px;
}
.spec-goal {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.spec-actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 4px;
}
.spec-approval-hint {
  margin-top: 8px;
  font-size: 12px;
}
.spec-current {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  font-size: 12px;
}
.spec-progress-count {
  margin-left: auto;
  font-size: 12px;
}
.spec-body {
  margin-top: 12px;
  max-height: 50vh;
  overflow-y: auto;
}
.spec-section-title {
  font-size: 12px;
  color: var(--cottage-ink-3, #8c8c8c);
  margin: 10px 0 4px;
}
.spec-list {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
}
.spec-list li {
  margin: 2px 0;
}
.spec-design {
  display: block;
  font-size: 13px;
  white-space: pre-wrap;
}
.spec-task {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: 13px;
}
.spin-icon {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
