<script setup lang="ts">
import {
  AppsOutline,
  ArchiveOutline,
  ArrowBackOutline,
  ArrowForwardOutline,
  ArrowUpOutline,
  ChatbubbleOutline,
  CloseOutline,
  CopyOutline,
  CreateOutline,
  FolderOpenOutline,
  GridOutline,
  InformationCircleOutline,
  ListOutline,
  RefreshOutline,
  SearchOutline,
  TrashOutline,
  } from '@vicons/ionicons5';
import {
  ElBreadcrumb,
  ElBreadcrumbItem,
  ElButton,
  ElTable,
  ElTableColumn,
  ElEmpty,
  ElInput,
  ElDialog,
  ElMessage,
  ElPopover,
  ElTooltip,
} from 'element-plus';
import CottageTooltip from '@/ui/CottageTooltip.vue';
import {
  NIcon,
  NSpin,
  NText
} from '@/ui/element-plus-primitives';
import type {
  DropdownOption
} from '@/ui/element-plus-types';
import { storeToRefs } from 'pinia';
import {
  computed,
  defineComponent,
  h,
  onUnmounted,
  ref,
  watch,
  type PropType,
} from 'vue';
import { useI18n } from 'vue-i18n';
import {
  filtersFromForm,
  runWorkspaceSearch,
  type WorkspaceSearchMode,
  type WorkspaceSearchResultGroup,
} from '../../workspace/runWorkspaceSearch';
import FileSearchResults from '../FileBrowser/FileSearchResults.vue';
import FileSearchToolbar from '../FileBrowser/FileSearchToolbar.vue';
import { useChatReferenceStore } from '../../stores/chatReference';
import { useAiChangedFilesStore } from '../../stores/aiChangedFiles';
import { useExplorerModeStore } from '../../stores/explorerMode';
import { useNewEntryDialogStore } from '../../stores/newEntryDialog';
import { useFilesystemMetadataStore } from '../../stores/filesystemMetadata';
import { useWorkspaceStore, workspace } from '../../stores/workspace';
import type {
  DirectorySizeResult,
  ExplorerEntry,
  ExplorerSortKey,
  ExplorerSortOrder,
  ExplorerViewMode,
} from '../../workspace/explorerTypes';
import {
  basenameOf,
  joinPathInDir,
  parentDirOf,
} from '../../workspace/suggestEntryPath';
import {
  deferredEntryClass,
  enrichEntriesWithDeferred,
  formatBytes,
  formatModified,
  getEntryDeferredTooltip,
  getEntryIcon,
  getTypeLabel,
  joinDirSegments,
  sortEntries,
  splitPathSegments,
} from './explorerUtils';
import ContextMenuPanel from '@/ui/ContextMenuPanel.vue';
import { getPreviewKind } from '../../workspace/previewKind';
type PromptMode =
  | 'createFile'
  | 'createFolder'
  | 'rename'
  | 'compress'
  | 'extract'
  | null;
const message = ElMessage;
const { t } = useI18n();
const explorerModeStore = useExplorerModeStore();
const newEntryStore = useNewEntryDialogStore();
const workspaceStore = useWorkspaceStore();
const chatStore = useChatReferenceStore();
const aiChangedStore = useAiChangedFilesStore();
const metadataStore = useFilesystemMetadataStore();
const {
  snapshot,
  selectedPath,
  checkedPaths,
  loading,
} = storeToRefs(workspaceStore);
const { currentDir, history, historyIndex } = storeToRefs(explorerModeStore);
const entries = ref<ExplorerEntry[]>([]);
const entriesLoading = ref(false);
const viewMode = ref<ExplorerViewMode>('details');
const sortKey = ref<ExplorerSortKey>('name');
const sortOrder = ref<ExplorerSortOrder>('asc');
const showDetailsPane = ref(true);
const lastClickedPath = ref<string | null>(null);
const contextMenu = ref<{
  x: number;
  y: number;
  path: string;
  isLeaf: boolean;
} | null>(null);
const promptMode = ref<PromptMode>(null);
const promptValue = ref('');
const promptValue2 = ref('');
const renameSourcePath = ref('');
const recursiveSizeLoading = ref(false);
const recursiveSizeResult = ref<DirectorySizeResult | null>(null);
const recursiveSizeError = ref<string | null>(null);
const recursiveSizePath = ref<string | null>(null);
let recursiveSizeAbort: AbortController | null = null;
const folderSizeLoadingPaths = ref<Record<string, true>>({});
const folderSizeAbortControllers = new Map<string, AbortController>();
const acting = ref(false);
const showDeleteConfirm = ref(false);
/** 已确认打开的延迟目录路径，避免重复弹窗（snapshot 切换后重置） */
const confirmedDeferredPaths = ref<Set<string>>(new Set());
const searchMode = ref(false);
const searchQuery = ref('');
const debouncedSearchQuery = ref('');
const searchCaseSensitive = ref(false);
const searchIsRegex = ref(false);
const searchModeType = ref<WorkspaceSearchMode>('text');
const searchIncludePattern = ref('');
const searchExcludePattern = ref('');
const searchFileTypePreset = ref('');
const searchMinSizeInput = ref('');
const searchMaxSizeInput = ref('');
const searchGroups = ref<WorkspaceSearchResultGroup[]>([]);
const searchSummary = ref<string | null>(null);
const searchRunning = ref(false);
const searchProgress = ref<{ scanned: number; total: number } | null>(null);
let searchAbort: AbortController | null = null;
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const sortedEntries = computed(() => {
  void metadataStore.directorySizes;
  return sortEntries(entries.value, sortKey.value, sortOrder.value, resolveEntrySortSize);
});
function resolveEntrySortSize(entry: ExplorerEntry): number {
  if (entry.kind === 'file') return entry.size ?? -1;
  return metadataStore.getDirectorySize(entry.path)?.totalBytes ?? -1;
}
function getEntryDisplaySize(entry: ExplorerEntry): string {
  if (entry.kind === 'file') return formatBytes(entry.size);
  const cached = metadataStore.getDirectorySize(entry.path);
  return cached ? formatBytes(cached.totalBytes) : '—';
}
function cacheDirectorySize(path: string, result: DirectorySizeResult) {
  metadataStore.setDirectorySize(path, result);
}
function isFolderSizeLoading(path: string): boolean {
  void folderSizeLoadingPaths.value;
  return Boolean(folderSizeLoadingPaths.value[path]);
}
async function refreshFolderSize(entry: ExplorerEntry) {
  if (entry.kind !== 'directory') return;

  const path = entry.path;
  folderSizeAbortControllers.get(path)?.abort();

  const controller = new AbortController();
  folderSizeAbortControllers.set(path, controller);
  folderSizeLoadingPaths.value = { ...folderSizeLoadingPaths.value, [path]: true };

  try {
    await workspace.getDirectorySize(path, {
      signal: controller.signal,
      skipIgnoredDirs: false,
      onDirectorySized: cacheDirectorySize,
    });
  } catch (err) {
    if (controller.signal.aborted) return;
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    if (!controller.signal.aborted) {
      const next = { ...folderSizeLoadingPaths.value };
      delete next[path];
      folderSizeLoadingPaths.value = next;
      folderSizeAbortControllers.delete(path);
    }
  }
}
function abortAllFolderSizeRequests() {
  for (const controller of folderSizeAbortControllers.values()) {
    controller.abort();
  }
  folderSizeAbortControllers.clear();
  folderSizeLoadingPaths.value = {};
}
async function loadDirectory(dir: string) {
  entriesLoading.value = true;
  try {
    const raw = await workspace.listDirectoryContents(dir);
    const deferredDirs = snapshot.value?.deferredDirs ?? {};
    entries.value = enrichEntriesWithDeferred(raw, deferredDirs);
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
    entries.value = [];
  } finally {
    entriesLoading.value = false;
  }
}
function navigateTo(dir: string) {
  const normalized = dir.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  currentDir.value = normalized;
  const trimmed = history.value.slice(0, historyIndex.value + 1);
  if (trimmed[trimmed.length - 1] === normalized) {
    history.value = trimmed;
    return;
  }
  const next = [...trimmed, normalized];
  history.value = next;
  historyIndex.value = next.length - 1;
}
watch(currentDir, (dir) => {
  void loadDirectory(dir);
}, { immediate: true });
watch(selectedPath, (path) => {
  if (!path) return;
  const parent = parentDirOf(path);
  if (parent !== currentDir.value) {
    currentDir.value = parent;
    history.value = [parent];
    historyIndex.value = 0;
  }
});
const canGoBack = computed(() => historyIndex.value > 0);
const canGoForward = computed(() => historyIndex.value < history.value.length - 1);
function goBack() {
  if (!canGoBack.value) return;
  const nextIndex = historyIndex.value - 1;
  historyIndex.value = nextIndex;
  currentDir.value = history.value[nextIndex] ?? '';
}
function goForward() {
  if (!canGoForward.value) return;
  const nextIndex = historyIndex.value + 1;
  historyIndex.value = nextIndex;
  currentDir.value = history.value[nextIndex] ?? '';
}
function goUp() {
  if (!currentDir.value) return;
  const segments = splitPathSegments(currentDir.value);
  segments.pop();
  navigateTo(joinDirSegments(segments));
}
function handleRefresh() {
  void workspaceStore.refresh();
  void loadDirectory(currentDir.value);
}
onUnmounted(() => {
  searchAbort?.abort();
  abortAllFolderSizeRequests();
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  resetRecursiveSizeState();
  revokeDetailThumbnail();
});
watch(searchQuery, (value) => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    debouncedSearchQuery.value = value.trim();
  }, 300);
});
watch(snapshot, () => {
  metadataStore.clearAll();
  confirmedDeferredPaths.value = new Set();
  void loadDirectory(currentDir.value);
});
async function runExplorerSearch() {
  if (!snapshot.value || !debouncedSearchQuery.value) {
    searchGroups.value = [];
    searchSummary.value = null;
    return;
  }
  searchAbort?.abort();
  const controller = new AbortController();
  searchAbort = controller;
  searchRunning.value = true;
  searchProgress.value = null;
  searchGroups.value = [];
  searchSummary.value = null;
  try {
    const filters = filtersFromForm({
      includePattern: searchIncludePattern.value,
      excludePattern: searchExcludePattern.value,
      fileTypePreset: searchFileTypePreset.value,
      minSizeInput: searchMinSizeInput.value,
      maxSizeInput: searchMaxSizeInput.value,
    });
    const result = await runWorkspaceSearch({
      query: debouncedSearchQuery.value,
      mode: searchModeType.value,
      caseSensitive: searchCaseSensitive.value,
      isRegex: searchIsRegex.value,
      ...filters,
      signal: controller.signal,
      onProgress: (scanned, total) => {
        searchProgress.value = { scanned, total };
      },
    });
    if (controller.signal.aborted) return;
    searchGroups.value = result.groups;
    searchSummary.value = result.summary;
  } catch (err) {
    if (controller.signal.aborted) return;
    searchSummary.value = err instanceof Error ? err.message : String(err);
  } finally {
    if (!controller.signal.aborted) {
      searchRunning.value = false;
      searchProgress.value = null;
    }
  }
}
watch(
  [
    debouncedSearchQuery,
    searchCaseSensitive,
    searchIsRegex,
    searchModeType,
    searchIncludePattern,
    searchExcludePattern,
    searchMinSizeInput,
    searchMaxSizeInput,
    snapshot,
  ],
  () => {
    if (!searchMode.value) return;
    void runExplorerSearch();
  },
);
function toggleSearchMode() {
  searchMode.value = !searchMode.value;
  if (!searchMode.value) {
    searchAbort?.abort();
    searchGroups.value = [];
    searchSummary.value = null;
  }
}
function openSearchResult(path: string) {
  void workspaceStore.selectFile(path);
  explorerModeStore.closeExplorer();
}
function openSearchResultAtLine(path: string, line: number) {
  void workspaceStore.selectFile(path);
  explorerModeStore.closeExplorer();
  window.setTimeout(() => {
    window.dispatchEvent(
      new CustomEvent('cottage:goto-line', { detail: { path, line } }),
    );
  }, 100);
}
const searchStatusText = computed(() => {
  if (searchRunning.value) {
    if (searchProgress.value) {
      return t('search.searchingProgress', {
        scanned: searchProgress.value.scanned,
        total: searchProgress.value.total,
      });
    }
    if (searchModeType.value === 'filename') return t('search.searchingFilename');
    return t('search.searching');
  }
  return searchSummary.value ?? t('search.startHint');
});
const operationTargets = computed(() => {
  if (contextMenu.value) {
    if (
      checkedPaths.value.length > 0 &&
      checkedPaths.value.includes(contextMenu.value.path)
    ) {
      return checkedPaths.value;
    }
    return [contextMenu.value.path];
  }
  return checkedPaths.value.length
    ? checkedPaths.value
    : selectedPath.value
      ? [selectedPath.value]
      : [];
});
const contextBaseDir = computed(() => {
  if (contextMenu.value) {
    if (contextMenu.value.isLeaf) {
      const parent = parentDirOf(contextMenu.value.path);
      return parent ? `${parent}/` : '';
    }
    return `${contextMenu.value.path}/`;
  }
  return currentDir.value ? `${currentDir.value}/` : '';
});
function closeContextMenu() {
  contextMenu.value = null;
}
function openPrompt(mode: PromptMode, defaults?: { a?: string; b?: string }) {
  promptMode.value = mode;
  promptValue.value = defaults?.a ?? '';
  promptValue2.value = defaults?.b ?? '';
  closeContextMenu();
}
function closePrompt() {
  promptMode.value = null;
  promptValue.value = '';
  promptValue2.value = '';
  renameSourcePath.value = '';
}
async function runAction(fn: () => Promise<void>) {
  acting.value = true;
  try {
    await fn();
    closePrompt();
    await loadDirectory(currentDir.value);
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
  } finally {
    acting.value = false;
  }
}
function resolveSingleTarget(): string | null {
  if (contextMenu.value) return contextMenu.value.path;
  if (checkedPaths.value.length === 1) return checkedPaths.value[0];
  if (selectedPath.value) return selectedPath.value;
  return null;
}
function openRenameDialog() {
  const from = resolveSingleTarget();
  if (!from) {
    message.warning(t('files.selectItemFirst'));
    return;
  }
  renameSourcePath.value = from;
  promptMode.value = 'rename';
  promptValue.value = basenameOf(from);
  closeContextMenu();
}
function resolveNewEntryTarget(): { dir: string; lockDir: boolean } {
  const ctx = contextMenu.value;
  if (ctx) {
    if (ctx.isLeaf) {
      return { dir: parentDirOf(ctx.path), lockDir: false };
    }
    return { dir: ctx.path, lockDir: true };
  }
  return { dir: currentDir.value, lockDir: false };
}
function openCreateTextFile() {
  const target = resolveNewEntryTarget();
  newEntryStore.open({ mode: 'file', ...target });
  closeContextMenu();
}
function openCreateFolderDialog() {
  const target = resolveNewEntryTarget();
  newEntryStore.open({ mode: 'folder', ...target });
  closeContextMenu();
}
function handlePromptOk() {
  const value = promptValue.value.trim();
  if (!value) {
    message.warning(t('files.enterPath'));
    return;
  }
  switch (promptMode.value) {
    case 'createFile':
      void runAction(async () => {
        await workspaceStore.createFile(value, '');
        message.success(t('files.createdFile'));
      });
      break;
    case 'createFolder':
      void runAction(async () => {
        await workspaceStore.createFolder(value);
        message.success(t('files.createdFolder'));
      });
      break;
    case 'rename': {
      const from = renameSourcePath.value;
      if (!from) return;
      let to: string;
      try {
        to = joinPathInDir(parentDirOf(from), value);
      } catch (error) {
        message.warning(
          error instanceof Error ? error.message : String(error),
        );
        return;
      }
      if (to === from) {
        closePrompt();
        return;
      }
      void runAction(async () => {
        await workspaceStore.renameEntry(from, to);
        message.success(t('files.renamed'));
      });
      break;
    }
    case 'compress':
      if (!operationTargets.value.length) {
        message.warning(t('explorer.selectCompressFirst'));
        return;
      }
      void runAction(() =>
        workspaceStore.compressChecked(operationTargets.value, value),
      );
      break;
    case 'extract':
      void runAction(() =>
        workspaceStore.extractArchive(value, promptValue2.value.trim()),
      );
      break;
    default:
      break;
  }
}
function confirmDelete() {
  if (!operationTargets.value.length) {
    message.warning(t('explorer.selectDeleteFirst'));
    return;
  }
  closeContextMenu();
  showDeleteConfirm.value = true;
}
async function executeDelete() {
  await runAction(async () => {
    await workspaceStore.deletePaths(operationTargets.value);
    message.success(t('files.deleted'));
  });
  showDeleteConfirm.value = false;
}
const contextTargetPath = computed(() => operationTargets.value[0] ?? '');

/** 根据当前列表条目推断路径类型（目录/文件），兼容尾斜杠约定 */
function entryTypeOfPath(path: string): 'file' | 'directory' {
  const entry = sortedEntries.value.find((item) => item.path === path);
  if (entry) return entry.kind === 'directory' ? 'directory' : 'file';
  return path.endsWith('/') ? 'directory' : 'file';
}

/** 批量将路径引用到对话输入框 */
function citePaths(paths: string[]) {
  if (!paths.length) return;
  for (const path of paths) {
    chatStore.addReference({ path, entryType: entryTypeOfPath(path) });
  }
  chatStore.focusComposer();
  message.success(t('explorer.citedChecked', { n: paths.length }));
}

/** 引用当前选中/勾选项到对话（右键菜单与状态栏共用） */
function citeOperationTargets() {
  citePaths(operationTargets.value);
  closeContextMenu();
}

/** 条目是否被 AI 改动过（目录含子树命中） */
function entryAiTouched(entry: ExplorerEntry): boolean {
  return aiChangedStore.isTouched(entry.path);
}

/** 角标提示文案：精确命中按改动类别，目录子树命中用通用文案 */
function entryAiTip(entry: ExplorerEntry): string {
  const kind = aiChangedStore.kindOf(entry.path);
  if (kind === 'created' || kind === 'generated') {
    return t('explorer.aiChangedTipGenerated');
  }
  if (kind === 'deleted') return t('explorer.aiChangedTipDeleted');
  if (kind === 'modified') return t('explorer.aiChangedTipModified');
  return t('explorer.aiChangedTipSubtree');
}

const canExtract = computed(
  () =>
    operationTargets.value.length === 1 &&
    contextTargetPath.value.toLowerCase().endsWith('.zip'),
);
const contextMenuOptions = computed((): DropdownOption[] => [
  {
    key: 'new-file',
    icon: () => h(NIcon, { component: CreateOutline }),
    label: t('files.newFile'),
    props: { onClick: openCreateTextFile },
  },
  {
    key: 'new-folder',
    icon: () => h(NIcon, { component: FolderOpenOutline }),
    label: t('files.newFolder'),
    props: { onClick: openCreateFolderDialog },
  },
  { type: 'divider', key: 'd1' },
  {
    key: 'reference',
    icon: () => h(NIcon, { component: ChatbubbleOutline }),
    label:
      operationTargets.value.length > 1
        ? t('explorer.citeChecked', { n: operationTargets.value.length })
        : t('files.citeToChat'),
    disabled: !operationTargets.value.length,
    props: { onClick: citeOperationTargets },
  },
  {
    key: 'rename',
    icon: () => h(NIcon, { component: CreateOutline }),
    label: t('files.rename'),
    disabled: !resolveSingleTarget(),
    props: { onClick: openRenameDialog },
  },
  {
    key: 'delete',
    icon: () => h(NIcon, { component: TrashOutline }),
    label: t('files.delete'),
    disabled: !operationTargets.value.length,
    props: { onClick: confirmDelete },
  },
  { type: 'divider', key: 'd2' },
  {
    key: 'compress',
    icon: () => h(NIcon, { component: ArchiveOutline }),
    label: t('files.compressZip'),
    disabled: !operationTargets.value.length,
    props: {
      onClick: () => openPrompt('compress', { a: 'archive.zip' }),
    },
  },
  {
    key: 'extract',
    icon: () => h(NIcon, { component: ArchiveOutline }),
    label: t('files.extractZip'),
    disabled: !canExtract.value,
    props: {
      onClick: () =>
        openPrompt('extract', {
          a: contextTargetPath.value,
          b: contextMenu.value?.isLeaf
            ? contextBaseDir.value.replace(/\/$/, '')
            : contextMenu.value?.path ?? '',
        }),
    },
  },
]);
function handleEntryClick(entry: ExplorerEntry, event: MouseEvent) {
  const path = entry.path;
  const ctrl = event.ctrlKey || event.metaKey;
  const shift = event.shiftKey;
  const allPaths = sortedEntries.value.map((item) => item.path);
  if (shift && lastClickedPath.value) {
    const fromIndex = allPaths.indexOf(lastClickedPath.value);
    const toIndex = allPaths.indexOf(path);
    if (fromIndex !== -1 && toIndex !== -1) {
      const start = Math.min(fromIndex, toIndex);
      const end = Math.max(fromIndex, toIndex);
      workspaceStore.setCheckedPaths(allPaths.slice(start, end + 1));
      lastClickedPath.value = path;
      return;
    }
  }
  if (ctrl) {
    const exists = checkedPaths.value.includes(path);
    workspaceStore.setCheckedPaths(
      exists
        ? checkedPaths.value.filter((item) => item !== path)
        : [...checkedPaths.value, path],
    );
    lastClickedPath.value = path;
    return;
  }
  workspaceStore.setCheckedPaths([path]);
  lastClickedPath.value = path;
  if (entry.kind === 'file') {
    void workspaceStore.selectFile(path);
  }
}
function handleEntryDoubleClick(entry: ExplorerEntry, event: MouseEvent) {
  if (entry.kind === 'directory') {
    if (entry.deferred && !confirmedDeferredPaths.value.has(entry.path)) {
      requestOpenDeferredEntry(entry, event.currentTarget as HTMLElement);
    } else {
      navigateTo(entry.path);
    }
    return;
  }
  void workspaceStore.selectFile(entry.path);
  explorerModeStore.closeExplorer();
}

const deferredHoverAnchor = ref<HTMLElement | null>(null);
const deferredHoverVisible = ref(false);
const deferredHoverContent = ref('');
function onDeferredEntryEnter(entry: ExplorerEntry, event: MouseEvent) {
  if (!entry.deferred) return;
  deferredHoverAnchor.value = event.currentTarget as HTMLElement;
  deferredHoverContent.value = entryTooltip(entry) ?? '';
  deferredHoverVisible.value = true;
}
function onDeferredEntryLeave() {
  deferredHoverVisible.value = false;
}

const deferredConfirmAnchor = ref<HTMLElement | null>(null);
const deferredConfirmEntry = ref<ExplorerEntry | null>(null);
const deferredConfirmVisible = computed(
  () => deferredConfirmEntry.value !== null,
);
const deferredConfirmTip = computed(() =>
  deferredConfirmEntry.value ? entryTooltip(deferredConfirmEntry.value) ?? '' : '',
);

function requestOpenDeferredEntry(entry: ExplorerEntry, anchor: HTMLElement) {
  deferredHoverVisible.value = false;
  deferredConfirmAnchor.value = anchor;
  deferredConfirmEntry.value = entry;
}

function confirmDeferredEntryOpen() {
  const entry = deferredConfirmEntry.value;
  if (!entry) return;
  const path = entry.path;
  closeDeferredEntryConfirm();
  const next = new Set(confirmedDeferredPaths.value);
  next.add(path);
  confirmedDeferredPaths.value = next;
  navigateTo(path);
}

function cancelDeferredEntryOpen() {
  closeDeferredEntryConfirm();
}

function closeDeferredEntryConfirm() {
  deferredConfirmAnchor.value = null;
  deferredConfirmEntry.value = null;
}

function onOpenFolderButtonClick(event: MouseEvent) {
  const target = detailTarget.value;
  if (!target || target.kind !== 'directory') return;
  if (target.deferred && !confirmedDeferredPaths.value.has(target.path)) {
    requestOpenDeferredEntry(target, event.currentTarget as HTMLElement);
    return;
  }
  navigateTo(target.path);
}
function handlePanelContextMenu(event: MouseEvent) {
  event.preventDefault();
  contextMenu.value = {
    x: event.clientX,
    y: event.clientY,
    path: selectedPath.value ?? currentDir.value,
    isLeaf: Boolean(selectedPath.value && !selectedPath.value.endsWith('/')),
  };
}
function handleEntryContextMenu(entry: ExplorerEntry, event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
  if (!checkedPaths.value.includes(entry.path)) {
    workspaceStore.setCheckedPaths([entry.path]);
    lastClickedPath.value = entry.path;
    if (entry.kind === 'file') void workspaceStore.selectFile(entry.path);
  }
  contextMenu.value = {
    x: event.clientX,
    y: event.clientY,
    path: entry.path,
    isLeaf: entry.kind === 'file',
  };
}
function handleKeyDown(event: KeyboardEvent) {
  if (event.key === 'F2') {
    event.preventDefault();
    openRenameDialog();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
    event.preventDefault();
    workspaceStore.setCheckedPaths(
      sortedEntries.value.map((item) => item.path),
    );
  }
  if (event.key === 'Backspace' && !event.metaKey && !event.ctrlKey) {
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
    event.preventDefault();
    goUp();
  }
}
const breadcrumbItems = computed(() => {
  const rootLabel = snapshot.value?.rootName ?? t('files.workspace');
  const segments = splitPathSegments(currentDir.value);
  const items: { title: string; path: string }[] = [{ title: rootLabel, path: '' }];
  segments.forEach((_segment, index) => {
    items.push({
      title: segments[index],
      path: joinDirSegments(segments.slice(0, index + 1)),
    });
  });
  return items;
});
const detailTarget = computed(() => {
  if (checkedPaths.value.length === 1) {
    return entries.value.find((entry) => entry.path === checkedPaths.value[0]) ?? null;
  }
  if (selectedPath.value) {
    return entries.value.find((entry) => entry.path === selectedPath.value) ?? null;
  }
  return null;
});

function resetRecursiveSizeState() {
  recursiveSizeAbort?.abort();
  recursiveSizeAbort = null;
  recursiveSizeLoading.value = false;
  recursiveSizeResult.value = null;
  recursiveSizeError.value = null;
  recursiveSizePath.value = null;
}

watch(detailTarget, (target, prev) => {
  if (target?.path === prev?.path) return;
  resetRecursiveSizeState();
  loadDetailThumbnail(target);
});

const detailThumbnailUrl = ref<string | null>(null);
let detailThumbnailToken = 0;

function revokeDetailThumbnail() {
  if (detailThumbnailUrl.value) {
    URL.revokeObjectURL(detailThumbnailUrl.value);
    detailThumbnailUrl.value = null;
  }
}

async function loadDetailThumbnail(target: ExplorerEntry | null) {
  const token = ++detailThumbnailToken;
  revokeDetailThumbnail();
  if (
    !target ||
    target.kind !== 'file' ||
    target.deferred ||
    getPreviewKind(target.path) !== 'image'
  ) {
    return;
  }
  try {
    const bytes = await workspace.readFileBytes(target.path);
    if (token !== detailThumbnailToken) return;
    if (!bytes || bytes.byteLength === 0) return;
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const url = URL.createObjectURL(new Blob([buffer]));
    if (token !== detailThumbnailToken) {
      URL.revokeObjectURL(url);
      return;
    }
    detailThumbnailUrl.value = url;
  } catch {
    // 读取失败时回退到大图标
  }
}

async function copyDetailPath() {
  const target = detailTarget.value;
  if (!target) return;
  try {
    await navigator.clipboard.writeText(target.path);
    message.success(t('explorer.copyPathSuccess'));
  } catch {
    message.error(t('explorer.copyPathFailed'));
  }
}

async function computeRecursiveFolderSize() {
  const target = detailTarget.value;
  if (!target || target.kind !== 'directory') return;

  recursiveSizeAbort?.abort();
  const controller = new AbortController();
  recursiveSizeAbort = controller;

  recursiveSizeLoading.value = true;
  recursiveSizeError.value = null;
  recursiveSizeResult.value = null;
  recursiveSizePath.value = target.path;

  try {
    const result = await workspace.getDirectorySize(target.path, {
      signal: controller.signal,
      skipIgnoredDirs: false,
      onDirectorySized: cacheDirectorySize,
    });
    if (controller.signal.aborted) return;
    if (!result) {
      recursiveSizeError.value = t('explorer.cannotReadFolder');
      return;
    }
    cacheDirectorySize(target.path, result);
    recursiveSizeResult.value = result;
  } catch (err) {
    if (controller.signal.aborted) return;
    recursiveSizeError.value =
      err instanceof Error ? err.message : String(err);
  } finally {
    if (!controller.signal.aborted) {
      recursiveSizeLoading.value = false;
    }
  }
}

const detailSizeLabel = computed(() => {
  void metadataStore.directorySizes;
  const target = detailTarget.value;
  if (!target) return '—';
  if (target.kind === 'file') return formatBytes(target.size);
  const cached = metadataStore.getDirectorySize(target.path);
  if (cached) return formatBytes(cached.totalBytes);
  if (
    recursiveSizePath.value === target.path &&
    recursiveSizeResult.value
  ) {
    return formatBytes(recursiveSizeResult.value.totalBytes);
  }
  return '—';
});

const detailSizeHint = computed(() => {
  void metadataStore.directorySizes;
  const target = detailTarget.value;
  if (!target || target.kind !== 'directory') return null;
  const result =
    metadataStore.getDirectorySize(target.path) ??
    (recursiveSizePath.value === target.path ? recursiveSizeResult.value : null);
  if (!result) return null;
  const { fileCount, directoryCount } = result;
  const parts = [t('explorer.fileCount', { n: fileCount })];
  if (directoryCount > 0) {
    parts.push(t('explorer.subfolderCount', { n: directoryCount }));
  }
  return parts.join(t('common.listJoin'));
});
const promptTitle = computed(() => {
  const mode = promptMode.value;
  if (!mode) return '';
  const titles: Record<Exclude<PromptMode, null>, string> = {
    createFile: t('files.newFile'),
    createFolder: t('files.newFolder'),
    rename: t('files.rename'),
    compress: t('files.compressZip'),
    extract: t('files.extractZip'),
  };
  return titles[mode];
});
const showPromptDialog = computed({
  get: () => promptMode.value !== null,
  set: (open) => {
    if (!open) closePrompt();
  },
});
function handleSorterChange(sorter: { prop: string | null; order: 'ascending' | 'descending' | null }) {
  const keyMap: Record<string, ExplorerSortKey> = {
    name: 'name',
    modified: 'modified',
    type: 'type',
    size: 'size',
  };
  const columnKey = String(sorter.prop ?? 'name');
  sortKey.value = keyMap[columnKey] ?? 'name';
  sortOrder.value =
    sorter.order === 'descending'
      ? 'desc'
      : sorter.order === 'ascending'
        ? 'asc'
        : sortOrder.value;
}
const ExplorerEntryIcon = defineComponent({
  name: 'ExplorerEntryIcon',
  props: {
    entry: { type: Object as PropType<ExplorerEntry>, required: true },
  },
  setup(props) {
    return () => getEntryIcon(props.entry);
  },
});
function entryTooltip(entry: ExplorerEntry): string | undefined {
  const deferredDirs = snapshot.value?.deferredDirs ?? {};
  return getEntryDeferredTooltip(entry, deferredDirs) ?? undefined;
}
const viewModes = computed((): { value: ExplorerViewMode; icon: typeof AppsOutline; title: string }[] => [
  { value: 'icons', icon: AppsOutline, title: t('explorer.viewIcons') },
  { value: 'list', icon: ListOutline, title: t('explorer.viewList') },
  { value: 'details', icon: GridOutline, title: t('explorer.viewDetails') },
]);
</script>
<template>
  <div class="panel file-explorer" tabindex="0" @keydown="handleKeyDown">
    <div class="panel-header file-explorer-header">
      <div class="cottage-button-row cottage-button-row--nowrap">
        <CottageTooltip :content="t('explorer.back')" placement="top">
          <span>
            <ElButton class="cottage-icon-btn" :disabled="!canGoBack" @click="goBack">
              <template #icon><NIcon :component="ArrowBackOutline" /></template>
            </ElButton>
          </span>
        </CottageTooltip>
        <CottageTooltip :content="t('explorer.forward')" placement="top">
          <span>
            <ElButton class="cottage-icon-btn" :disabled="!canGoForward" @click="goForward">
              <template #icon><NIcon :component="ArrowForwardOutline" /></template>
            </ElButton>
          </span>
        </CottageTooltip>
        <CottageTooltip :content="t('explorer.up')" placement="top">
          <span>
            <ElButton class="cottage-icon-btn" :disabled="!currentDir" @click="goUp">
              <template #icon><NIcon :component="ArrowUpOutline" /></template>
            </ElButton>
          </span>
        </CottageTooltip>
        <CottageTooltip :content="t('common.refresh')" placement="top">
          <span>
            <ElButton class="cottage-icon-btn" :disabled="loading" @click="handleRefresh">
              <template #icon><NIcon :component="RefreshOutline" /></template>
            </ElButton>
          </span>
        </CottageTooltip>
        <CottageTooltip :content="t('explorer.search')" placement="top">
          <ElButton
            class="cottage-icon-btn"
            :type="searchMode ? 'primary' : 'default'"
            @click="toggleSearchMode"
          >
            <template #icon><NIcon :component="SearchOutline" /></template>
          </ElButton>
        </CottageTooltip>
      </div>
      <div class="file-explorer-breadcrumb">
        <ElBreadcrumb>
          <ElBreadcrumbItem v-for="item in breadcrumbItems" :key="item.path">
            <button type="button" class="file-explorer-crumb" @click="navigateTo(item.path)">
              {{ item.title }}
            </button>
          </ElBreadcrumbItem>
        </ElBreadcrumb>
      </div>
      <div class="cottage-button-row cottage-button-row--nowrap">
        <div class="cottage-button-row explorer-view-toggle">
          <CottageTooltip
            v-for="{ value, icon, title } in viewModes"
            :key="value"
            :content="title"
            placement="top"
          >
            <ElButton
              class="cottage-icon-btn"
              :type="viewMode === value ? 'primary' : 'default'"
              @click="viewMode = value"
            >
              <template #icon><NIcon :component="icon" /></template>
            </ElButton>
          </CottageTooltip>
        </div>
        <CottageTooltip :content="t('explorer.detailsPanel')" placement="top">
          <ElButton
            class="cottage-icon-btn"
            :type="showDetailsPane ? 'primary' : 'default'"
            @click="showDetailsPane = !showDetailsPane"
          >
            <template #icon><NIcon :component="InformationCircleOutline" /></template>
          </ElButton>
        </CottageTooltip>
        <CottageTooltip :content="t('explorer.backToPreview')" placement="top">
          <ElButton class="cottage-icon-btn" @click="explorerModeStore.closeExplorer()">
            <template #icon><NIcon :component="CloseOutline" /></template>
          </ElButton>
        </CottageTooltip>
      </div>
    </div>
    <div class="file-explorer-body">
      <div v-if="searchMode" class="file-explorer-search">
        <FileSearchToolbar
          v-model:query="searchQuery"
          v-model:mode="searchModeType"
          v-model:case-sensitive="searchCaseSensitive"
          v-model:is-regex="searchIsRegex"
          v-model:include-pattern="searchIncludePattern"
          v-model:exclude-pattern="searchExcludePattern"
          v-model:file-type-preset="searchFileTypePreset"
          v-model:min-size-input="searchMinSizeInput"
          v-model:max-size-input="searchMaxSizeInput"
          :searching="searchRunning"
          compact
          @search="runExplorerSearch()"
        />
        <div class="file-explorer-search-status">
          <NSpin v-if="searchRunning" size="small" />
          <NText depth="3">{{ searchStatusText }}</NText>
        </div>
        <FileSearchResults
          :groups="searchGroups"
          :query="debouncedSearchQuery"
          :case-sensitive="searchCaseSensitive"
          @open-file="openSearchResult"
          @open-at-line="openSearchResultAtLine"
        />
      </div>
      <template v-else>
      <div class="file-explorer-content" @contextmenu="handlePanelContextMenu">
        <div v-if="entriesLoading" class="centered">
          <NSpin size="small" />
        </div>
        <div v-else-if="sortedEntries.length" class="explorer-view-container">
          <div v-if="viewMode === 'icons'" class="explorer-icons-grid">
            <button
              v-for="entry in sortedEntries"
              :key="entry.path"
              type="button"
              :class="['explorer-icon-item', deferredEntryClass(entry), { selected: checkedPaths.includes(entry.path) }]"
              @mouseenter="entry.deferred ? onDeferredEntryEnter(entry, $event) : undefined"
              @mouseleave="entry.deferred ? onDeferredEntryLeave() : undefined"
              @click="handleEntryClick(entry, $event)"
              @dblclick="handleEntryDoubleClick(entry, $event)"
              @contextmenu="handleEntryContextMenu(entry, $event)"
            >
              <span class="explorer-icon-item-graphic">
                <ExplorerEntryIcon :entry="entry" />
                <span
                  v-if="entryAiTouched(entry)"
                  class="explorer-ai-dot"
                  :title="entryAiTip(entry)"
                />
              </span>
              <span class="explorer-icon-item-label">{{ entry.name }}</span>
            </button>
          </div>
          <div v-else-if="viewMode === 'list'" class="explorer-list">
            <div class="explorer-list-header">
              <span class="explorer-list-header-spacer" aria-hidden="true" />
              <span class="explorer-list-header-name">{{ t('explorer.colName') }}</span>
              <span class="explorer-list-header-size">{{ t('explorer.colSize') }}</span>
            </div>
            <div
              v-for="entry in sortedEntries"
              :key="entry.path"
              :class="['explorer-list-item', deferredEntryClass(entry), { selected: checkedPaths.includes(entry.path) }]"
              role="button"
              tabindex="0"
              @mouseenter="entry.deferred ? onDeferredEntryEnter(entry, $event) : undefined"
              @mouseleave="entry.deferred ? onDeferredEntryLeave() : undefined"
              @click="handleEntryClick(entry, $event)"
              @dblclick="handleEntryDoubleClick(entry, $event)"
              @contextmenu="handleEntryContextMenu(entry, $event)"
            >
              <ExplorerEntryIcon :entry="entry" />
              <span
                v-if="entryAiTouched(entry)"
                class="explorer-ai-dot explorer-ai-dot--inline"
                :title="entryAiTip(entry)"
              />
              <span class="explorer-list-item-name">{{ entry.name }}</span>
              <span class="explorer-list-item-meta explorer-entry-size-cell">
                <span class="explorer-entry-size-value">{{ getEntryDisplaySize(entry) }}</span>
                <CottageTooltip :content="t('explorer.computeFolderSize')" placement="top">
                  <ElButton
                    v-if="entry.kind === 'directory'"
                    class="cottage-icon-btn explorer-size-refresh-btn"
                    size="small"
                    :loading="isFolderSizeLoading(entry.path)"
                    @click.stop="refreshFolderSize(entry)"
                  >
                    <template #icon>
                      <NIcon :component="RefreshOutline" />
                    </template>
                  </ElButton>
                </CottageTooltip>
              </span>
            </div>
          </div>
          <ElTable
            v-else
            class="explorer-details-table"
            :data="sortedEntries"
            row-key="path"
            :row-class-name="({ row }) => [
              checkedPaths.includes((row as ExplorerEntry).path) ? 'explorer-row-selected' : '',
              deferredEntryClass(row as ExplorerEntry),
            ].filter(Boolean).join(' ')"
            style="height: calc(100vh - 220px)"
            @sort-change="handleSorterChange"
            @row-click="(row, _column, event) => handleEntryClick(row as ExplorerEntry, event)"
            @row-dblclick="(row, _column, event) => handleEntryDoubleClick(row as ExplorerEntry, event)"
            @row-contextmenu="(row, _column, event) => handleEntryContextMenu(row as ExplorerEntry, event)"
          >
            <ElTableColumn prop="name" :label="t('explorer.colName')" sortable="custom" min-width="280">
              <template #default="{ row }">
                <div
                  class="explorer-name-cell"
                  @mouseenter="(row as ExplorerEntry).deferred ? onDeferredEntryEnter(row as ExplorerEntry, $event) : undefined"
                  @mouseleave="(row as ExplorerEntry).deferred ? onDeferredEntryLeave() : undefined"
                >
                  <ExplorerEntryIcon :entry="row as ExplorerEntry" />
                  <span
                    v-if="entryAiTouched(row as ExplorerEntry)"
                    class="explorer-ai-dot explorer-ai-dot--inline"
                    :title="entryAiTip(row as ExplorerEntry)"
                  />
                  <span>{{ (row as ExplorerEntry).name }}</span>
                </div>
              </template>
            </ElTableColumn>
            <ElTableColumn prop="modified" :label="t('explorer.colModified')" sortable="custom" width="180">
              <template #default="{ row }">
                {{ formatModified((row as ExplorerEntry).modified) }}
              </template>
            </ElTableColumn>
            <ElTableColumn prop="type" :label="t('explorer.colType')" sortable="custom" width="160">
              <template #default="{ row }">
                {{ getTypeLabel(row as ExplorerEntry) }}
              </template>
            </ElTableColumn>
            <ElTableColumn prop="size" :label="t('explorer.colSize')" sortable="custom" width="140" align="right">
              <template #default="{ row }">
                <div
                  class="explorer-entry-size-cell explorer-entry-size-cell--table"
                  @click.stop
                >
                  <span class="explorer-entry-size-value">
                    {{ getEntryDisplaySize(row as ExplorerEntry) }}
                  </span>
                  <CottageTooltip :content="t('explorer.computeFolderSize')" placement="top">
                    <ElButton
                      v-if="(row as ExplorerEntry).kind === 'directory'"
                      class="cottage-icon-btn explorer-size-refresh-btn"
                      size="small"
                      :loading="isFolderSizeLoading((row as ExplorerEntry).path)"
                      @click.stop="refreshFolderSize(row as ExplorerEntry)"
                    >
                      <template #icon>
                        <NIcon :component="RefreshOutline" />
                      </template>
                    </ElButton>
                  </CottageTooltip>
                </div>
              </template>
            </ElTableColumn>
          </ElTable>
        </div>
        <ElEmpty v-else :description="t('explorer.emptyFolder')" />
      </div>
      <aside v-if="showDetailsPane" class="file-explorer-details-pane">
        <div v-if="detailTarget" class="file-explorer-details-content">
          <div
            v-if="detailThumbnailUrl"
            class="file-explorer-details-thumbnail"
          >
            <img :src="detailThumbnailUrl" :alt="detailTarget.name" />
          </div>
          <div v-else class="file-explorer-details-icon">
            <ExplorerEntryIcon v-if="detailTarget" :entry="detailTarget" />
          </div>
          <NText tag="h5" strong class="file-explorer-details-name">
            {{ detailTarget.name }}
          </NText>
          <NText
            v-if="detailTarget.deferred"
            depth="3"
            class="file-explorer-details-deferred-hint"
          >
            {{ entryTooltip(detailTarget) }}
          </NText>
          <dl class="file-explorer-details-meta">
            <div>
              <dt>{{ t('explorer.type') }}</dt>
              <dd>{{ getTypeLabel(detailTarget) }}</dd>
            </div>
            <div>
              <dt>{{ t('explorer.location') }}</dt>
              <dd>{{ detailTarget.path }}</dd>
            </div>
            <div>
              <dt>{{ t('explorer.colSize') }}</dt>
              <dd>
                {{ detailSizeLabel }}
                <span
                  v-if="detailSizeHint"
                  class="file-explorer-details-size-hint"
                >
                  （{{ detailSizeHint }}）
                </span>
              </dd>
            </div>
            <div>
              <dt>{{ t('explorer.modifiedTime') }}</dt>
              <dd>{{ formatModified(detailTarget.modified) }}</dd>
            </div>
          </dl>
          <ElButton
            v-if="detailTarget.kind === 'directory'"
            :loading="recursiveSizeLoading && recursiveSizePath === detailTarget.path"
            block
            @click="computeRecursiveFolderSize()"
          >
            {{ t('explorer.computeFolderTotalSize') }}
          </ElButton>
          <NText
            v-if="
              detailTarget.kind === 'directory' &&
              recursiveSizePath === detailTarget.path &&
              recursiveSizeError
            "
            depth="3"
            class="file-explorer-details-error"
          >
            {{ recursiveSizeError }}
          </NText>
          <ElButton
            v-if="detailTarget.kind === 'file'"
            type="primary"
            block
            @click="
              workspaceStore.selectFile(detailTarget.path);
              explorerModeStore.closeExplorer();
            "
          >
            {{ t('explorer.openPreview') }}
          </ElButton>
          <ElButton
            v-else
            type="primary"
            block
            @click="onOpenFolderButtonClick($event)"
          >
            {{ t('explorer.openFolder') }}
          </ElButton>
          <div class="file-explorer-details-actions">
            <CottageTooltip :content="t('explorer.copyPath')" placement="top">
              <ElButton
                text
                :aria-label="t('explorer.copyPath')"
                @click="copyDetailPath"
              >
                <template #icon>
                  <NIcon :component="CopyOutline" />
                </template>
              </ElButton>
            </CottageTooltip>
            <CottageTooltip :content="t('files.rename')" placement="top">
              <ElButton
                text
                :aria-label="t('files.rename')"
                @click="openRenameDialog"
              >
                <template #icon>
                  <NIcon :component="CreateOutline" />
                </template>
              </ElButton>
            </CottageTooltip>
            <CottageTooltip :content="t('common.delete')" placement="top">
              <ElButton
                text
                :aria-label="t('common.delete')"
                class="file-explorer-details-action-danger"
                @click="confirmDelete"
              >
                <template #icon>
                  <NIcon :component="TrashOutline" />
                </template>
              </ElButton>
            </CottageTooltip>
          </div>
        </div>
        <div v-else class="file-explorer-details-empty">
          <NText depth="3">
            {{
              checkedPaths.length > 1
                ? t('explorer.selectedCount', { n: checkedPaths.length })
                : t('explorer.selectToInspect')
            }}
          </NText>
        </div>
      </aside>
      </template>
    </div>
    <div class="file-explorer-statusbar">
      <span>
        {{ t('explorer.itemCount', { n: sortedEntries.length }) }}
        <template v-if="checkedPaths.length">
          {{ t('explorer.selectedSuffix', { n: checkedPaths.length }) }}
        </template>
      </span>
      <span class="file-explorer-statusbar-right">
        <ElButton
          v-if="checkedPaths.length"
          size="small"
          text
          type="primary"
          @click="citePaths(checkedPaths)"
        >
          {{ t('explorer.citeChecked', { n: checkedPaths.length }) }}
        </ElButton>
        <ElButton
          v-if="aiChangedStore.changed.length"
          size="small"
          text
          @click="aiChangedStore.clearAll()"
        >
          {{ t('explorer.clearAiMarks') }}
        </ElButton>
        <span>{{ currentDir || snapshot?.rootName || t('files.workspace') }}</span>
      </span>
    </div>
    <div
      v-if="contextMenu"
      class="file-context-menu-backdrop"
      @click="closeContextMenu"
      @contextmenu.prevent="closeContextMenu"
    />
    <ContextMenuPanel
      :show="contextMenu !== null"
      :x="contextMenu?.x ?? 0"
      :y="contextMenu?.y ?? 0"
      :options="contextMenuOptions"
      @clickoutside="closeContextMenu"
      @update:show="(v: boolean) => { if (!v) closeContextMenu(); }"
    />
    <ElDialog
      v-model="showPromptDialog"
      :title="promptTitle"
      width="480px"
      :close-on-click-modal="!acting"
      :close-on-press-escape="!acting"
    >
      <div style="display: flex; flex-direction: column; gap: 12px; width: 100%">
        <ElInput
          v-model="promptValue"
          :placeholder="
            promptMode === 'rename'
              ? t('files.promptNewName')
              : promptMode === 'compress'
                ? t('explorer.promptZipOut')
                : promptMode === 'extract'
                  ? t('explorer.promptZipIn')
                  : t('explorer.promptRelPath')
          "
          :autofocus="promptMode === 'rename'"
          @keyup.enter="handlePromptOk"
        />
        <ElInput
          v-if="promptMode === 'extract'"
          v-model="promptValue2"
          :placeholder="t('explorer.extractTargetOptional')"
          @keyup.enter="handlePromptOk"
        />
      </div>
      <template #footer>
        <ElButton :disabled="acting" @click="closePrompt">{{ t('common.cancel') }}</ElButton>
        <ElButton type="primary" :loading="acting" @click="handlePromptOk">
          {{ t('common.confirm') }}
        </ElButton>
      </template>
    </ElDialog>
    <ElDialog v-model="showDeleteConfirm" :title="t('files.confirmDeleteTitle')" width="420px">
      {{ t('files.confirmDeleteBody', { n: operationTargets.length }) }}
      <template #footer>
        <ElButton :disabled="acting" @click="showDeleteConfirm = false">
          {{ t('common.cancel') }}
        </ElButton>
        <ElButton type="danger" :loading="acting" @click="executeDelete">
          {{ t('common.delete') }}
        </ElButton>
      </template>
    </ElDialog>
    <ElTooltip
      :virtual-ref="deferredHoverAnchor ?? undefined"
      virtual-triggering
      :visible="deferredHoverVisible"
      :content="deferredHoverContent"
      placement="top"
      :show-after="0"
      popper-class="deferred-hover-tooltip"
    />
    <ElPopover
      :virtual-ref="deferredConfirmAnchor ?? undefined"
      virtual-triggering
      :visible="deferredConfirmVisible"
      placement="right"
      :width="280"
      popper-class="deferred-confirm-popover"
      @update:visible="(v: boolean) => { if (!v) cancelDeferredEntryOpen(); }"
    >
      <div class="deferred-confirm-content">
        <div class="deferred-confirm-text">{{ deferredConfirmTip }}</div>
        <div class="deferred-confirm-actions">
          <ElButton size="small" @click="cancelDeferredEntryOpen">{{ t('common.cancel') }}</ElButton>
          <ElButton size="small" type="primary" @click="confirmDeferredEntryOpen">
            {{ t('common.open') }}
          </ElButton>
        </div>
      </div>
    </ElPopover>
  </div>
</template>
