import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';
import { setWorkspaceActiveFile } from '../chat/workspaceActiveFile';
import { loadCottageConfigFromWorkspace } from '../config/cottageStorage';
import { getCottageConfig } from '../config/store';
import type { CottageConfig } from '../config/constants';
import { initHistory, trackManualEdit } from '../history/autoCheckpoint';
import { scheduleBackgroundSymbolIndex } from '../domains/coding/indexBackground';
import type { SpreadsheetContent } from '../agent/officeDocuments';
import { workspace } from '../workspace/FileSystemWorkspace';
import { startCrawler, stopCrawler } from '../workspace/crawlerHost';
import { clearDirChildrenCache } from '../workspace/dirChildrenCache';
import type { FilePreview, PresentationSlidePreview, PreviewKind } from '../workspace/previewKind';
import { applySnapshotPatch, type SnapshotPatch } from '../workspace/snapshotPatch';
import type { WorkspaceSnapshot } from '../workspace/types';
import {
  getLastWorkspaceId,
  loadLastDirectoryHandle,
  loadRecentDirectoryHandle,
  forgetRecentWorkspace,
  readRecentWorkspaces,
  rememberWorkspace,
  setRecentWorkspaceAlias,
  touchRecentWorkspace,
  type RecentWorkspace,
} from '../workspace/workspacePersistence';

/** 可编辑的预览类型列表 */
const EDITABLE_PREVIEW_KINDS: PreviewKind[] = ['text', 'markdown', 'html'];

/** 检查指定预览类型是否可编辑 */
export const isEditablePreview = (kind: PreviewKind | null) =>
  kind !== null && EDITABLE_PREVIEW_KINDS.includes(kind);

/**
 * 工作空间状态管理。
 * 控制工作空间的打开/关闭、文件选择与预览、文件操作、以及工作空间切换时的资源清理。
 */
export const useWorkspaceStore = defineStore('workspace', () => {
  const snapshot = ref<WorkspaceSnapshot | null>(null);
  const activeWorkspaceId = ref<string | null>(getLastWorkspaceId());
  const cottageConfig = ref<CottageConfig>(getCottageConfig());
  const recentWorkspaces = ref<RecentWorkspace[]>(readRecentWorkspaces());
  const selectedPath = ref<string | null>(null);
  const checkedPaths = ref<string[]>([]);
  const previewKind = ref<PreviewKind | null>(null);
  const previewContent = ref<string | null>(null);
  const previewObjectUrl = ref<string | null>(null);
  const previewSpreadsheet = ref<SpreadsheetContent | null>(null);
  const previewWordHtml = ref<string | null>(null);
  const previewPresentationSlides = ref<PresentationSlidePreview[] | null>(null);
  const previewDirty = ref(false);
  const loading = ref(false);
  const restoring = ref(true);
  /** 供懒加载文件树在结构变化后重建已缓存的节点。 */
  const treeVersion = ref(0);

  const previewUrlRef = shallowRef<string | null>(null);
  const htmlContentRef = shallowRef<string | null>(null);
  const savedPreviewContentRef = shallowRef<string | null>(null);
  const restoreAttemptedRef = shallowRef(false);

  /** 释放当前预览 URL 对象 */
  function revokePreviewUrl() {
    if (previewUrlRef.value) {
      URL.revokeObjectURL(previewUrlRef.value);
      previewUrlRef.value = null;
    }
  }

  /** 设置预览 URL（自动管理旧 URL 的释放） */
  function setManagedPreviewUrl(url: string | null) {
    revokePreviewUrl();
    if (url) previewUrlRef.value = url;
    previewObjectUrl.value = url;
  }

  /** 在新窗口打开 HTML 预览内容（通过沙箱页面隔离，防止访问主应用存储） */
  function openHtmlPreview() {
    const content = htmlContentRef.value ?? savedPreviewContentRef.value;
    if (!content) return;
    const popup = window.open('/sandbox.html', '_blank');
    if (!popup) return;
    // 等待沙箱页面就绪后发送 HTML 内容
    const trySend = (attempts = 0) => {
      if (attempts > 50) return; // ~5s 超时
      try {
        popup.postMessage({ type: 'cottage-sandbox-html', html: content }, '*');
      } catch {
        // 窗口已关闭或跨域，忽略
        return;
      }
      // 沙箱页面收到消息后不再回执，重试几次确保送达
      if (attempts < 5) {
        setTimeout(() => trySend(attempts + 1), 100);
      }
    };
    // 给新窗口一点时间完成初始加载
    setTimeout(trySend, 200);
  }

  /** 从工作空间重新加载 Cottage 配置 */
  async function reloadCottageConfig() {
    const config = await loadCottageConfigFromWorkspace();
    cottageConfig.value = config;
    return config;
  }

  /** 清空 Office 文档预览状态 */
  function clearOfficePreview() {
    previewSpreadsheet.value = null;
    previewWordHtml.value = null;
    previewPresentationSlides.value = null;
  }

  /** 应用文件预览数据到状态 */
  function applyFilePreview(preview: FilePreview) {
    previewKind.value = preview.kind;
    clearOfficePreview();

    if (preview.kind === 'image' || preview.kind === 'video' || preview.kind === 'pdf') {
      previewContent.value = null;
      savedPreviewContentRef.value = null;
      htmlContentRef.value = null;
      if (preview.objectUrl) {
        previewUrlRef.value = preview.objectUrl;
        previewObjectUrl.value = preview.objectUrl;
      }
      return;
    }

    if (preview.kind === 'spreadsheet') {
      previewContent.value = null;
      savedPreviewContentRef.value = null;
      htmlContentRef.value = null;
      previewObjectUrl.value = null;
      previewSpreadsheet.value = preview.data;
      return;
    }

    if (preview.kind === 'word') {
      previewContent.value = null;
      savedPreviewContentRef.value = null;
      htmlContentRef.value = null;
      previewObjectUrl.value = null;
      previewWordHtml.value = preview.html;
      return;
    }

    if (preview.kind === 'presentation') {
      previewContent.value = null;
      savedPreviewContentRef.value = null;
      htmlContentRef.value = null;
      previewObjectUrl.value = null;
      previewPresentationSlides.value = preview.slides;
      return;
    }

    if ('content' in preview) {
      previewContent.value = preview.content;
      savedPreviewContentRef.value = preview.content;
      htmlContentRef.value = preview.kind === 'html' ? preview.content : null;
      previewObjectUrl.value = null;
    }
  }

  /** 清空当前预览状态 */
  function clearPreview() {
    setWorkspaceActiveFile(null);
    selectedPath.value = null;
    previewKind.value = null;
    previewContent.value = null;
    clearOfficePreview();
    previewDirty.value = false;
    savedPreviewContentRef.value = null;
    htmlContentRef.value = null;
    setManagedPreviewUrl(null);
  }

  /** 同步最近工作空间列表 */
  function syncRecentList() {
    recentWorkspaces.value = readRecentWorkspaces();
  }

  /** 工作空间切换前的清理工作（终止 Worker、重置状态） */
  async function beforeWorkspaceChange(nextWorkspaceId: string) {
    if (!workspace.isOpen) return;
    if (activeWorkspaceId.value === nextWorkspaceId && snapshot.value) return;

    const { resetIndexWorker } = await import('../rag/indexer');
    resetIndexWorker();
    const { terminateDiffWorker } = await import('../agent/diffWorkerHost');
    terminateDiffWorker();
    const { resetBackgroundSubtaskRuns } = await import('../task/subtask');
    resetBackgroundSubtaskRuns();
    const { terminateAstWorker } = await import('../domains/coding/ast/astWorkerHost');
    terminateAstWorker();
    const { resetSymbolWorker } = await import('../domains/coding/indexer');
    resetSymbolWorker();
    const { terminateSnapshotWorker } = await import('../workspace/snapshotWalkerHost');
    terminateSnapshotWorker();
    stopCrawler();
    clearDirChildrenCache();

    const { useAgentStore } = await import('./agent');
    await useAgentStore().prepareWorkspaceSwitch();
    checkedPaths.value = [];
    clearPreview();
    snapshot.value = null;
  }

  /** 工作空间激活后的收尾工作（刷新配置、启动后台任务） */
  async function finishWorkspaceActivation() {
    syncRecentList();
    await reloadCottageConfig();
    const next = await workspace.snapshot();
    snapshot.value = next;
    checkedPaths.value = [];
    clearPreview();
    // 启动后台全量预加载 Worker，把所有目录（含 deferred）的子节点填入全局缓存，
    // 之后展开任意目录都能命中缓存而无需 IO
    const rootHandle = workspace.rootHandle;
    if (rootHandle) startCrawler(rootHandle);
    // [HIDDEN] 向量索引不再随工作区打开自动初始化或建库。
    scheduleBackgroundSymbolIndex();

    const { useAgentStore } = await import('./agent');
    await useAgentStore().initAgentForWorkspace();
    void initHistory();
  }

  /** 激活已存储的工作空间（从 IndexedDB 恢复） */
  async function activateStoredWorkspace(handle: FileSystemDirectoryHandle, workspaceId: string) {
    await beforeWorkspaceChange(workspaceId);
    await workspace.restoreDirectory(handle);
    touchRecentWorkspace(workspaceId);
    activeWorkspaceId.value = workspaceId;
    await finishWorkspaceActivation();
  }

  /** 从磁盘刷新工作空间快照 */
  async function refreshFromDisk() {
    if (!workspace.isOpen) return;
    loading.value = true;
    try {
      const next = await workspace.snapshot();
      snapshot.value = next;
      treeVersion.value += 1;
      // 刷新后磁盘可能已变化，清空目录缓存避免命中过期数据
      clearDirChildrenCache();
    } finally {
      loading.value = false;
    }
  }

  /** 刷新工作空间（别名方法） */
  async function refresh() {
    await refreshFromDisk();
  }

  /** 应用快照补丁（增量更新） */
  function patchSnapshot(patch: SnapshotPatch) {
    if (!snapshot.value) return;
    const next = applySnapshotPatch(snapshot.value, patch);
    if (next === snapshot.value) return;
    snapshot.value = next;
    treeVersion.value += 1;
  }

  // Agent 和其扩展工具直接调用 workspace.writeFile/writeFileBytes 等 API，
  // 不会经过本 store 的 createFile 等 UI 操作。集中接收成功后的变更通知，
  // 让目录快照与实际磁盘保持同步；失败或未获批准的操作不会产生通知。
  workspace.onDidChange((patch) => {
    patchSnapshot(patch);
  });

  /** 打开工作空间（用户选择文件夹） */
  async function openWorkspace() {
    loading.value = true;
    try {
      const handle = await workspace.openDirectory();
      const id = await rememberWorkspace(handle);
      await beforeWorkspaceChange(id);
      touchRecentWorkspace(id);
      activeWorkspaceId.value = id;
      await finishWorkspaceActivation();
    } finally {
      loading.value = false;
    }
  }

  /** 将当前工作空间添加到最近列表 */
  async function addWorkspaceToRecent() {
    if (!('showDirectoryPicker' in window)) {
      throw new Error('当前浏览器不支持 File System Access API');
    }
    loading.value = true;
    try {
      const picked = await window.showDirectoryPicker({ mode: 'readwrite' });
      const granted = await picked.requestPermission({ mode: 'readwrite' });
      if (granted !== 'granted') {
        throw new Error('需要授权才能保存该文件夹');
      }
      await rememberWorkspace(picked);
      syncRecentList();
    } finally {
      loading.value = false;
    }
  }

  /** 关闭当前工作空间 */
  async function closeWorkspace() {
    if (!workspace.isOpen && !snapshot.value) return;
    await beforeWorkspaceChange('');
    workspace.close();
    activeWorkspaceId.value = null;
    snapshot.value = null;
    syncRecentList();
  }

  /** 从最近列表中移除指定工作空间 */
  async function removeRecentWorkspace(id: string) {
    const isActive = activeWorkspaceId.value === id && workspace.isOpen;
    loading.value = true;
    try {
      await forgetRecentWorkspace(id);
      if (isActive) {
        await closeWorkspace();
      } else {
        syncRecentList();
      }
    } finally {
      loading.value = false;
    }
  }

  /** 打开最近列表中的指定工作空间 */
  async function openRecentWorkspace(id: string) {
    loading.value = true;
    try {
      const handle = await loadRecentDirectoryHandle(id);
      if (!handle) {
        syncRecentList();
        throw new Error('未找到已保存的文件夹，请重新选择');
      }
      await activateStoredWorkspace(handle, id);
    } finally {
      loading.value = false;
    }
  }

  /** 尝试恢复上次的工作空间（应用启动时调用） */
  async function tryRestoreLastWorkspace() {
    if (restoreAttemptedRef.value) return;
    restoreAttemptedRef.value = true;

    if (!('showDirectoryPicker' in window)) {
      restoring.value = false;
      return;
    }
    try {
      const handle = await loadLastDirectoryHandle();
      const id = getLastWorkspaceId();
      if (!handle || !id) return;
      await activateStoredWorkspace(handle, id);
    } catch {
      // 用户拒绝授权或 handle 失效时保持未打开状态
    } finally {
      restoring.value = false;
    }
  }

  /** 选择文件并加载预览 */
  async function selectFile(path: string) {
    setWorkspaceActiveFile(path);
    selectedPath.value = path;
    loading.value = true;
    revokePreviewUrl();
    previewObjectUrl.value = null;
    clearOfficePreview();
    previewDirty.value = false;
    try {
      const preview = await workspace.readFileForPreview(path);
      applyFilePreview(preview);
    } finally {
      loading.value = false;
    }
  }

  /** 执行文件操作并刷新（可选应用快照补丁） */
  async function mutateAndRefresh(
    patch?: SnapshotPatch,
    options?: { reselect?: boolean },
  ) {
    if (patch && snapshot.value) {
      patchSnapshot(patch);
    } else {
      await refreshFromDisk();
    }
    if (options?.reselect && selectedPath.value) {
      await selectFile(selectedPath.value);
    }
  }

  /** 创建新文件 */
  async function createFile(path: string, content = '') {
    await workspace.createFile(path, content);
    patchSnapshot({ type: 'addFile', path });
    await selectFile(path);
  }

  /** 创建新文件夹 */
  async function createFolder(path: string) {
    await workspace.mkdir(path);
    patchSnapshot({ type: 'addDirectory', path });
  }

  /** 重命名文件或文件夹 */
  async function renameEntry(from: string, to: string) {
    await workspace.rename(from, to);
    checkedPaths.value = checkedPaths.value.map((p) =>
      p === from ? to : p.startsWith(`${from}/`) ? p.replace(from, to) : p,
    );
    patchSnapshot({ type: 'rename', from, to });
    if (selectedPath.value === from || selectedPath.value?.startsWith(`${from}/`)) {
      const next =
        selectedPath.value === from
          ? to
          : selectedPath.value!.replace(from, to);
      await selectFile(next);
    }
  }

  /** 删除指定的文件或文件夹列表 */
  async function deletePaths(paths: string[]) {
    if (!paths.length) return;
    await workspace.deletePaths(paths);
    checkedPaths.value = checkedPaths.value.filter((p) => !paths.includes(p));
    if (
      selectedPath.value &&
      paths.some(
        (p) => selectedPath.value === p || selectedPath.value!.startsWith(`${p}/`),
      )
    ) {
      clearPreview();
    }
    patchSnapshot({ type: 'remove', paths });
  }

  /** 压缩选中的文件/文件夹 */
  async function compressChecked(paths: string[], outputPath: string) {
    await workspace.compress(paths, outputPath);
    checkedPaths.value = [];
    patchSnapshot({ type: 'addFile', path: outputPath });
  }

  /** 解压归档文件 */
  async function extractArchive(archivePath: string, targetDir = '') {
    const result = await workspace.extract(archivePath, targetDir);
    patchSnapshot({
      type: 'addFiles',
      paths: [...result.written, ...result.createdDirs],
    });
  }

  /** 更新预览草稿内容 */
  function updatePreviewDraft(content: string) {
    previewContent.value = content;
    previewDirty.value = content !== savedPreviewContentRef.value;
    if (previewKind.value === 'html') {
      htmlContentRef.value = content;
    }
  }

  /** 保存预览内容到磁盘 */
  async function savePreview() {
    if (!selectedPath.value || previewContent.value === null) return;
    await workspace.writeFile(selectedPath.value, previewContent.value);
    savedPreviewContentRef.value = previewContent.value;
    previewDirty.value = false;
    trackManualEdit(selectedPath.value);
  }

  /** 设置选中的文件路径列表 */
  function setCheckedPaths(paths: string[]) {
    checkedPaths.value = paths;
  }

  /** 更新最近工作空间的别名 */
  function updateRecentWorkspaceAlias(id: string, alias: string) {
    setRecentWorkspaceAlias(id, alias);
    syncRecentList();
  }

  return {
    snapshot,
    activeWorkspaceId,
    cottageConfig,
    recentWorkspaces,
    selectedPath,
    checkedPaths,
    previewKind,
    previewContent,
    previewObjectUrl,
    previewSpreadsheet,
    previewWordHtml,
    previewPresentationSlides,
    previewDirty,
    loading,
    restoring,
    treeVersion,
    openWorkspace,
    addWorkspaceToRecent,
    openRecentWorkspace,
    removeRecentWorkspace,
    closeWorkspace,
    refresh,
    refreshFromDisk,
    patchSnapshot,
    mutateAndRefresh,
    reloadCottageConfig,
    selectFile,
    setCheckedPaths,
    updateRecentWorkspaceAlias,
    createFile,
    createFolder,
    renameEntry,
    deletePaths,
    compressChecked,
    extractArchive,
    updatePreviewDraft,
    savePreview,
    clearPreview,
    openHtmlPreview,
    tryRestoreLastWorkspace,
    revokePreviewUrlOnUnmount: revokePreviewUrl,
  };
});

export { workspace };
