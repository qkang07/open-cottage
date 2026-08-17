<script setup lang="ts">
import {
  BuildOutline,
  RefreshOutline,
  StopOutline,
  TrashOutline,
  } from '@vicons/ionicons5';
import {
  ElButton,
  ElCard,
  ElTable,
  ElTableColumn,
  ElStatistic,
  ElTag,
  ElMessage
} from 'element-plus';
import {
  NIcon,
  NSpace,
  NText
} from '@/ui/element-plus-primitives';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import {
  abortIndexing,
  clearIndex,
  getExpectedEmbeddingModelId,
  getIndexStorageInfo,
  subscribeBackgroundIndex,
  startBackgroundIndex,
  type BackgroundIndexState,
} from '../../rag';
import { getCottageConfig } from '../../config/store';
import IndexProgressSteps from './IndexProgressSteps.vue';
const message = ElMessage;
const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};
const storage = ref<Awaited<ReturnType<typeof getIndexStorageInfo>> | null>(null);
const expectedModel = ref<string | null>(null);
const bgState = ref<BackgroundIndexState>({
  running: false,
  progress: null,
  error: null,
  lastCompletedAt: null,
});
let unsubscribe: (() => void) | undefined;
async function refreshStats() {
  try {
    storage.value = await getIndexStorageInfo();
  } catch {
    storage.value = null;
  }
  try {
    expectedModel.value = getExpectedEmbeddingModelId(
      getCottageConfig().rag?.embedding,
    );
  } catch {
    expectedModel.value = null;
  }
}
onMounted(() => {
  void refreshStats();
  unsubscribe = subscribeBackgroundIndex((state) => {
    bgState.value = state;
    if (!state.running && state.lastCompletedAt) {
      void refreshStats();
    }
  });
});
onUnmounted(() => {
  unsubscribe?.();
});
const indexing = computed(() => bgState.value.running);
const progress = computed(() => bgState.value.progress);
const stats = computed(() => storage.value?.stats ?? null);
const embeddingConfigChanged = computed(
  () =>
    Boolean(stats.value) &&
    Boolean(expectedModel.value) &&
    stats.value!.model !== expectedModel.value,
);
const storageTableData = computed(() =>
  (storage.value?.files ?? []).map((f) => ({
    name: f.name,
    sizeLabel: formatBytes(f.bytes),
  })),
);
async function handleBuild(force: boolean) {
  if (indexing.value) {
    message.warning('索引正在构建中');
    return;
  }
  try {
    const result = await startBackgroundIndex(force);
    if (result) {
      message.success(
        `索引构建完成：${result.filesIndexed} 个文件, ${result.totalChunks} 个片段`,
      );
    }
    await refreshStats();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === '已取消') {
      message.info('已暂停索引构建');
    } else if (msg !== '索引正在构建中') {
      message.error(`索引构建失败: ${msg}`);
    }
  }
}
function handleAbort() {
  abortIndexing();
}
async function handleClear() {
  try {
    await clearIndex();
    message.success('已清除索引');
    storage.value = null;
  } catch {
    message.error('清除失败');
  }
}
</script>
<template>
  <div class="index-panel" style="padding: 8px 16px">
    <NText strong style="font-size: 16px; display: block; margin-bottom: 8px">
      向量索引
    </NText>
    <NText depth="3" style="font-size: 12px; display: block; margin-bottom: 12px">
      索引存储于 <code>.cottage/index/</code>，随工作区迁移。打开文件夹后会在后台自动建库。
    </NText>
    <ElCard v-if="stats" style="margin-bottom: 12px">
      <NSpace :size="24" wrap>
        <ElStatistic label="文件数" :value="stats.totalFiles" />
        <ElStatistic label="片段数" :value="stats.totalChunks" />
        <ElStatistic label="维度" :value="stats.dim" />
        <div>
          <NText depth="3" style="font-size: 12px; display: block">模型</NText>
          <NText>{{ stats.model }}</NText>
        </div>
      </NSpace>
      <div style="margin-top: 8px">
        <ElTag type="success">已建库</ElTag>
        <NText depth="3" style="font-size: 12px; margin-left: 8px">
          上次构建：{{ new Date(stats.builtAt).toLocaleString() }}
        </NText>
      </div>
    </ElCard>
    <ElCard v-else style="margin-bottom: 12px">
      <ElTag>未建库</ElTag>
      <NText depth="3" style="margin-left: 8px">
        后台正在建库或点击「构建索引」手动开始
      </NText>
    </ElCard>
    <ElCard
      v-if="storage"
      title="向量存储"
      style="margin-bottom: 12px"
    >
      <NText depth="3" style="font-size: 12px; display: block; margin-bottom: 8px">
        总占用 {{ formatBytes(storage.totalBytes) }}，向量数据
        {{ formatBytes(storage.vectorBytes) }}
      </NText>
      <ElTable :data="storageTableData" :border="false">
        <ElTableColumn prop="name" label="文件" />
        <ElTableColumn prop="sizeLabel" label="大小" />
      </ElTable>
    </ElCard>
    <ElCard
      v-if="embeddingConfigChanged && !indexing"
      style="margin-bottom: 12px; border-color: var(--el-color-warning)"
    >
      <ElTag type="warning">嵌入配置已变更</ElTag>
      <NText depth="3" style="font-size: 12px; display: block; margin-top: 6px">
        当前嵌入模型（{{ expectedModel }}）与已建索引（{{ stats?.model }}）不一致，
        检索将无法使用旧索引。请点击「全量重建」后再使用语义检索。
      </NText>
      <ElButton
        type="warning"
        size="small"
        style="margin-top: 8px"
        @click="handleBuild(true)"
      >
        <template #icon>
          <NIcon :component="RefreshOutline" />
        </template>
        立即全量重建
      </ElButton>
    </ElCard>
    <NText
      v-if="bgState.error"
      type="danger"
      style="display: block; margin-bottom: 8px"
    >
      {{ bgState.error }}
    </NText>
    <ElCard
      v-if="progress && indexing"
      title="建库进度"
      style="margin-bottom: 12px"
    >
      <IndexProgressSteps :progress="progress" />
    </ElCard>
    <NSpace wrap>
      <ElButton
        type="primary"
        :loading="indexing"
        :disabled="indexing"
        @click="handleBuild(false)"
      >
        <template #icon>
          <NIcon :component="BuildOutline" />
        </template>
        {{ stats ? '增量更新' : '构建索引' }}
      </ElButton>
      <ElButton
        v-if="stats"
        :disabled="indexing"
        @click="handleBuild(true)"
      >
        <template #icon>
          <NIcon :component="RefreshOutline" />
        </template>
        全量重建
      </ElButton>
      <ElButton v-if="indexing" type="danger" @click="handleAbort">
        <template #icon>
          <NIcon :component="StopOutline" />
        </template>
        暂停
      </ElButton>
      <ElButton
        v-if="stats && !indexing"
        type="danger"
        @click="handleClear"
      >
        <template #icon>
          <NIcon :component="TrashOutline" />
        </template>
        清除索引
      </ElButton>
    </NSpace>
  </div>
</template>
