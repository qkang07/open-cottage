<script setup lang="ts">
import {
  ConstructOutline } from '@vicons/ionicons5';
import { ElButton,
  ElTag
} from 'element-plus';
import {
  NIcon,
  NText
} from '@/ui/element-plus-primitives';
import { onMounted, onUnmounted, ref, computed } from 'vue';
import { getIndexStats, subscribeBackgroundIndex, type BackgroundIndexState } from '../../rag';
import { useDebugPanelStore } from '../../stores/debugPanel';
import IndexProgressSteps from '../Rag/IndexProgressSteps.vue';
const debugPanelStore = useDebugPanelStore();
const stats = ref<Awaited<ReturnType<typeof getIndexStats>> | null>(null);
const bgState = ref<BackgroundIndexState>({
  running: false,
  progress: null,
  error: null,
  lastCompletedAt: null,
});
async function refreshStats() {
  try {
    stats.value = await getIndexStats();
  } catch {
    stats.value = null;
  }
}
let unsubscribe: (() => void) | undefined;
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
</script>
<template>
  <div class="sidebar-info-bubble">
    <NText strong class="sidebar-info-bubble-title">向量索引</NText>
    <NText depth="3" class="sidebar-info-bubble-desc">
      索引存储于 <code>.cottage/index/</code>，随工作区迁移。
    </NText>
    <ElTag v-if="indexing" type="info" style="margin-bottom: 8px">
      正在建库
    </ElTag>
    <ElTag v-else-if="stats?.exists" type="success" style="margin-bottom: 8px">
      已建库
    </ElTag>
    <ElTag v-else style="margin-bottom: 8px">未建库</ElTag>
    <dl v-if="stats?.exists" class="sidebar-info-bubble-meta">
      <div>
        <dt>文件</dt>
        <dd>{{ stats.totalFiles }}</dd>
      </div>
      <div>
        <dt>片段</dt>
        <dd>{{ stats.totalChunks }}</dd>
      </div>
      <div>
        <dt>模型</dt>
        <dd>{{ stats.model }}</dd>
      </div>
      <div>
        <dt>上次构建</dt>
        <dd>{{ new Date(stats.builtAt).toLocaleString() }}</dd>
      </div>
    </dl>
    <div v-if="progress && indexing" class="sidebar-info-bubble-progress">
      <IndexProgressSteps :progress="progress" compact />
    </div>
    <NText
      v-if="bgState.error"
      type="error"
      style="display: block; margin-bottom: 8px"
    >
      {{ bgState.error }}
    </NText>
    <ElButton
      type="primary"
      block
      @click="debugPanelStore.show('index')"
    >
      <template #icon>
        <NIcon :component="ConstructOutline" />
      </template>
      打开调试面板
    </ElButton>
  </div>
</template>
