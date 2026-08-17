<script setup lang="ts">
import {
  Add,
  DocumentTextOutline,
  RefreshOutline,
  TimeOutline,
} from '@vicons/ionicons5';
import {
  ElAlert,
  ElButton,
  ElDialog,
  ElEmpty,
  ElInput,
  ElMessage,
  ElMessageBox,
  ElOption,
  ElProgress,
  ElSelect,
  ElTabPane,
  ElTable,
  ElTableColumn,
  ElTabs,
  ElTag,
  ElTimeline,
  ElTimelineItem,
} from 'element-plus';
import { storeToRefs } from 'pinia';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  createManualCheckpoint,
  deleteAllFileHistory,
  deleteFileHistoryRevision,
  deleteHistoryVersion,
  getHistoryPoolStats,
  listFileHistory,
  listHistoryFilesSummary,
  listHistoryVersions,
  loadHistoryMeta,
  readFileVersionBytes,
  readFileVersionText,
  restoreFile,
  restoreTree,
} from '../../history/historyService';
import type {
  HistoryChangeType,
  HistoryDeleteResult,
  HistoryFileSummary,
  HistoryFileVersionSummary,
  HistoryMeta,
  HistoryPoolStats,
  HistoryVersionSource,
  HistoryVersionSummary,
} from '../../history/types';
import { useWorkspaceStore } from '../../stores/workspace';
import { workspace } from '../../workspace/FileSystemWorkspace';
import { NIcon, NSpace, NText } from '@/ui/element-plus-primitives';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
const { selectedPath } = storeToRefs(workspaceStore);

const activeTab = ref('timeline');
const loading = ref(false);
const versions = ref<HistoryVersionSummary[]>([]);
const files = ref<HistoryFileSummary[]>([]);
const stats = ref<HistoryPoolStats | null>(null);
const meta = ref<HistoryMeta | null>(null);
const search = ref('');
const typeFilter = ref<'all' | 'text' | 'binary' | 'partial'>('all');
const sortBy = ref<'size' | 'versions' | 'latest' | 'path'>('size');
const showManualDialog = ref(false);
const manualLabel = ref('');
const selectedFile = ref<HistoryFileSummary | null>(null);
const fileVersions = ref<HistoryFileVersionSummary[]>([]);
const selectedRevisions = ref<HistoryFileVersionSummary[]>([]);
const showFileDialog = ref(false);
const showPreviewDialog = ref(false);
const previewTitle = ref('');
const previewText = ref('');
const previewDiff = ref('');
const previewImageUrl = ref('');
const previewMeta = ref('');
const previewKind = ref<'text' | 'image' | 'binary'>('binary');

const sourceLabels = computed<Record<HistoryVersionSource, string>>(() => ({
  initial: t('history.sourceInitial'),
  manual: t('history.sourceManual'),
  agent: t('history.sourceAgent'),
  external: t('history.sourceExternal'),
  restore: t('history.sourceRestore'),
}));

const capacityPercent = computed(() => {
  if (!stats.value?.limitBytes) return 0;
  return Math.min(100, Math.round((stats.value.totalBytes / stats.value.limitBytes) * 100));
});

const filteredFiles = computed(() => {
  const needle = search.value.trim().toLowerCase();
  const result = files.value.filter((file) => {
    if (needle && !file.path.toLowerCase().includes(needle)) return false;
    if (typeFilter.value === 'text' && file.binary) return false;
    if (typeFilter.value === 'binary' && !file.binary) return false;
    if (typeFilter.value === 'partial' && file.unavailableVersions === 0) return false;
    return true;
  });
  return result.sort((a, b) => {
    if (sortBy.value === 'path') return a.path.localeCompare(b.path);
    if (sortBy.value === 'versions') return b.versions - a.versions;
    if (sortBy.value === 'latest') return b.latestAt - a.latestAt;
    return b.logicalBytes - a.logicalBytes;
  });
});

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
}

function formatTime(at: number): string {
  return new Date(at).toLocaleString();
}

const cleanupReasonLabel = (reason: 'file-limit' | 'pool-limit' | 'manual') => ({
  'file-limit': t('history.cleanupFileLimit'),
  'pool-limit': t('history.cleanupPoolLimit'),
  manual: t('history.cleanupManual'),
})[reason];

const changeTypeLabel = (type: HistoryChangeType) =>
  t(`history.change${type[0].toUpperCase()}${type.slice(1)}`);

function resultMessage(result: HistoryDeleteResult): string {
  return t('history.deleteResult', {
    logical: formatBytes(result.logicalBytesRemoved),
    actual: formatBytes(result.bytesFreed),
  });
}

function releasePreviewUrl() {
  if (previewImageUrl.value) URL.revokeObjectURL(previewImageUrl.value);
  previewImageUrl.value = '';
}

async function runAction(action: () => Promise<unknown>) {
  try {
    await action();
  } catch (error) {
    if (error === 'cancel' || error === 'close') return;
    ElMessage.error(error instanceof Error ? error.message : String(error));
  }
}

function stateSize(entry: HistoryFileVersionSummary): string {
  return entry.state.state === 'deleted' ? '-' : formatBytes(entry.state.size);
}

function buildLineDiff(historical: string, current: string): string {
  const before = historical.split('\n');
  const after = current.split('\n');
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) {
    start += 1;
  }
  let beforeEnd = before.length - 1;
  let afterEnd = after.length - 1;
  while (
    beforeEnd >= start &&
    afterEnd >= start &&
    before[beforeEnd] === after[afterEnd]
  ) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }
  const contextStart = Math.max(0, start - 3);
  const contextEndBefore = Math.min(before.length, beforeEnd + 4);
  const contextEndAfter = Math.min(after.length, afterEnd + 4);
  return [
    `--- ${t('history.historicalContent')}`,
    `+++ ${t('history.currentContent')}`,
    ...before.slice(contextStart, start).map((line) => `  ${line}`),
    ...before.slice(start, contextEndBefore).map((line) => `- ${line}`),
    ...after.slice(start, contextEndAfter).map((line) => `+ ${line}`),
  ].join('\n');
}

function imageMime(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'svg') return 'image/svg+xml';
  return `image/${extension || 'png'}`;
}

async function loadData() {
  loading.value = true;
  try {
    const [nextVersions, nextFiles, nextStats, nextMeta] = await Promise.all([
      listHistoryVersions(),
      listHistoryFilesSummary(),
      getHistoryPoolStats(),
      loadHistoryMeta(),
    ]);
    versions.value = nextVersions;
    files.value = nextFiles;
    stats.value = nextStats;
    meta.value = nextMeta;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : t('history.loadFailed'));
  } finally {
    loading.value = false;
  }
}

async function createSnapshot() {
  const label = manualLabel.value.trim();
  if (!label) return;
  await createManualCheckpoint(label, true);
  manualLabel.value = '';
  showManualDialog.value = false;
  await loadData();
}

async function openCurrentFileHistory() {
  if (selectedPath.value) await openFileHistory(selectedPath.value);
}

async function openFileHistory(file: HistoryFileSummary | string) {
  const path = typeof file === 'string' ? file : file.path;
  selectedFile.value = files.value.find((item) => item.path === path) ?? {
    path,
    binary: false,
    versions: 0,
    logicalBytes: 0,
    latestAt: 0,
    unavailableVersions: 0,
  };
  fileVersions.value = await listFileHistory(path);
  selectedRevisions.value = [];
  showFileDialog.value = true;
}

async function confirmRestoreVersion(version: HistoryVersionSummary) {
  if (!version.complete) return;
  await ElMessageBox.confirm(
    t('history.restoreTreeConfirmBody', { oid: version.id.slice(0, 8) }),
    t('history.restoreTreeConfirmTitle'),
    { type: 'warning' },
  );
  const restored = await restoreTree(version.id);
  if (!restored) throw new Error(t('history.partialRestoreBlocked'));
  await workspaceStore.refreshFromDisk();
  await loadData();
}

async function confirmDeleteVersion(version: HistoryVersionSummary) {
  await ElMessageBox.confirm(
    t('history.deleteVersionConfirmBody', { label: version.label }),
    t('history.deleteVersionConfirmTitle'),
    { type: 'warning' },
  );
  const result = await deleteHistoryVersion(version.id);
  ElMessage.success(resultMessage(result));
  await loadData();
}

async function confirmRestoreFile(entry: HistoryFileVersionSummary) {
  if (!entry.restorable || !selectedFile.value) return;
  await ElMessageBox.confirm(
    t('history.restoreFileConfirmBody', {
      path: selectedFile.value.path,
      oid: entry.versionId.slice(0, 8),
    }),
    t('history.restoreFileConfirmTitle'),
    { type: 'warning' },
  );
  const restored = await restoreFile(entry.versionId, selectedFile.value.path);
  if (!restored) throw new Error(t('history.fileUnavailable'));
  ElMessage.success(t('history.restoreComplete'));
  await workspaceStore.refreshFromDisk();
  await loadData();
  await openFileHistory(selectedFile.value.path);
}

async function confirmDeleteRevision(entry: HistoryFileVersionSummary) {
  if (!selectedFile.value) return;
  await ElMessageBox.confirm(
    t('history.deleteRevisionConfirmBody'),
    t('history.deleteRevisionConfirmTitle'),
    { type: 'warning' },
  );
  const result = await deleteFileHistoryRevision(
    selectedFile.value.path,
    entry.versionId,
  );
  ElMessage.success(resultMessage(result));
  await loadData();
  await openFileHistory(selectedFile.value.path);
}

async function confirmDeleteAllFileHistory() {
  if (!selectedFile.value) return;
  const affected = fileVersions.value.filter(
    (entry) =>
      entry.state.state !== 'unavailable' || entry.state.reason !== 'user-deleted',
  ).length;
  await ElMessageBox.confirm(
    t('history.deleteAllConfirmBody', {
      path: selectedFile.value.path,
      count: affected,
      size: formatBytes(selectedFile.value.logicalBytes),
    }),
    t('history.deleteAllConfirmTitle'),
    { type: 'error' },
  );
  const result = await deleteAllFileHistory(selectedFile.value.path);
  ElMessage.success(resultMessage(result));
  showFileDialog.value = false;
  await loadData();
}

async function confirmDeleteSelected() {
  if (!selectedFile.value || !selectedRevisions.value.length) return;
  await ElMessageBox.confirm(
    t('history.deleteSelectedConfirmBody', { count: selectedRevisions.value.length }),
    t('history.deleteRevisionConfirmTitle'),
    { type: 'warning' },
  );
  const total: HistoryDeleteResult = {
    revisionsRemoved: 0,
    versionsRemoved: 0,
    logicalBytesRemoved: 0,
    bytesFreed: 0,
  };
  for (const revision of selectedRevisions.value) {
    const result = await deleteFileHistoryRevision(
      selectedFile.value.path,
      revision.versionId,
    );
    total.revisionsRemoved += result.revisionsRemoved;
    total.logicalBytesRemoved += result.logicalBytesRemoved;
    total.bytesFreed += result.bytesFreed;
  }
  ElMessage.success(resultMessage(total));
  await loadData();
  await openFileHistory(selectedFile.value.path);
}

const revisionSelectable = (entry: HistoryFileVersionSummary) =>
  entry.state.state !== 'unavailable' || entry.state.reason !== 'user-deleted';

function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(path);
}

function isTextPath(path: string): boolean {
  return /\.(txt|md|mdx|json|jsonc|ya?ml|toml|xml|html?|css|scss|less|js|jsx|mjs|cjs|ts|tsx|vue|svelte|py|rb|go|rs|java|kt|kts|c|cc|cpp|h|hpp|cs|php|sh|ps1|sql|csv|log|ini|env|gitignore)$/i.test(path);
}

async function previewVersion(entry: HistoryFileVersionSummary) {
  if (!selectedFile.value || entry.state.state !== 'stored') return;
  releasePreviewUrl();
  const path = selectedFile.value.path;
  previewTitle.value = `${path} · ${entry.versionId.slice(0, 8)}`;
  previewText.value = '';
  previewDiff.value = '';
  previewMeta.value = `${formatBytes(entry.state.size)} · SHA-256 ${entry.state.objectId}`;
  if (isImagePath(path)) {
    previewKind.value = 'image';
    const bytes = await readFileVersionBytes(entry.versionId, path);
    if (bytes) {
      previewImageUrl.value = URL.createObjectURL(
        new Blob(
          [bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer],
          { type: imageMime(path) },
        ),
      );
    }
  } else if (isTextPath(path) || !entry.state.binary) {
    previewKind.value = 'text';
    previewText.value = (await readFileVersionText(entry.versionId, path)) ?? '';
    try {
      const current = (await workspace.exists(path))
        ? new TextDecoder().decode(await workspace.readFileBytes(path))
        : '';
      if (current !== previewText.value) {
        previewDiff.value = buildLineDiff(previewText.value, current);
        const historicalLines = previewText.value.split('\n');
        const currentLines = current.split('\n');
        previewMeta.value += ` · ${t('history.lineChangeSummary', {
          old: historicalLines.length,
          current: currentLines.length,
        })}`;
      }
    } catch {
      // 历史内容仍可预览；当前工作区文件读取失败不影响预览。
    }
  }
  showPreviewDialog.value = true;
}

onMounted(() => void loadData());
onBeforeUnmount(releasePreviewUrl);
</script>

<template>
  <div class="history-panel">
    <ElAlert
      v-if="meta?.status === 'paused' || meta?.status === 'error'"
      :title="meta.error || t('history.capturePaused')"
      type="error"
      show-icon
      :closable="false"
    />

    <div class="history-toolbar">
      <NSpace align="center">
        <NIcon :component="TimeOutline" />
        <NText strong>{{ t('history.title') }}</NText>
        <ElTag type="warning" size="small">Beta</ElTag>
      </NSpace>
      <NSpace>
        <ElButton
          v-if="selectedPath"
          @click="runAction(openCurrentFileHistory)"
        >
          <template #icon><NIcon :component="DocumentTextOutline" /></template>
          {{ t('history.currentFile') }}
        </ElButton>
        <ElButton type="primary" @click="showManualDialog = true">
          <template #icon><NIcon :component="Add" /></template>
          {{ t('history.createSnapshot') }}
        </ElButton>
        <ElButton :loading="loading" @click="loadData">
          <template #icon><NIcon :component="RefreshOutline" /></template>
          {{ t('common.refresh') }}
        </ElButton>
      </NSpace>
    </div>

    <ElTabs v-model="activeTab">
      <ElTabPane :label="t('history.timeline')" name="timeline">
        <ElEmpty v-if="!versions.length && !loading" :description="t('history.noVersions')" />
        <ElTimeline v-else>
          <ElTimelineItem
            v-for="version in versions"
            :key="version.id"
            :timestamp="formatTime(version.at)"
            placement="top"
          >
            <div class="version-card">
              <div class="version-head">
                <div>
                  <NText strong>{{ version.label }}</NText>
                  <div class="version-meta">
                    {{ sourceLabels[version.source] }} · {{ version.id.slice(0, 8) }} ·
                    {{ t('history.filesCount', { n: version.changedPaths.length }) }}
                  </div>
                </div>
                <NSpace>
                  <ElTag :type="version.complete ? 'success' : 'warning'">
                    {{ version.complete ? t('history.complete') : t('history.partial') }}
                  </ElTag>
                  <ElButton
                    size="small"
                    :disabled="!version.complete"
                    @click="runAction(() => confirmRestoreVersion(version))"
                  >
                    {{ t('history.restoreWorkspace') }}
                  </ElButton>
                  <ElButton size="small" type="danger" plain @click="runAction(() => confirmDeleteVersion(version))">
                    {{ t('common.delete') }}
                  </ElButton>
                </NSpace>
              </div>
              <div v-if="version.changedPaths.length" class="changed-paths">
                <ElButton
                  v-for="path in version.changedPaths.slice(0, 8)"
                  :key="path"
                  link
                  @click="runAction(() => openFileHistory(path))"
                >
                  {{ changeTypeLabel(version.changeTypes[path] ?? 'modified') }} · {{ path }}
                  <span v-if="version.renamedFrom?.[path]" class="renamed-from">
                    ({{ t('history.renamedFrom') }} {{ version.renamedFrom[path] }})
                  </span>
                </ElButton>
                <NText v-if="version.changedPaths.length > 8" depth="3">
                  +{{ version.changedPaths.length - 8 }}
                </NText>
              </div>
            </div>
          </ElTimelineItem>
        </ElTimeline>
      </ElTabPane>

      <ElTabPane :label="t('history.management')" name="management">
        <div v-if="stats" class="capacity-card">
          <div class="capacity-head">
            <NText strong>{{ t('history.poolUsage') }}</NText>
            <NText>{{ formatBytes(stats.totalBytes) }} / {{ formatBytes(stats.limitBytes) }}</NText>
          </div>
          <ElProgress :percentage="capacityPercent" :status="capacityPercent >= 95 ? 'exception' : undefined" />
          <div class="capacity-details">
            <span>{{ t('history.textUsage') }} {{ formatBytes(stats.textBytes) }}</span>
            <span>{{ t('history.binaryUsage') }} {{ formatBytes(stats.binaryBytes) }}</span>
            <span>{{ t('history.metadataUsage') }} {{ formatBytes(stats.metadataBytes) }}</span>
            <span>{{ t('history.objectCount', { n: stats.objectCount }) }}</span>
          </div>
        </div>

        <div class="filter-row">
          <ElInput v-model="search" clearable :placeholder="t('history.searchFiles')" />
          <ElSelect v-model="typeFilter">
            <ElOption :label="t('history.filterAll')" value="all" />
            <ElOption :label="t('history.filterText')" value="text" />
            <ElOption :label="t('history.filterBinary')" value="binary" />
            <ElOption :label="t('history.filterPartial')" value="partial" />
          </ElSelect>
          <ElSelect v-model="sortBy">
            <ElOption :label="t('history.sortSize')" value="size" />
            <ElOption :label="t('history.sortVersions')" value="versions" />
            <ElOption :label="t('history.sortLatest')" value="latest" />
            <ElOption :label="t('history.sortPath')" value="path" />
          </ElSelect>
        </div>

        <ElTable :data="filteredFiles" stripe height="calc(100vh - 330px)">
          <ElTableColumn prop="path" :label="t('history.filePath')" min-width="260" show-overflow-tooltip />
          <ElTableColumn :label="t('history.fileType')" width="90">
            <template #default="scope">
              {{ scope.row.binary ? t('history.binary') : t('history.text') }}
            </template>
          </ElTableColumn>
          <ElTableColumn prop="versions" :label="t('history.versionCount')" width="90" />
          <ElTableColumn :label="t('history.usage')" width="110">
            <template #default="scope">{{ formatBytes(scope.row.logicalBytes) }}</template>
          </ElTableColumn>
          <ElTableColumn :label="t('history.latestVersion')" width="170">
            <template #default="scope">{{ formatTime(scope.row.latestAt) }}</template>
          </ElTableColumn>
          <ElTableColumn :label="t('history.status')" width="100">
            <template #default="scope">
              <ElTag :type="scope.row.unavailableVersions ? 'warning' : 'success'" size="small">
                {{ scope.row.unavailableVersions ? t('history.partial') : t('history.complete') }}
              </ElTag>
            </template>
          </ElTableColumn>
          <ElTableColumn :label="t('history.actions')" width="100" fixed="right">
            <template #default="scope">
              <ElButton link type="primary" @click="runAction(() => openFileHistory(scope.row as HistoryFileSummary))">{{ t('history.details') }}</ElButton>
            </template>
          </ElTableColumn>
        </ElTable>

        <div v-if="meta?.cleanupLog.length" class="cleanup-log">
          <NText strong>{{ t('history.cleanupLog') }}</NText>
          <div v-for="entry in meta.cleanupLog.slice().reverse().slice(0, 10)" :key="`${entry.at}-${entry.reason}`">
            {{ formatTime(entry.at) }} · {{ cleanupReasonLabel(entry.reason) }} ·
            {{ t('history.cleanupEntry', {
              versions: entry.versionsRemoved,
              revisions: entry.revisionsRemoved,
              bytes: formatBytes(entry.bytesFreed),
            }) }}
          </div>
        </div>
      </ElTabPane>
    </ElTabs>

    <ElDialog v-model="showManualDialog" :title="t('history.createManualSnapshotTitle')" width="480px">
      <ElInput v-model="manualLabel" :placeholder="t('history.snapshotPlaceholder')" @keyup.enter="runAction(createSnapshot)" />
      <template #footer>
        <ElButton @click="showManualDialog = false">{{ t('common.cancel') }}</ElButton>
        <ElButton type="primary" :disabled="!manualLabel.trim()" @click="runAction(createSnapshot)">{{ t('history.create') }}</ElButton>
      </template>
    </ElDialog>

    <ElDialog
      v-model="showFileDialog"
      :title="t('history.fileHistoryOf', { path: selectedFile?.path ?? '' })"
      width="min(900px, 92vw)"
    >
      <div class="file-dialog-summary">
        <span>{{ t('history.versionCount') }}: {{ selectedFile?.versions ?? 0 }}</span>
        <span>{{ t('history.usage') }}: {{ formatBytes(selectedFile?.logicalBytes ?? 0) }}</span>
        <NSpace>
          <ElButton
            type="danger"
            plain
            :disabled="!selectedRevisions.length"
            @click="runAction(confirmDeleteSelected)"
          >
            {{ t('history.deleteSelected') }}
          </ElButton>
          <ElButton type="danger" plain @click="runAction(confirmDeleteAllFileHistory)">{{ t('history.deleteAllFileHistory') }}</ElButton>
        </NSpace>
      </div>
      <ElTable
        :data="fileVersions"
        max-height="55vh"
        @selection-change="selectedRevisions = $event"
      >
        <ElTableColumn type="selection" width="42" :selectable="revisionSelectable" />
        <ElTableColumn :label="t('history.latestVersion')" width="175">
          <template #default="scope">{{ formatTime(scope.row.at) }}</template>
        </ElTableColumn>
        <ElTableColumn prop="label" :label="t('history.summary')" min-width="180" />
        <ElTableColumn :label="t('history.status')" width="130">
          <template #default="scope">
            <ElTag :type="scope.row.restorable ? 'success' : 'warning'" size="small">
              {{ scope.row.restorable ? t('history.restorable') : t('history.unavailable') }}
            </ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn :label="t('history.usage')" width="100">
          <template #default="scope">{{ stateSize(scope.row as HistoryFileVersionSummary) }}</template>
        </ElTableColumn>
        <ElTableColumn :label="t('history.actions')" width="230">
          <template #default="scope">
            <ElButton link :disabled="scope.row.state.state !== 'stored'" @click="runAction(() => previewVersion(scope.row as HistoryFileVersionSummary))">{{ t('history.view') }}</ElButton>
            <ElButton link type="primary" :disabled="!scope.row.restorable" @click="runAction(() => confirmRestoreFile(scope.row as HistoryFileVersionSummary))">{{ t('history.restore') }}</ElButton>
            <ElButton link type="danger" @click="runAction(() => confirmDeleteRevision(scope.row as HistoryFileVersionSummary))">{{ t('common.delete') }}</ElButton>
          </template>
        </ElTableColumn>
      </ElTable>
    </ElDialog>

    <ElDialog v-model="showPreviewDialog" :title="previewTitle" width="min(900px, 92vw)" @closed="releasePreviewUrl">
      <NText depth="3">{{ previewMeta }}</NText>
      <img v-if="previewKind === 'image' && previewImageUrl" :src="previewImageUrl" class="image-preview" alt="" />
      <template v-else-if="previewKind === 'text'">
        <NText v-if="previewDiff" strong class="preview-label">{{ t('history.diffToCurrent') }}</NText>
        <pre class="text-preview">{{ previewDiff || previewText }}</pre>
      </template>
      <ElEmpty v-else :description="t('history.binaryNoPreview')" />
    </ElDialog>
  </div>
</template>

<style scoped>
.history-panel { padding: 16px; height: 100%; overflow: auto; box-sizing: border-box; }
.history-toolbar, .version-head, .capacity-head, .file-dialog-summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.history-toolbar { margin: 12px 0 16px; }
.version-card, .capacity-card { border: 1px solid var(--cottage-border); border-radius: 8px; padding: 12px; }
.version-meta, .capacity-details, .cleanup-log { color: var(--el-text-color-secondary); font-size: 12px; }
.changed-paths { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 10px; }
.renamed-from { color: var(--el-text-color-secondary); font-size: 0.9em; margin-left: 4px; }
.capacity-details { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 8px; }
.filter-row { display: grid; grid-template-columns: minmax(240px, 1fr) 150px 160px; gap: 10px; margin: 14px 0; }
.cleanup-log { margin-top: 16px; line-height: 1.8; }
.file-dialog-summary { margin-bottom: 12px; }
.image-preview { display: block; max-width: 100%; max-height: 65vh; margin: 16px auto 0; object-fit: contain; }
.text-preview { max-height: 65vh; overflow: auto; margin-top: 16px; padding: 12px; background: var(--el-fill-color-light); white-space: pre-wrap; word-break: break-word; }
.preview-label { display: block; margin-top: 16px; }
@media (max-width: 760px) { .filter-row { grid-template-columns: 1fr; } .history-toolbar { align-items: flex-start; flex-direction: column; } }
</style>
