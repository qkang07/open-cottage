<script setup lang="ts">
import { RefreshOutline } from '@vicons/ionicons5';
import { ElButton, ElProgress, ElTag } from 'element-plus';
import { NIcon } from '@/ui/element-plus-primitives';
import { computed, onUnmounted, ref, watch } from 'vue';
import IndexProgressSteps from '../Rag/IndexProgressSteps.vue';
import {
  collectWorkerMonitorSnapshot,
  subscribeWorkerMonitor,
  type WorkerMonitorSnapshot,
  type WorkerStatusEntry,
} from '../../platform/debug/workerMonitor';
import type { WasmModuleStatus } from '../../platform/debug/wasmStatus';

const props = defineProps<{
  visible: boolean;
}>();

const snapshot = ref<WorkerMonitorSnapshot | null>(null);
let unsubscribe: (() => void) | null = null;

function refresh() {
  snapshot.value = collectWorkerMonitorSnapshot();
}

function startMonitor() {
  stopMonitor();
  unsubscribe = subscribeWorkerMonitor((next) => {
    snapshot.value = next;
  });
}

function stopMonitor() {
  unsubscribe?.();
  unsubscribe = null;
}

watch(
  () => props.visible,
  (open) => {
    if (open) startMonitor();
    else stopMonitor();
  },
  { immediate: true },
);

onUnmounted(stopMonitor);

function workerStatusTag(row: WorkerStatusEntry) {
  if (row.kind === 'ephemeral') {
    return { type: 'info' as const, label: '按需' };
  }
  if (row.busy) {
    return { type: 'warning' as const, label: '忙碌' };
  }
  if (!row.alive) {
    return { type: 'info' as const, label: '空闲' };
  }
  return { type: 'success' as const, label: '就绪' };
}

function indexKindLabel(kind: WorkerMonitorSnapshot['indexJob']['kind']) {
  const map = {
    idle: '空闲',
    'full-worker': '全量建库 (Worker)',
    'full-main': '全量建库 (主线程)',
    'incremental-worker': '增量索引 (Worker)',
    'incremental-main': '增量索引 (主线程回退)',
  } as const;
  return map[kind];
}

function wasmStatusTag(state: WasmModuleStatus['state']) {
  const map = {
    ready: { type: 'success' as const, label: '就绪' },
    loading: { type: 'warning' as const, label: '加载中' },
    idle: { type: 'info' as const, label: '未加载' },
    unsupported: { type: 'info' as const, label: '不支持' },
    disabled: { type: 'info' as const, label: '已关闭' },
    error: { type: 'danger' as const, label: '错误' },
  } as const;
  return map[state];
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString();
}

const memoryPercent = computed(() => {
  const mem = snapshot.value?.resources.memory;
  if (!mem?.supported || !mem.usedMb || !mem.limitMb) return 0;
  return Math.min(100, Math.round((mem.usedMb / mem.limitMb) * 100));
});
</script>

<template>
  <div class="worker-monitor-tab">
    <div class="worker-monitor-tab__toolbar">
      <span class="worker-monitor-tab__hint">
        状态变化时自动更新，空闲时每 8 秒刷新内存
        <template v-if="snapshot">
          · {{ formatTime(snapshot.collectedAt) }}
        </template>
      </span>
      <ElButton text @click="refresh">
        <template #icon>
          <NIcon :component="RefreshOutline" />
        </template>
        立即刷新
      </ElButton>
    </div>

    <template v-if="snapshot">
      <section
        v-if="snapshot.indexJob.active"
        class="worker-monitor-tab__index-active"
      >
        <div class="worker-monitor-tab__index-active-header">
          <ElTag type="warning" effect="dark">索引任务进行中</ElTag>
          <span>{{ indexKindLabel(snapshot.indexJob.kind) }}</span>
        </div>
        <p v-if="snapshot.indexJob.detail" class="worker-monitor-tab__muted">
          {{ snapshot.indexJob.detail }}
        </p>
        <IndexProgressSteps
          v-if="snapshot.indexJob.progress"
          :progress="snapshot.indexJob.progress"
          compact
        />
      </section>

      <div class="worker-monitor-tab__resources">
        <div class="worker-monitor-tab__resource-card">
          <div class="worker-monitor-tab__resource-label">逻辑 CPU 核心</div>
          <div class="worker-monitor-tab__resource-value">
            {{ snapshot.resources.hardwareConcurrency || '未知' }}
          </div>
        </div>

        <div
          v-if="snapshot.resources.deviceMemoryGb"
          class="worker-monitor-tab__resource-card"
        >
          <div class="worker-monitor-tab__resource-label">设备内存（约）</div>
          <div class="worker-monitor-tab__resource-value">
            {{ snapshot.resources.deviceMemoryGb }} GB
          </div>
        </div>

        <div
          class="worker-monitor-tab__resource-card worker-monitor-tab__resource-card--wide"
        >
          <div class="worker-monitor-tab__resource-label">JS 堆内存</div>
          <template v-if="snapshot.resources.memory.supported">
            <div class="worker-monitor-tab__memory-text">
              {{ snapshot.resources.memory.usedMb }} MB /
              {{ snapshot.resources.memory.limitMb }} MB
            </div>
            <ElProgress
              :percentage="memoryPercent"
              :stroke-width="8"
              :show-text="false"
            />
          </template>
          <div
            v-else
            class="worker-monitor-tab__resource-value worker-monitor-tab__muted"
          >
            当前浏览器不支持 performance.memory
          </div>
        </div>

        <div class="worker-monitor-tab__resource-card">
          <div class="worker-monitor-tab__resource-label">目录缓存</div>
          <div class="worker-monitor-tab__resource-value worker-monitor-tab__resource-value--sm">
            {{ snapshot.resources.dirCache.directoryCount }} 目录 /
            {{ snapshot.resources.dirCache.entryCount }} 条目
          </div>
        </div>
      </div>

      <div class="worker-monitor-tab__section-title">Worker 状态</div>
      <div class="worker-monitor-tab__worker-list">
        <div
          v-for="row in snapshot.workers"
          :key="row.id"
          class="worker-monitor-tab__worker-row"
        >
          <div class="worker-monitor-tab__worker-main">
            <span class="worker-monitor-tab__worker-name">{{ row.label }}</span>
            <ElTag
              size="small"
              :type="workerStatusTag(row).type"
              effect="plain"
            >
              {{ workerStatusTag(row).label }}
            </ElTag>
            <ElTag size="small" effect="plain" type="info">
              {{ row.kind === 'singleton' ? '常驻' : '临时' }}
            </ElTag>
          </div>
          <div class="worker-monitor-tab__worker-desc">{{ row.description }}</div>
          <div class="worker-monitor-tab__worker-meta">
            <span v-if="row.pendingRequests > 0">
              待处理 {{ row.pendingRequests }}
            </span>
            <span v-if="row.detail">{{ row.detail }}</span>
          </div>
        </div>
      </div>

      <p class="worker-monitor-tab__footnote">
        全量与增量索引默认在 RAG Index Worker 执行；Worker 不可用或失败时回退主线程。Office 文档文本抽取仍通过 RPC 回主线程。
      </p>

      <div
        v-if="snapshot.wasmModules.length"
        class="worker-monitor-tab__section-title"
      >
        WASM 模块
      </div>
      <div class="worker-monitor-tab__worker-list">
        <div
          v-for="mod in snapshot.wasmModules"
          :key="mod.id"
          class="worker-monitor-tab__worker-row"
        >
          <div class="worker-monitor-tab__worker-main">
            <span class="worker-monitor-tab__worker-name">{{ mod.label }}</span>
            <ElTag
              size="small"
              :type="wasmStatusTag(mod.state).type"
              effect="plain"
            >
              {{ wasmStatusTag(mod.state).label }}
            </ElTag>
          </div>
          <div class="worker-monitor-tab__worker-desc">{{ mod.description }}</div>
          <div v-if="mod.detail" class="worker-monitor-tab__worker-meta">
            <span>{{ mod.detail }}</span>
          </div>
          <div
            v-if="mod.metrics.length"
            class="worker-monitor-tab__worker-meta"
          >
            <span v-for="(metric, i) in mod.metrics" :key="i">{{ metric }}</span>
          </div>
          <div
            v-if="mod.lastError"
            class="worker-monitor-tab__worker-meta worker-monitor-tab__worker-error"
          >
            <span>{{ mod.lastError }}</span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.worker-monitor-tab {
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
  min-height: 0;
  overflow: auto;
  padding: 2px 0;
}

.worker-monitor-tab__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.worker-monitor-tab__hint {
  font-size: 12px;
  color: var(--cottage-muted);
}

.worker-monitor-tab__index-active {
  padding: 12px 14px;
  border: 1px solid var(--el-color-warning-light-5);
  border-radius: var(--cottage-radius-control);
  background: var(--el-color-warning-light-9);
}

.worker-monitor-tab__index-active-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
}

.worker-monitor-tab__resources {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 10px;
}

.worker-monitor-tab__resource-card {
  padding: 12px 14px;
  background: var(--el-fill-color-blank);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--cottage-radius-control);
}

.worker-monitor-tab__resource-card--wide {
  grid-column: span 2;
}

.worker-monitor-tab__resource-label {
  font-size: 11px;
  color: var(--cottage-muted);
  margin-bottom: 4px;
}

.worker-monitor-tab__resource-value {
  font-size: 18px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.worker-monitor-tab__resource-value--sm {
  font-size: 14px;
}

.worker-monitor-tab__memory-text {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 8px;
}

.worker-monitor-tab__section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--cottage-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.worker-monitor-tab__worker-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.worker-monitor-tab__worker-row {
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--cottage-radius-control);
  background: var(--el-fill-color-blank);
}

.worker-monitor-tab__worker-main {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 4px;
}

.worker-monitor-tab__worker-name {
  font-weight: 600;
  font-size: 13px;
  margin-right: 4px;
}

.worker-monitor-tab__worker-desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}

.worker-monitor-tab__worker-meta {
  display: flex;
  gap: 12px;
  margin-top: 4px;
  font-size: 11px;
  color: var(--cottage-muted);
}

.worker-monitor-tab__worker-error {
  color: var(--el-color-danger);
}

.worker-monitor-tab__muted {
  font-size: 12px;
  color: var(--cottage-muted);
  margin: 0 0 8px;
}

.worker-monitor-tab__footnote {
  font-size: 11px;
  color: var(--cottage-muted);
  line-height: 1.5;
  margin: 4px 0 0;
}

.worker-monitor-tab__footnote strong {
  font-weight: 600;
  color: var(--el-text-color-secondary);
}
</style>
