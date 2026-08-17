<script setup lang="ts">
/**
 * 工作区搜索面板（VS Code 风格）
 */
import { NSpin, NText } from '@/ui/element-plus-primitives';
import { storeToRefs } from 'pinia';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useWorkspaceStore } from '../../stores/workspace';
import {
  filtersFromForm,
  runWorkspaceSearch,
  type WorkspaceSearchMode,
  type WorkspaceSearchResultGroup,
} from '../../workspace/runWorkspaceSearch';
import FileSearchResults from './FileSearchResults.vue';
import FileSearchToolbar from './FileSearchToolbar.vue';

const workspaceStore = useWorkspaceStore();
const { snapshot } = storeToRefs(workspaceStore);

const query = ref('');
const debouncedQuery = ref('');
const caseSensitive = ref(false);
const isRegex = ref(false);
const mode = ref<WorkspaceSearchMode>('text');
const includePattern = ref('');
const excludePattern = ref('');
const fileTypePreset = ref('');
const minSizeInput = ref('');
const maxSizeInput = ref('');
const searching = ref(false);
const progress = ref<{ scanned: number; total: number } | null>(null);
const groups = ref<WorkspaceSearchResultGroup[]>([]);
const summary = ref<string | null>(null);
const toolbarRef = ref<{ focus: () => void } | null>(null);

let abortController: AbortController | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

watch(query, (value) => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debouncedQuery.value = value.trim();
  }, 300);
});

onMounted(() => {
  void nextTick(() => {
    toolbarRef.value?.focus();
  });
});

async function runSearch() {
  if (!snapshot.value || !debouncedQuery.value) {
    groups.value = [];
    summary.value = null;
    return;
  }
  abortController?.abort();
  const controller = new AbortController();
  abortController = controller;
  searching.value = true;
  progress.value = null;
  groups.value = [];
  summary.value = null;

  try {
    const filters = filtersFromForm({
      includePattern: includePattern.value,
      excludePattern: excludePattern.value,
      fileTypePreset: fileTypePreset.value,
      minSizeInput: minSizeInput.value,
      maxSizeInput: maxSizeInput.value,
    });
    const result = await runWorkspaceSearch({
      query: debouncedQuery.value,
      mode: mode.value,
      caseSensitive: caseSensitive.value,
      isRegex: isRegex.value,
      ...filters,
      signal: controller.signal,
      onProgress: (scanned, total) => {
        progress.value = { scanned, total };
      },
    });
    if (controller.signal.aborted) return;
    groups.value = result.groups;
    summary.value = result.summary;
  } catch (err) {
    if (controller.signal.aborted) return;
    summary.value = err instanceof Error ? err.message : String(err);
  } finally {
    if (!controller.signal.aborted) {
      searching.value = false;
      progress.value = null;
    }
  }
}

watch(
  [
    debouncedQuery,
    caseSensitive,
    isRegex,
    includePattern,
    excludePattern,
    minSizeInput,
    maxSizeInput,
    mode,
    snapshot,
  ],
  () => {
    void runSearch();
  },
);

onUnmounted(() => {
  abortController?.abort();
  if (debounceTimer) clearTimeout(debounceTimer);
});

function openAtLine(path: string, line: number) {
  void workspaceStore.selectFile(path);
  window.setTimeout(() => {
    window.dispatchEvent(
      new CustomEvent('cottage:goto-line', { detail: { path, line } }),
    );
  }, 100);
}

const statusText = computed(() => {
  if (searching.value) {
    if (progress.value) {
      return `正在搜索 ${progress.value.scanned}/${progress.value.total}…`;
    }
    if (mode.value === 'filename') return '搜索文件名…';
    return '搜索中…';
  }
  return summary.value ?? '输入关键词开始搜索';
});
</script>

<template>
  <div v-if="!snapshot" class="search-panel search-panel-empty">
    <NText depth="3">请先打开工作空间</NText>
  </div>
  <div v-else class="search-panel">
    <div class="search-panel-toolbar">
      <FileSearchToolbar
        ref="toolbarRef"
        v-model:query="query"
        v-model:mode="mode"
        v-model:case-sensitive="caseSensitive"
        v-model:is-regex="isRegex"
        v-model:include-pattern="includePattern"
        v-model:exclude-pattern="excludePattern"
        v-model:file-type-preset="fileTypePreset"
        v-model:min-size-input="minSizeInput"
        v-model:max-size-input="maxSizeInput"
        :searching="searching"
        @search="runSearch()"
      />
    </div>
    <div class="search-panel-status">
      <NSpin v-if="searching" size="small" />
      <NText depth="3">{{ statusText }}</NText>
    </div>
    <FileSearchResults
      :groups="groups"
      :query="debouncedQuery"
      :case-sensitive="caseSensitive"
      @open-file="workspaceStore.selectFile($event)"
      @open-at-line="openAtLine"
    />
  </div>
</template>
