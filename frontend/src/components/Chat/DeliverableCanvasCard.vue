<script setup lang="ts">
import { computed } from 'vue';
import { CheckmarkOutline, ListOutline, GridOutline, DocumentTextOutline } from '@vicons/ionicons5';
import { ElTag } from 'element-plus';
import { NIcon, NText } from '@/ui/element-plus-primitives';
import type { TaskCanvasPayload } from '../../task/types';

const props = defineProps<{
  canvas: TaskCanvasPayload;
  summary?: string;
  completed?: boolean;
  running?: boolean;
}>();

const kindLabel = computed(() => {
  switch (props.canvas.kind) {
    case 'table':
      return '表格';
    case 'todo-list':
      return '待办清单';
    case 'markdown':
      return 'Markdown';
    default:
      return 'Canvas';
  }
});

const kindIcon = computed(() => {
  switch (props.canvas.kind) {
    case 'table':
      return GridOutline;
    case 'todo-list':
      return ListOutline;
    case 'markdown':
      return DocumentTextOutline;
    default:
      return CheckmarkOutline;
  }
});

const title = computed(() => {
  if ('title' in props.canvas && props.canvas.title?.trim()) {
    return props.canvas.title.trim();
  }
  return kindLabel.value;
});

const itemCount = computed(() => {
  if (props.canvas.kind === 'table') return props.canvas.rows.length;
  if (props.canvas.kind === 'todo-list') return props.canvas.items.length;
  return 0;
});
</script>

<template>
  <div class="deliverable-canvas-card" :data-completed="completed ? 'true' : 'false'">
    <div class="deliverable-canvas-header">
      <span class="deliverable-canvas-title">
        <NIcon :component="kindIcon" />
        <NText strong>{{ title }}</NText>
      </span>
      <span class="deliverable-canvas-tags">
        <ElTag v-if="running && !completed" size="small" type="warning">提交中</ElTag>
        <ElTag v-else-if="completed" size="small" type="success">已提交</ElTag>
        <ElTag size="small" type="info">{{ kindLabel }}</ElTag>
        <ElTag v-if="itemCount" size="small">{{ itemCount }} 项</ElTag>
      </span>
    </div>
    <NText v-if="summary" depth="2" class="deliverable-canvas-summary">
      {{ summary }}
    </NText>

    <div v-if="canvas.kind === 'table'" class="deliverable-canvas-table-wrap">
      <table class="deliverable-canvas-table">
        <thead>
          <tr>
            <th v-for="(col, i) in canvas.columns" :key="i">{{ col }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, ri) in canvas.rows" :key="ri">
            <td v-for="(cell, ci) in row" :key="ci">{{ cell }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <ul v-else-if="canvas.kind === 'todo-list'" class="deliverable-canvas-todo">
      <li
        v-for="(item, i) in canvas.items"
        :key="item.id ?? i"
        :class="{ 'deliverable-canvas-todo-done': item.done }"
      >
        <span class="deliverable-canvas-todo-marker">{{ item.done ? '✓' : '○' }}</span>
        <span>{{ item.text }}</span>
      </li>
    </ul>

    <pre
      v-else-if="canvas.kind === 'markdown'"
      class="deliverable-canvas-markdown"
    >{{ canvas.content }}</pre>
  </div>
</template>
