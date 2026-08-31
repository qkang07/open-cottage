<script setup lang="ts">
import {
  ArchiveOutline,
  ArrowUndoOutline,
  ChatbubbleOutline,
  CheckmarkOutline,
  CreateOutline,
  FolderOpenOutline,
  LocateOutline,
  RefreshOutline,
  SyncOutline,
  TimeOutline,
  TrashOutline,
  WarningOutline,
  } from '@vicons/ionicons5';
import {
  ElButton,
  ElDrawer,
  ElInput,
  ElDialog,
  ElMessage,
  ElPopover,
  ElTooltip,
  ElTree,
} from 'element-plus';
import CottageTooltip from '@/ui/CottageTooltip.vue';
import {
  NIcon,
  NText
} from '@/ui/element-plus-primitives';
import type {
  DropdownOption,
  TreeOption
} from '@/ui/element-plus-types';
import { storeToRefs } from 'pinia';
import {
  computed,
  h,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  watch,
} from 'vue';
import { useI18n } from 'vue-i18n';

import {
  COTTAGE_FILE_DRAG_TYPE,
  serializeCottageReferenceDragData,
} from '../../chat/fileReferences';
import { useAiChangedFilesStore } from '../../stores/aiChangedFiles';
import { useChatReferenceStore } from '../../stores/chatReference';
import { useDebugPanelStore } from '../../stores/debugPanel';
import { useExplorerModeStore } from '../../stores/explorerMode';
import { useNewEntryDialogStore } from '../../stores/newEntryDialog';
import { useSidebarCollapseStore } from '../../stores/sidebarCollapse';
import { useWorkspaceStore } from '../../stores/workspace';
import { workspace } from '../../workspace/FileSystemWorkspace';
import { getDeferredDirTooltip } from '../../workspace/deferredDirs';
import {
  getDirChildren,
  hasDirChildren,
  setDirChildren,
} from '../../workspace/dirChildrenCache';
import type { WorkspaceFileNode } from '../../workspace/types';
import {
  basenameOf,
  joinPathInDir,
  parentDirOf,
} from '../../workspace/suggestEntryPath';
import HistoryPanel from '../History/HistoryPanel.vue';
import WorkspaceSwitcher from '../WorkspaceSwitcher/WorkspaceSwitcher.vue';
import ContextMenuPanel from '@/ui/ContextMenuPanel.vue';
import SearchPanel from './SearchPanel.vue';
import SidebarIconMenu from './SidebarIconMenu.vue';
import type { SidebarView } from './sidebarView';

/** 文件树内部拖拽移动专用 MIME type */
const COTTAGE_TREE_MOVE_TYPE = 'application/x-cottage-tree-move';

type PromptMode =
  | 'createFile'
  | 'createFolder'
  | 'rename'
  | 'compress'
  | 'extract'
  | null;
interface TreeContextMenu {
  x: number;
  y: number;
  path: string;
  isLeaf: boolean;
}
// 只转换单层节点，children 一律不递归——非叶子节点统一走 ElTree lazy load，
// 避免 snapshot 预加载的整棵嵌套树被同步建为 ElTree Node 导致主线程卡死。
const toDataNode = (node: WorkspaceFileNode): TreeOption => ({
  key: node.key,
  label: node.title,
  isLeaf: node.isLeaf,
  lazy: !node.isLeaf,
  deferred: node.deferred,
  deferredEntryCount: node.deferredEntryCount,
});
const toDataNodes = (nodes: WorkspaceFileNode[]): TreeOption[] =>
  nodes.map(toDataNode);

/** 按 path 从内存 snapshot 树查找直接子节点；命中（且有子条目）返回子节点数组，否则返回 null */
function findChildrenInTree(
  nodes: WorkspaceFileNode[],
  path: string,
): WorkspaceFileNode[] | null {
  if (!path) return nodes.length ? nodes : null;
  const parts = path.split('/').filter(Boolean);
  let current: WorkspaceFileNode[] | undefined = nodes;
  for (const part of parts) {
    if (!current) return null;
    const found: WorkspaceFileNode | undefined = current.find(
      (n) => n.title === part && !n.isLeaf,
    );
    if (!found) return null;
    current = found.children;
  }
  // 空数组（deferred 目录占位 / 真空目录）视为无内存数据，交给 IO 决定真实内容
  return current && current.length ? current : null;
}

const flattenWorkspaceKeys = (nodes: WorkspaceFileNode[]): string[] =>
  nodes.flatMap((node) => [
    node.key,
    ...(node.children ? flattenWorkspaceKeys(node.children) : []),
  ]);
const message = ElMessage;
const { t } = useI18n();
const emit = defineEmits<{
  openSettings: [tab: string];
}>();
const workspaceStore = useWorkspaceStore();
const aiChangedStore = useAiChangedFilesStore();
const chatStore = useChatReferenceStore();
const explorerModeStore = useExplorerModeStore();
const newEntryStore = useNewEntryDialogStore();
const sidebarStore = useSidebarCollapseStore();
const debugPanelStore = useDebugPanelStore();
const {
  snapshot,
  selectedPath,
  checkedPaths,
  loading,
  restoring,
  treeVersion,
  cottageConfig,
} = storeToRefs(workspaceStore);
const { explorerMode, expandedKeys } = storeToRefs(explorerModeStore);
const { requestExpandView } = storeToRefs(sidebarStore);
const promptMode = ref<PromptMode>(null);
const promptValue = ref('');
const promptValue2 = ref('');
const acting = ref(false);
const contextMenu = ref<TreeContextMenu | null>(null);
const renameSourcePath = ref('');
const lastClickedPath = ref<string | null>(null);
const drawerContent = ref<'history' | null>(null);
const sidebarView = ref<SidebarView>('files');
const showDeleteConfirm = ref(false);
const resetTargetPath = ref<string | null | undefined>(undefined);
const resettingChanges = ref(false);
const locatingCurrentFile = ref(false);
const fileTreeRootRef = ref<HTMLElement | null>(null);

// ── 拖拽移动状态 ──
// dragSourcePath: 当前正在拖拽的源路径（仅用于拖拽期间高亮判断，dragend 后清空）
const dragSourcePath = ref('');
// dropTargetPath: 当前高亮的目标路径（拖拽期间实时更新）；null 表示无目标，'' 表示根目录
const dropTargetPath = ref<string | null>(null);
// pendingMove: drop 后待确认的移动数据，独立于拖拽实时状态，避免被 dragend 清空
const pendingMove = ref<{ source: string; target: string } | null>(null);
const showMoveConfirm = computed(() => pendingMove.value !== null);
const moveActing = ref(false);

watch(requestExpandView, (view) => {
  if (!view) return;
  if (view === 'index') {
    debugPanelStore.show('index');
    sidebarStore.clearExpandView();
    return;
  }
  sidebarView.value = view;
  sidebarStore.clearExpandView();
});
watch(
  () => snapshot.value?.rootName ?? null,
  (rootName) => {
    explorerModeStore.syncWorkspace(rootName);
  },
  { immediate: true },
);
// Agent 可直接写入 workspace，store 会更新快照；已展开的 ElTree lazy 节点
// 仍持有旧 children，结构变更时必须重建一次才能显示新增项。
watch(treeVersion, () => {
  lazyLoadedKeys.value = [];
  treeMountKey.value += 1;
});
/** 已确认展开的延迟目录路径，避免重复弹窗（snapshot 切换后重置） */
const confirmedDeferredPaths = ref<Set<string>>(new Set());
const treeData = shallowRef<TreeOption[]>([]);
const treeMountKey = ref(0);
const lazyLoadedKeys = ref<string[]>([]);

watch(
  () => snapshot.value?.tree,
  (tree) => {
    treeData.value = tree?.length ? toDataNodes(tree) : [];
    lazyLoadedKeys.value = [];
  },
  { immediate: true },
);

watch(
  () => snapshot.value?.rootName ?? null,
  () => {
    treeMountKey.value += 1;
    confirmedDeferredPaths.value = new Set();
  },
);
/** shift 范围多选时按需计算所有可见 key，避免作为 computed 始终递归整棵树 */
function computeAllVisibleKeys(): string[] {
  return [
    ...flattenWorkspaceKeys(snapshot.value?.tree ?? []),
    ...lazyLoadedKeys.value,
  ];
}
function deferredNodeTooltip(data: TreeOption): string {
  if (!data.deferred) return '';
  return getDeferredDirTooltip(
    {
      reason: data.deferred,
      entryCount: data.deferredEntryCount,
    },
    String(data.label ?? data.key),
  );
}
const operationTargets = computed(() => {
  if (!contextMenu.value) {
    return checkedPaths.value.length
      ? checkedPaths.value
      : selectedPath.value
        ? [selectedPath.value]
        : [];
  }
  if (
    checkedPaths.value.length > 0 &&
    checkedPaths.value.includes(contextMenu.value.path)
  ) {
    return checkedPaths.value;
  }
  return [contextMenu.value.path];
});
const contextBaseDir = computed(() => {
  if (!contextMenu.value) {
    if (!selectedPath.value) return '';
    const parent = parentDirOf(selectedPath.value);
    return parent ? `${parent}/` : '';
  }
  if (contextMenu.value.isLeaf) {
    const parent = parentDirOf(contextMenu.value.path);
    return parent ? `${parent}/` : '';
  }
  return `${contextMenu.value.path}/`;
});
const treeSelectedKeys = computed(() =>
  checkedPaths.value.length
    ? checkedPaths.value
    : selectedPath.value
      ? [selectedPath.value]
      : [],
);
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
const showHistoryDrawer = computed({
  get: () => drawerContent.value === 'history',
  set: (open) => {
    if (!open) drawerContent.value = null;
  },
});
const historyEnabled = computed(
  () => cottageConfig.value?.history?.enabled === true,
);
const historyAvailable = computed(
  () => historyEnabled.value && Boolean(snapshot.value),
);
watch(historyAvailable, (available) => {
  if (!available) drawerContent.value = null;
});
async function openCurrentFileHistory() {
  const target = contextMenu.value?.isLeaf ? contextMenu.value.path : selectedPath.value;
  closeContextMenu();
  if (target && target !== selectedPath.value) await workspaceStore.selectFile(target);
  drawerContent.value = 'history';
}
function resolveSingleTarget(): string | null {
  if (contextMenu.value) return contextMenu.value.path;
  if (checkedPaths.value.length === 1) return checkedPaths.value[0];
  if (selectedPath.value) return selectedPath.value;
  return null;
}
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
function resolveNewEntryTarget(): { dir: string; lockDir: boolean } {
  const ctx = contextMenu.value;
  if (ctx) {
    if (ctx.isLeaf) {
      return { dir: parentDirOf(ctx.path), lockDir: false };
    }
    return { dir: ctx.path, lockDir: true };
  }
  if (selectedPath.value) {
    return { dir: parentDirOf(selectedPath.value), lockDir: false };
  }
  return { dir: '', lockDir: false };
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
function openRenameDialog() {
  const from = resolveSingleTarget();
  if (!from) {
    message.warning(t('files.selectItemFirst'));
    return;
  }
  renameSourcePath.value = from;
  promptMode.value = 'rename';
  promptValue.value = basenameOf(from);
  promptValue2.value = '';
  closeContextMenu();
}
async function runAction(fn: () => Promise<void>) {
  acting.value = true;
  try {
    await fn();
    closePrompt();
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
  } finally {
    acting.value = false;
  }
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
      if (!from) {
        message.warning(t('files.selectRenameFirst'));
        return;
      }
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
        message.warning(t('files.selectCompressFirst'));
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
    message.warning(t('files.selectDeleteFirst'));
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
const canExtract = computed(
  () =>
    operationTargets.value.length === 1 &&
    contextTargetPath.value.toLowerCase().endsWith('.zip'),
);
function buildContextMenuOptions(): DropdownOption[] {
  const contextPath = contextMenu.value?.path ?? '';
  return [
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
      label: t('files.cite'),
      disabled: !contextMenu.value?.path,
      props: {
        onClick: () => {
          if (contextMenu.value?.path) {
            chatStore.addReference({
              path: contextMenu.value.path,
              entryType: contextMenu.value.isLeaf ? 'file' : 'directory',
            });
            chatStore.focusComposer();
          }
          closeContextMenu();
        },
      },
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
      props: { onClick: confirmDelete },
      disabled: !operationTargets.value.length,
    },
    ...(contextMenu.value?.isLeaf &&
    contextPath &&
    aiChangedStore.kindOf(contextPath)
      ? [
          {
            key: 'acknowledge-ai-change',
            icon: () => h(NIcon, { component: CheckmarkOutline }),
            label: t('files.markAsNormal'),
            props: {
              onClick: () => acknowledgeFile(contextPath),
            },
          } as DropdownOption,
          {
            key: 'reset-ai-change',
            icon: () => h(NIcon, { component: ArrowUndoOutline }),
            label: t('files.resetThisFile'),
            disabled: !aiChangedStore.canReset(contextPath),
            props: {
              onClick: () => requestResetFile(contextPath),
            },
          } as DropdownOption,
        ]
      : []),
    ...(historyEnabled.value && contextMenu.value?.isLeaf
      ? [
          {
            key: 'file-history',
            icon: () => h(NIcon, { component: TimeOutline }),
            label: t('files.currentFileHistory'),
            props: { onClick: openCurrentFileHistory },
          } as DropdownOption,
        ]
      : []),
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
  ];
}
const contextMenuOptions = computed(() => buildContextMenuOptions());
function handleTreeRightClick(event: MouseEvent, node: TreeOption) {
  event.preventDefault();
  const path = String(node.key);
  const isLeaf = node.isLeaf ?? true;
  if (!checkedPaths.value.includes(path)) {
    workspaceStore.setCheckedPaths([path]);
    lastClickedPath.value = path;
    if (isLeaf) void workspaceStore.selectFile(path);
  }
  contextMenu.value = {
    x: event.clientX,
    y: event.clientY,
    path,
    isLeaf,
  };
}
function handleTreeSelect(path: string, nativeEvent: MouseEvent, isLeaf = true) {
  const ctrl = nativeEvent.ctrlKey || nativeEvent.metaKey;
  const shift = nativeEvent.shiftKey;
  if (shift && lastClickedPath.value) {
    const all = computeAllVisibleKeys();
    const fromIndex = all.indexOf(lastClickedPath.value);
    const toIndex = all.indexOf(path);
    if (fromIndex !== -1 && toIndex !== -1) {
      const start = Math.min(fromIndex, toIndex);
      const end = Math.max(fromIndex, toIndex);
      workspaceStore.setCheckedPaths(all.slice(start, end + 1));
      lastClickedPath.value = path;
      return;
    }
  }
  if (ctrl) {
    const exists = checkedPaths.value.includes(path);
    workspaceStore.setCheckedPaths(
      exists
        ? checkedPaths.value.filter((p) => p !== path)
        : [...checkedPaths.value, path],
    );
    lastClickedPath.value = path;
    return;
  }
  workspaceStore.setCheckedPaths([path]);
  lastClickedPath.value = path;
  if (isLeaf) {
    explorerModeStore.closeExplorer();
    void workspaceStore.selectFile(path);
  }
}
function handlePanelContextMenu(e: MouseEvent) {
  if (!snapshot.value) return;
  if ((e.target as HTMLElement).closest('.el-tree')) return;
  e.preventDefault();
  contextMenu.value = {
    x: e.clientX,
    y: e.clientY,
    path: selectedPath.value ?? '',
    isLeaf: Boolean(selectedPath.value && !selectedPath.value.endsWith('/')),
  };
}
function handleTreeNodeDragStart(node: TreeOption, event: DragEvent) {
  const path = String(node.key);
  const isLeaf = Boolean(node.isLeaf);
  // 内部树移动：文件和文件夹均可拖拽
  event.dataTransfer?.setData(COTTAGE_TREE_MOVE_TYPE, path);
  // 文件和文件夹都可拖到聊天框作为显式引用；text/plain 保留旧版文件兼容。
  event.dataTransfer?.setData(
    COTTAGE_FILE_DRAG_TYPE,
    serializeCottageReferenceDragData({
      path,
      entryType: isLeaf ? 'file' : 'directory',
    }),
  );
  if (isLeaf) {
    event.dataTransfer?.setData('text/plain', path);
  }
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'copyMove';
  }
  dragSourcePath.value = path;
}

/** 校验 source→target 移动是否合法（不允许移动到自身或自身子目录）
 *  target 为空字符串代表根目录，是合法目标。 */
function isValidMove(source: string, target: string): boolean {
  if (!source) return false;
  // 不允许把目录移动到自己的子目录下（target 非空时校验）
  if (target && (target === source || target.startsWith(`${source}/`))) return false;
  // 不允许移动到当前所在目录（无变化，含根目录→根目录）
  if (parentDirOf(source) === target) return false;
  return true;
}

/** 从拖拽事件中解析 drop 目标文件夹路径。
 *  - 命中文件夹节点 → 移入该文件夹
 *  - 命中文件节点 → 移入该文件所在父目录（支持拖到展开区域任意位置）
 *  返回 null 表示无合法目标。 */
function resolveDropTarget(event: DragEvent): string | null {
  const el = event.target as HTMLElement | null;
  if (!el) return null;
  const nodeEl = el.closest('.file-tree-node') as HTMLElement | null;
  if (!nodeEl) return null;
  const path = nodeEl.getAttribute('data-tree-key');
  if (!path) return null;
  const isLeaf = nodeEl.getAttribute('data-tree-is-leaf') === '1';
  if (!isLeaf) return path;
  // 文件：取其父目录作为 drop 目标
  return parentDirOf(path) || '';
}

function handleTreeContainerDragOver(event: DragEvent) {
  if (!dragSourcePath.value) return;
  const target = resolveDropTarget(event);
  if (target === null) {
    dropTargetPath.value = null;
    return;
  }
  if (!isValidMove(dragSourcePath.value, target)) {
    dropTargetPath.value = null;
    return;
  }
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
  dropTargetPath.value = target;
}

function handleTreeContainerDragLeave(event: DragEvent) {
  // 仅当离开整个树容器时清除高亮（避免在子节点间移动时闪烁）
  const related = event.relatedTarget as Node | null;
  const container = (event.currentTarget as HTMLElement) || null;
  if (container && related && container.contains(related)) return;
  dropTargetPath.value = null;
}

function handleTreeContainerDrop(event: DragEvent) {
  if (!dragSourcePath.value) return;
  const target = resolveDropTarget(event);
  if (target === null) return;
  const source = dragSourcePath.value;
  if (!isValidMove(source, target)) return;
  event.preventDefault();
  event.stopPropagation();
  // 用独立状态保存待确认数据，避免 dragend 清空拖拽实时状态后丢失
  pendingMove.value = { source, target };
}

function handleTreeDragEnd() {
  // dragend 在 drop 之后触发，只清空拖拽期间的实时状态；pendingMove 保留供弹窗使用
  dragSourcePath.value = '';
  dropTargetPath.value = null;
}

const moveSourceName = computed(() =>
  pendingMove.value ? basenameOf(pendingMove.value.source) : '',
);
const moveTargetDisplay = computed(() => {
  if (!pendingMove.value) return '';
  return pendingMove.value.target || '/';
});

async function executeMove() {
  const move = pendingMove.value;
  if (!move) return;
  const { source: from, target: dir } = move;
  const to = joinPathInDir(dir, basenameOf(from));
  if (from === to) {
    pendingMove.value = null;
    return;
  }
  moveActing.value = true;
  try {
    await workspaceStore.renameEntry(from, to);
    message.success(t('files.moved'));
  } catch (error) {
    message.error(
      t('files.moveFailed') +
        ': ' +
        (error instanceof Error ? error.message : String(error)),
    );
  } finally {
    moveActing.value = false;
    pendingMove.value = null;
  }
}

function cancelMove() {
  pendingMove.value = null;
}
const selectedKeysSet = computed(() => new Set(treeSelectedKeys.value));
function treeNodeClassName(data: TreeOption) {
  const path = String(data.key);
  const classes: string[] = [];
  if (selectedKeysSet.value.has(path)) classes.push('file-tree-node-selected');
  const kind = aiChangedStore.kindOf(path);
  if (kind === 'created' || kind === 'generated') {
    classes.push('file-tree-node-ai-created');
  } else if (kind === 'modified' || kind === 'deleted') {
    classes.push('file-tree-node-ai-modified');
  } else if (aiChangedStore.isTouched(path)) {
    classes.push('file-tree-node-ai-subtree');
  }
  return classes.join(' ');
}

function treeChangeKind(path: string): 'created' | 'modified' | null {
  const kind = aiChangedStore.kindOf(path);
  if (kind === 'created' || kind === 'generated') return 'created';
  if (kind === 'modified' || kind === 'deleted') return 'modified';
  return null;
}

function treeChangeLabel(path: string): string {
  return treeChangeKind(path) === 'created'
    ? t('files.aiCreatedBadge')
    : t('files.aiModifiedBadge');
}

function requestResetFile(path: string) {
  closeContextMenu();
  resetTargetPath.value = path;
}

function acknowledgeFile(path: string) {
  closeContextMenu();
  aiChangedStore.acknowledgeOne(path);
  message.success(t('files.markedNormalSuccess'));
}

function acknowledgeAllFiles() {
  if (!aiChangedStore.changed.length) return;
  aiChangedStore.acknowledgeAll();
  message.success(t('files.markedAllNormalSuccess'));
}

function requestResetAllFiles() {
  if (!aiChangedStore.changed.length) return;
  resetTargetPath.value = null;
}

function cancelResetChanges() {
  if (resettingChanges.value) return;
  resetTargetPath.value = undefined;
}

async function executeResetChanges() {
  resettingChanges.value = true;
  try {
    if (resetTargetPath.value) {
      await aiChangedStore.resetOne(resetTargetPath.value);
      message.success(t('files.resetFileSuccess'));
    } else {
      const { failed } = await aiChangedStore.resetAll();
      if (failed.length) {
        message.warning(t('files.resetSomeFailed', { n: failed.length }));
      } else {
        message.success(t('files.resetAllSuccess'));
      }
    }
    resetTargetPath.value = undefined;
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
  } finally {
    resettingChanges.value = false;
  }
}
interface ElTreeNodeShape {
  expanded: boolean;
  expand: () => void;
  collapse: () => void;
  childNodes: ElTreeNodeShape[];
  level: number;
  // Element Plus Node.data 为宽松 TreeNodeData；运行时我们放入 TreeOption
  data: TreeOption;
  isLeaf: boolean;
}
interface ElTreeInstanceShape {
  getNode: (key: string) => ElTreeNodeShape | undefined;
}
const treeRef = ref<ElTreeInstanceShape | null>(null);

const waitForTreeNode = async (
  key: string,
  attempts = 60,
): Promise<ElTreeNodeShape | null> => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const node = treeRef.value?.getNode(key);
    if (node) return node;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
  }
  return null;
};

/** 展开当前文件的所有父目录，并将对应树节点滚动到可视区域。 */
async function revealCurrentFileInTree() {
  const target = selectedPath.value;
  if (!target || locatingCurrentFile.value) return;

  locatingCurrentFile.value = true;
  sidebarView.value = 'files';
  try {
    await nextTick();
    const parts = target.split('/').filter(Boolean);
    const ancestorPaths = parts.slice(0, -1).map((_, index) =>
      parts.slice(0, index + 1).join('/'),
    );

    for (const path of ancestorPaths) {
      const node = await waitForTreeNode(path);
      if (!node) throw new Error(t('files.currentFileNotInTree'));

      if (node.data.deferred) {
        const confirmed = new Set(confirmedDeferredPaths.value);
        confirmed.add(path);
        confirmedDeferredPaths.value = confirmed;
        node.data.deferred = undefined;
        node.data.deferredEntryCount = undefined;
        node.data.lazy = true;
      }
      explorerModeStore.setNodeExpanded(path, true);
      if (!node.expanded) node.expand();
    }

    const targetNode = await waitForTreeNode(target);
    if (!targetNode) throw new Error(t('files.currentFileNotInTree'));

    workspaceStore.setCheckedPaths([target]);
    lastClickedPath.value = target;
    await nextTick();
    const targetElement = fileTreeRootRef.value?.querySelector<HTMLElement>(
      `[data-tree-key="${cssEscape(target)}"]`,
    );
    if (!targetElement) throw new Error(t('files.currentFileNotInTree'));
    targetElement.scrollIntoView({ block: 'nearest' });
  } catch (error) {
    message.warning(error instanceof Error ? error.message : String(error));
  } finally {
    locatingCurrentFile.value = false;
  }
}
function onTreeNodeClick(
  data: TreeOption,
  node: ElTreeNodeShape,
  _component: unknown,
  event: MouseEvent,
) {
  const isLeaf = Boolean(data.isLeaf);
  const path = String(data.key);
  if (!isLeaf && data.deferred) {
    // Crawler 已预加载时，按普通目录处理（不再弹确认框）
    if (hasDirChildren(path)) {
      data.deferred = undefined;
      data.deferredEntryCount = undefined;
      handleTreeSelect(path, event, isLeaf);
      return;
    }
    requestOpenDeferredTreeDir(data, node, event.currentTarget as HTMLElement);
    return;
  }
  handleTreeSelect(path, event, isLeaf);
}
function onTreeNodeContextMenu(event: MouseEvent, data: TreeOption) {
  handleTreeRightClick(event, data);
}
function onTreeNodeExpand(data: TreeOption, node: ElTreeNodeShape) {
  const path = String(data.key);
  if (data.deferred) {
    // Crawler 已预加载该目录时，跳过确认弹窗，直接展开
    if (hasDirChildren(path)) {
      data.deferred = undefined;
      data.deferredEntryCount = undefined;
      explorerModeStore.setNodeExpanded(path, true);
      return;
    }
    // ElTree 展开箭头已自动展开，先收回，再以锚定气泡走确认流程
    node.collapse();
    const anchor = document.querySelector(
      `[data-tree-key="${cssEscape(path)}"]`,
    ) as HTMLElement | null;
    requestOpenDeferredTreeDir(data, node, anchor);
    return;
  }
  explorerModeStore.setNodeExpanded(path, true);
}

const deferredHoverAnchor = ref<HTMLElement | null>(null);
const deferredHoverVisible = ref(false);
const deferredHoverContent = ref('');
function onDeferredNodeEnter(data: TreeOption, event: MouseEvent) {
  if (!data.deferred) return;
  deferredHoverAnchor.value = event.currentTarget as HTMLElement;
  deferredHoverContent.value = deferredNodeTooltip(data);
  deferredHoverVisible.value = true;
}
function onDeferredNodeLeave() {
  deferredHoverVisible.value = false;
}

const deferredConfirmAnchor = ref<HTMLElement | null>(null);
const deferredConfirmData = ref<TreeOption | null>(null);
const deferredConfirmNode = ref<ElTreeNodeShape | null>(null);
const deferredConfirmVisible = computed(
  () => deferredConfirmData.value !== null,
);
const deferredConfirmTip = computed(() =>
  deferredConfirmData.value ? deferredNodeTooltip(deferredConfirmData.value) : '',
);

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, '\\$&');
}

function requestOpenDeferredTreeDir(
  data: TreeOption,
  node: ElTreeNodeShape,
  anchor: HTMLElement | null,
) {
  const path = String(data.key);
  if (confirmedDeferredPaths.value.has(path)) {
    void doOpenDeferredTreeDir(data, node);
    return;
  }
  deferredHoverVisible.value = false;
  deferredConfirmAnchor.value = anchor;
  deferredConfirmData.value = data;
  deferredConfirmNode.value = node;
}

async function doOpenDeferredTreeDir(data: TreeOption, node: ElTreeNodeShape) {
  const path = String(data.key);
  const next = new Set(confirmedDeferredPaths.value);
  next.add(path);
  confirmedDeferredPaths.value = next;
  data.deferred = undefined;
  data.lazy = true;
  explorerModeStore.setNodeExpanded(path, true);
  if (!node.expanded) node.expand();
}

function confirmDeferredTreeOpen() {
  const data = deferredConfirmData.value;
  const node = deferredConfirmNode.value;
  if (!data || !node) return;
  closeDeferredTreeConfirm();
  void doOpenDeferredTreeDir(data, node);
}

function cancelDeferredTreeOpen() {
  closeDeferredTreeConfirm();
}

function closeDeferredTreeConfirm() {
  deferredConfirmAnchor.value = null;
  deferredConfirmData.value = null;
  deferredConfirmNode.value = null;
}

async function loadTreeNode(
  node: ElTreeNodeShape,
  resolve: (data: TreeOption[]) => void,
) {
  // lazy 模式下 ElTree 会先对虚拟根节点 (level 0) 调用 load，而非使用 :data
  if (node.level === 0) {
    const tree = snapshot.value?.tree ?? [];
    resolve(tree.length ? toDataNodes(tree) : []);
    return;
  }

  const path = String(node.data.key ?? '');
  if (!path) {
    resolve([]);
    return;
  }

  // 1. 内存 snapshot 树（snapshot 预加载的非 deferred 目录）
  const inMemory = findChildrenInTree(snapshot.value?.tree ?? [], path);
  if (inMemory) {
    resolve(toDataNodes(inMemory));
    return;
  }

  // 2. Crawler 全局缓存（后台全量预加载，含 deferred 目录，命中即免 IO）
  const cached = getDirChildren(path);
  if (cached) {
    resolve(toDataNodes(cached));
    return;
  }

  // 3. 即时响应 Worker：缓存未命中时单层 IO 加载，并回填缓存
  try {
    const children = await workspace.listTreeChildren(path, {
      skipIgnoredDirs: false,
      includeFileMetadata: false,
    });
    setDirChildren(path, children);
    lazyLoadedKeys.value = [
      ...lazyLoadedKeys.value,
      ...children.map((child) => child.key),
    ];
    resolve(toDataNodes(getDirChildren(path) ?? children));
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
    resolve([]);
  }
}
function onTreeNodeCollapse(data: TreeOption) {
  explorerModeStore.setNodeExpanded(String(data.key), false);
}
async function handleTreeRefresh() {
  await workspaceStore.refreshFromDisk();
}
function onKeyDown(e: KeyboardEvent) {
  if (e.key !== 'F2' || !snapshot.value) return;
  const el = e.target as HTMLElement | null;
  if (!el?.closest('.file-browser')) return;
  e.preventDefault();
  openRenameDialog();
}
onMounted(() => {
  window.addEventListener('keydown', onKeyDown);
});
onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown);
});
const bodyClass = 'panel-body file-browser-body';
</script>
<template>
  <div
    class="panel file-browser"
    style="border: none; display: flex; flex-direction: column; height: 100%"
  >
    <div
      class="panel-header"
      style="
        border-bottom: none;
        display: flex;
        align-items: center;
        gap: 8px;
        justify-content: space-between;
      "
    >
      <div style="flex: 1; min-width: 0">
        <WorkspaceSwitcher />
      </div>
      <div class="cottage-button-row">
        <CottageTooltip :content="t('files.markAllAsNormal')" placement="top">
          <span v-if="aiChangedStore.changed.length">
            <ElButton
              class="cottage-icon-btn"
              :aria-label="t('files.markAllAsNormal')"
              @click="acknowledgeAllFiles()"
            >
              <template #icon>
                <NIcon :component="CheckmarkOutline" />
              </template>
            </ElButton>
          </span>
        </CottageTooltip>
        <CottageTooltip :content="t('files.resetAllChanges')" placement="top">
          <span v-if="aiChangedStore.changed.length">
            <ElButton
              class="cottage-icon-btn"
              :loading="resettingChanges"
              :aria-label="t('files.resetAllChanges')"
              @click="requestResetAllFiles()"
            >
              <template #icon>
                <NIcon :component="ArrowUndoOutline" />
              </template>
            </ElButton>
          </span>
        </CottageTooltip>
        <CottageTooltip :content="t('files.revealCurrentFile')" placement="top">
          <span>
            <ElButton
              class="cottage-icon-btn"
              :disabled="!snapshot || !selectedPath"
              :loading="locatingCurrentFile"
              :aria-label="t('files.revealCurrentFile')"
              @click="revealCurrentFileInTree()"
            >
              <template #icon>
                <NIcon :component="LocateOutline" />
              </template>
            </ElButton>
          </span>
        </CottageTooltip>
        <CottageTooltip :content="t('common.refresh')" placement="top">
          <span>
            <ElButton
              class="cottage-icon-btn"
              :disabled="!snapshot"
              @click="handleTreeRefresh()"
            >
              <template #icon>
                <NIcon :component="RefreshOutline" />
              </template>
            </ElButton>
          </span>
        </CottageTooltip>
        <CottageTooltip :content="t('settings.tabs.workspaceFolders')" placement="top">
          <span>
            <ElButton
              class="cottage-icon-btn"
              @click="emit('openSettings', 'workspace-folders')"
            >
              <template #icon>
                <NIcon :component="FolderOpenOutline" />
              </template>
            </ElButton>
          </span>
        </CottageTooltip>
      </div>
    </div>
    <SidebarIconMenu
      :active-view="sidebarView"
      :explorer-mode="explorerMode"
      :explorer-disabled="!snapshot"
      :history-enabled="historyAvailable"
      :create-disabled="!snapshot"
      @change="sidebarView = $event"
      @create-file="openCreateTextFile"
      @create-folder="openCreateFolderDialog"
      @open-history="drawerContent = 'history'"
      @toggle-explorer="
        explorerMode
          ? explorerModeStore.closeExplorer()
          : explorerModeStore.openExplorer()
      "
    />
    <div class="file-browser-content">
      <div
        :class="bodyClass"
        :style="{ padding: sidebarView === 'files' ? '4px 6px 12px' : '0' }"
        @contextmenu="sidebarView === 'files' ? handlePanelContextMenu : undefined"
      >
        <div v-if="restoring || (loading && !snapshot)" class="centered">
          <div class="loading-brand loading-brand--small" aria-busy="true" aria-live="polite">
            <div class="loading-logo-ring">
              <NIcon :component="restoring ? SyncOutline : FolderOpenOutline" class="loading-logo-icon" />
            </div>
            <span class="loading-brand-name">Open Cottage</span>
            <div class="loading-dots">
              <span /><span /><span />
            </div>
            <span class="loading-message">
              {{ restoring ? t('welcome.restoringWorkspace') : t('files.loading') }}
            </span>
          </div>
        </div>
        <template v-else-if="snapshot">
          <div
            v-if="sidebarView === 'files'"
            ref="fileTreeRootRef"
            :class="['file-tree-root', { 'file-tree-root--drop-target-root': dropTargetPath === '' && Boolean(dragSourcePath) }]"
            @dragover.capture="handleTreeContainerDragOver"
            @dragleave="handleTreeContainerDragLeave"
            @drop.capture="handleTreeContainerDrop"
          >
          <ElTree
            ref="treeRef"
            :key="treeMountKey"
            lazy
            :load="(loadTreeNode as any)"
            :data="treeData"
            node-key="key"
            :props="{ label: 'label', children: 'children', isLeaf: 'isLeaf' }"
            :node-class-name="treeNodeClassName"
            :default-expanded-keys="expandedKeys"
            style="background: transparent"
            @node-click="(onTreeNodeClick as any)"
            @node-contextmenu="(onTreeNodeContextMenu as any)"
            @node-expand="(onTreeNodeExpand as any)"
            @node-collapse="onTreeNodeCollapse"
          >
            <template #default="{ data }">
              <div
                :class="['file-tree-node', { 'file-tree-node--deferred': Boolean(data.deferred), 'file-tree-node--drop-target': !data.isLeaf && dropTargetPath === String(data.key) && Boolean(dragSourcePath) }]"
                :data-tree-key="String(data.key)"
                :data-tree-is-leaf="data.isLeaf ? '1' : '0'"
                :draggable="true"
                @mouseenter="data.deferred ? onDeferredNodeEnter(data, $event) : undefined"
                @mouseleave="data.deferred ? onDeferredNodeLeave() : undefined"
                @dragstart.stop="handleTreeNodeDragStart(data as TreeOption, $event)"
                @dragend.stop="handleTreeDragEnd"
              >
                <NIcon
                  v-if="data.deferred"
                  class="file-tree-node-deferred-icon"
                  :component="WarningOutline"
                />
                <span class="file-tree-node-label">{{ data.label ?? String(data.key) }}</span>
                <span
                  v-if="treeChangeKind(String(data.key))"
                  :class="`file-tree-change-badge file-tree-change-badge--${treeChangeKind(String(data.key))}`"
                >
                  {{ treeChangeLabel(String(data.key)) }}
                </span>
              </div>
            </template>
          </ElTree>
          </div>
          <SearchPanel v-else-if="sidebarView === 'search'" />
        </template>
      </div>
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
                ? t('files.promptZipOut')
                : promptMode === 'extract'
                  ? t('files.promptZipIn')
                  : promptMode === 'createFolder'
                    ? t('files.promptRelDir')
                    : t('files.promptRelFile')
          "
          :autofocus="promptMode === 'rename'"
          @keyup.enter="handlePromptOk"
        />
        <ElInput
          v-if="promptMode === 'extract'"
          v-model="promptValue2"
          :placeholder="t('files.extractTargetOptional')"
          @keyup.enter="handlePromptOk"
        />
        <NText v-if="promptMode === 'createFile'" depth="3">
          {{ t('files.createEmptyUtf8Hint') }}
        </NText>
        <NText
          v-if="promptMode === 'rename' && renameSourcePath"
          depth="3"
          class="file-rename-hint"
        >
          {{
            parentDirOf(renameSourcePath)
              ? t('files.locationAt', { path: parentDirOf(renameSourcePath) })
              : t('files.locationRoot')
          }}
        </NText>
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
    <ElDialog
      :model-value="resetTargetPath !== undefined"
      :title="resetTargetPath ? t('files.resetFileTitle') : t('files.resetAllTitle')"
      width="440px"
      :close-on-click-modal="!resettingChanges"
      :close-on-press-escape="!resettingChanges"
      @update:model-value="(open: boolean) => { if (!open) cancelResetChanges(); }"
    >
      {{
        resetTargetPath
          ? t('files.resetFileBody', { path: resetTargetPath })
          : t('files.resetAllBody', { n: aiChangedStore.changed.length })
      }}
      <template #footer>
        <ElButton :disabled="resettingChanges" @click="cancelResetChanges">
          {{ t('common.cancel') }}
        </ElButton>
        <ElButton type="danger" :loading="resettingChanges" @click="executeResetChanges">
          {{ t('files.confirmReset') }}
        </ElButton>
      </template>
    </ElDialog>
    <ElDialog v-model="showMoveConfirm" :title="t('files.confirmMoveTitle')" width="420px">
      {{ t('files.confirmMoveBody', { name: moveSourceName, target: moveTargetDisplay }) }}
      <template #footer>
        <ElButton :disabled="moveActing" @click="cancelMove">
          {{ t('common.cancel') }}
        </ElButton>
        <ElButton type="primary" :loading="moveActing" @click="executeMove">
          {{ t('common.confirm') }}
        </ElButton>
      </template>
    </ElDialog>
    <ElDrawer
      v-model="showHistoryDrawer"
      size="min(980px, 94vw)"
      direction="ltr"
      :title="t('files.fileHistory')"
      :body-style="{ padding: 0 }"
    >
      <HistoryPanel />
    </ElDrawer>
    <ElTooltip
      :virtual-ref="deferredHoverAnchor ?? undefined"
      virtual-triggering
      :visible="deferredHoverVisible"
      :content="deferredHoverContent"
      placement="right"
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
      @update:visible="(v: boolean) => { if (!v) cancelDeferredTreeOpen(); }"
    >
      <div class="deferred-confirm-content">
        <div class="deferred-confirm-text">{{ deferredConfirmTip }}</div>
        <div class="deferred-confirm-actions">
          <ElButton size="small" @click="cancelDeferredTreeOpen">{{ t('common.cancel') }}</ElButton>
          <ElButton size="small" type="primary" @click="confirmDeferredTreeOpen">
            {{ t('common.open') }}
          </ElButton>
        </div>
      </div>
    </ElPopover>
  </div>
</template>
