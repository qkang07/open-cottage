<script setup lang="ts">
import {
  CaretDown,
  CaretForward,
  CheckmarkCircle,
  CloseCircle,
  Create,
  Flag,
  Flash,
  Flask,
  GitBranch,
  ColorPaletteOutline,
  PauseCircle,
  PlayCircle,
  Time,
  AddCircle,
  } from '@vicons/ionicons5';
import {
  ElTimeline,
  ElTimelineItem
} from 'element-plus';
import {
  NIcon,
  NText
} from '@/ui/element-plus-primitives';
import { computed, ref, type Component } from 'vue';
import type { TaskEvent, TaskEventType } from '../../task/types';
const props = defineProps<{
  events: TaskEvent[];
  maxItems?: number;
}>();
const expandedDetails = ref<Set<number>>(new Set());
const eventIcon: Record<TaskEventType, Component> = {
  created: AddCircle,
  started: PlayCircle,
  turn: Flash,
  plan: Flask,
  instruction: Create,
  complete_signal: Flag,
  deliverable_canvas: ColorPaletteOutline,
  verified: CheckmarkCircle,
  handoff: GitBranch,
  subtask: GitBranch,
  paused: PauseCircle,
  resumed: PlayCircle,
  failed: CloseCircle,
  completed: CheckmarkCircle,
  cancelled: CloseCircle,
};
const eventColor: Record<TaskEventType, string> = {
  created: 'var(--cottage-tl-neutral)',
  started: 'var(--cottage-tl-positive)',
  turn: 'var(--cottage-tl-neutral)',
  plan: 'var(--cottage-tl-info)',
  instruction: 'var(--cottage-tl-info)',
  complete_signal: 'var(--cottage-tl-warning)',
  deliverable_canvas: 'var(--cottage-tl-neutral)',
  verified: 'var(--cottage-tl-positive)',
  handoff: 'var(--cottage-tl-neutral)',
  subtask: 'var(--cottage-tl-info)',
  paused: 'var(--cottage-tl-warning)',
  resumed: 'var(--cottage-tl-positive)',
  failed: 'var(--cottage-tl-danger)',
  completed: 'var(--cottage-tl-positive)',
  cancelled: 'var(--cottage-tl-muted)',
};
const eventLabel: Record<TaskEventType, string> = {
  created: '创建任务',
  started: '开始执行',
  turn: '完成一轮',
  plan: '更新计划',
  instruction: '人工指令',
  complete_signal: '提交交付清单',
  deliverable_canvas: 'Canvas 交付物',
  verified: '验收检查',
  handoff: '任务交接',
  subtask: '子任务',
  paused: '暂停',
  resumed: '继续执行',
  failed: '执行失败',
  completed: '任务完成',
  cancelled: '已取消',
};
const displayed = computed(() =>
  [...props.events].slice(-(props.maxItems ?? 20)).reverse(),
);
function formatTime(timestamp: number) {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  if (isToday) return time;
  return `${date.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit' })} ${time}`;
}
function formatEventSummary(event: TaskEvent): string {
  const detail = event.detail ?? {};
  if (event.type === 'turn' && typeof detail.turn === 'number') {
    return `第 ${detail.turn} 轮`;
  }
  if (event.type === 'verified') {
    return detail.ok === false
      ? `未通过：${String(detail.reason ?? '')}`
      : '验收通过';
  }
  if (event.type === 'failed') {
    return String(detail.reason ?? '未知错误');
  }
  if (event.type === 'instruction') {
    const content = String(detail.content ?? '');
    return content.length > 60 ? `${content.slice(0, 60)}…` : content;
  }
  if (event.type === 'plan' && typeof detail.stepCount === 'number') {
    return `${detail.stepCount} 个步骤`;
  }
  if (event.type === 'complete_signal' && typeof detail.pathCount === 'number') {
    return `${detail.pathCount} 个交付路径`;
  }
  if (event.type === 'deliverable_canvas' && typeof detail.kind === 'string') {
    return String(detail.kind);
  }
  if (event.type === 'subtask') {
    const action = String(detail.action ?? '');
    if (action === 'started') return String(detail.goal ?? '').slice(0, 60);
    if (action === 'completed') return String(detail.summary ?? '已完成').slice(0, 60);
    if (action === 'failed') return String(detail.error ?? '失败').slice(0, 60);
  }
  if (event.type === 'handoff' && typeof detail.remainingCount === 'number') {
    return `剩余 ${detail.remainingCount} 项`;
  }
  return '';
}
function toggleDetail(index: number) {
  const next = new Set(expandedDetails.value);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  expandedDetails.value = next;
}
</script>
<template>
  <NText v-if="!displayed.length" depth="3">
    <NIcon :component="Time" style="margin-right: 4px; vertical-align: -2px" />
    暂无事件
  </NText>
  <ElTimeline v-else class="task-event-timeline">
    <ElTimelineItem
      v-for="(event, index) in displayed"
      :key="`${event.at}-${event.type}-${index}`"
      :color="eventColor[event.type] ?? 'var(--cottage-tl-muted)'"
    >
      <template #icon>
        <NIcon :component="eventIcon[event.type]" :color="eventColor[event.type]" />
      </template>
      <div style="padding-bottom: 4px">
        <div style="display: flex; align-items: baseline; gap: 8px">
          <NText strong style="font-size: 13px">
            {{ eventLabel[event.type] ?? event.type }}
          </NText>
          <NText depth="3" style="font-size: 11px">{{ formatTime(event.at) }}</NText>
        </div>
        <NText v-if="formatEventSummary(event)" depth="3" style="font-size: 12px">
          {{ formatEventSummary(event) }}
        </NText>
        <div
          v-if="event.detail && Object.keys(event.detail).length > 0"
          style="margin-top: 4px"
        >
          <NText
            depth="3"
            style="font-size: 11px; cursor: pointer; user-select: none"
            @click="toggleDetail(index)"
          >
            <NIcon
              :component="expandedDetails.has(index) ? CaretDown : CaretForward"
              style="vertical-align: -2px"
            />
            详情
          </NText>
          <pre
            v-if="expandedDetails.has(index)"
            style="
              font-size: 11px;
              background: var(--cottage-surface-sunken);
              padding: 6px 8px;
              border-radius: var(--cottage-radius-control);
              margin-top: 4px;
              max-height: 200px;
              overflow: auto;
              white-space: pre-wrap;
              word-break: break-all;
            "
          >{{ JSON.stringify(event.detail, null, 2) }}</pre>
        </div>
      </div>
    </ElTimelineItem>
  </ElTimeline>
</template>
