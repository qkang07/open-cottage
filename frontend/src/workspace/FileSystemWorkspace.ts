import { COTTAGE_DIR } from '../config/constants';
import { checkAborted, maybeYield } from '../util/yield';
import {
  buildZipBlob,
  parseZipEntries,
  resolveExtractTarget,
} from './archive';
import { buildTree } from './buildTree';
import {
  DEFAULT_LARGE_DIR_ENTRY_THRESHOLD,
  type DeferredDirInfo,
} from './deferredDirs';
import { getPreviewKind, type FilePreview } from './previewKind';
import {
  collectPathsUnderPrefixes,
  normalizePath,
  replacePathPrefix,
  splitPath,
} from './pathUtils';
import { explorerEntriesToTreeNodes } from './treeLazyLoad';
import {
  listDirectoryContentsInWorker,
  walkWorkspaceInWorker,
} from './snapshotWalkerHost';
import type { SnapshotPatch } from './snapshotPatch';
import {
  isTraverseSkippedDirName,
  pathHasTraverseSkippedSegment,
  resolveTraverseSkipIgnored,
} from './traverseIgnore';
import type { DirectorySizeResult, ExplorerEntry } from './explorerTypes';
import type { WorkspaceFileNode, WorkspaceSnapshot } from './types';
import { journalBeforeMutation } from '../plan/mutationJournal';
import {
  getVirtualWorkspaceUsage,
  isVirtualDirectoryHandle,
  openVirtualDirectoryHandle,
  subscribeVirtualWorkspaceUsage,
  VIRTUAL_WORKSPACE_ID,
} from './VirtualWorkspace';

export type EntryKind = 'file' | 'directory' | null;
export type WorkspaceKind = 'folder' | 'virtual';

/** 将 File System Access API 错误转为用户可读说明 */
export const formatWorkspaceFsError = (error: unknown): string => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : String(error);
  if (
    (error instanceof DOMException && error.name === 'NotFoundError') ||
    message.includes('could not be found at the time an operation was processed')
  ) {
    return '工作区无法访问（可能已被移动、重命名或删除），请关闭后重新打开';
  }
  if (
    (error instanceof DOMException && error.name === 'QuotaExceededError') ||
    message.toLowerCase().includes('quota')
  ) {
    return '浏览器存储空间不足，无法继续写入聊天工作区；请删除不需要的文件或清空工作区后重试';
  }
  return message;
};

export interface TraverseOptions {
  signal?: AbortSignal;
  /** 递归遍历时跳过 node_modules / .git（默认 true，处于忽略区内时为 false） */
  skipIgnoredDirs?: boolean;
  /** 列目录时是否读取每个文件的 size/modified（文件树懒加载默认 false） */
  includeFileMetadata?: boolean;
}

export class FileSystemWorkspace {
  #root: FileSystemDirectoryHandle | null = null;
  #kind: WorkspaceKind | null = null;
  #changeListeners = new Set<(patch: SnapshotPatch) => void>();
  #storageUsageListeners = new Set<(usageBytes: number) => void>();

  constructor() {
    subscribeVirtualWorkspaceUsage((workspaceId, usageBytes) => {
      if (workspaceId !== VIRTUAL_WORKSPACE_ID || this.#kind !== 'virtual') return;
      for (const listener of this.#storageUsageListeners) listener(usageBytes);
    });
  }

  /**
   * 订阅由工作区 API 成功完成的结构变更。
   *
   * Agent 工具会直接使用此类，而不会经过 Pinia store；因此不能只在 UI
   * 文件操作中更新快照。仅在写入器关闭或删除完成后才派发，避免失败操作
   * 把不存在的文件提前显示到文件树中。
   */
  onDidChange(listener: (patch: SnapshotPatch) => void): () => void {
    this.#changeListeners.add(listener);
    return () => this.#changeListeners.delete(listener);
  }

  onDidStorageUsageChange(listener: (usageBytes: number) => void): () => void {
    this.#storageUsageListeners.add(listener);
    return () => this.#storageUsageListeners.delete(listener);
  }

  #emitChange(patch: SnapshotPatch) {
    for (const listener of this.#changeListeners) {
      try {
        listener(patch);
      } catch (error) {
        // UI 同步失败不能把已完成的磁盘写入误报为工具执行失败。
        console.error('工作区变更通知处理失败', error);
      }
    }
  }

  get isOpen() {
    return this.#root !== null;
  }

  get kind(): WorkspaceKind | null {
    return this.#kind;
  }

  get supportsHandleWorkers(): boolean {
    return this.#kind === 'folder';
  }

  get rootHandle() {
    return this.#root;
  }

  get rootName() {
    return this.#root?.name ?? null;
  }

  async ensurePermission(handle: FileSystemDirectoryHandle = this.#requireRoot()) {
    const descriptor = { mode: 'readwrite' as const };
    const current = await handle.queryPermission(descriptor);
    if (current === 'granted') return true;
    const requested = await handle.requestPermission(descriptor);
    return requested === 'granted';
  }

  async attachDirectory(handle: FileSystemDirectoryHandle) {
    this.#root = handle;
    this.#kind = isVirtualDirectoryHandle(handle) ? 'virtual' : 'folder';
    await this.ensureCottageDir();
    return handle.name;
  }

  async openVirtualWorkspace() {
    const root = await openVirtualDirectoryHandle();
    await this.attachDirectory(root);
    return root;
  }

  async openDirectory() {
    const root = await this.pickDirectory();
    await this.attachDirectory(root);
    return root;
  }

  async pickDirectory() {
    if (!('showDirectoryPicker' in window)) {
      throw new Error('当前浏览器不支持 File System Access API');
    }
    return window.showDirectoryPicker({ mode: 'readwrite' });
  }

  async restoreDirectory(handle: FileSystemDirectoryHandle) {
    const granted = await this.ensurePermission(handle);
    if (!granted) {
      throw new Error('需要授权才能访问该文件夹');
    }
    await this.attachDirectory(handle);
    return handle.name;
  }

  close() {
    this.#root = null;
    this.#kind = null;
  }

  async getStorageUsage(): Promise<number | null> {
    return this.#kind === 'virtual' ? getVirtualWorkspaceUsage() : null;
  }

  async ensureCottageDir() {
    const root = this.#requireRoot();
    return root.getDirectoryHandle(COTTAGE_DIR, { create: true });
  }

  async readCottageJson<T>(filename: string): Promise<T | null> {
    try {
      const root = this.#requireRoot();
      const dir = await root.getDirectoryHandle(COTTAGE_DIR);
      const fileHandle = await dir.getFileHandle(filename);
      const file = await fileHandle.getFile();
      const text = await file.text();
      if (!text.trim()) return null;
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }

  async writeCottageJson(filename: string, data: unknown) {
    await this.writeCottagePath(filename, data);
  }

  async readCottagePath<T>(relativePath: string): Promise<T | null> {
    try {
      const text = await this.readCottageText(relativePath);
      if (!text?.trim()) return null;
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }

  async readCottageText(relativePath: string): Promise<string | null> {
    try {
      const fileHandle = await this.#resolveCottageFile(relativePath, false);
      if (!fileHandle) return null;
      const file = await fileHandle.getFile();
      return await file.text();
    } catch {
      return null;
    }
  }

  async writeCottagePath(relativePath: string, data: unknown) {
    const text =
      typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    await this.writeCottageText(relativePath, text);
  }

  async writeCottageText(relativePath: string, text: string) {
    const normalized = normalizePath(relativePath);
    const parts = splitPath(normalized);
    const fileName = parts.pop();
    if (!fileName) throw new Error('无效的 .cottage 路径');

    const dir =
      parts.length === 0
        ? await this.ensureCottageDir()
        : await this.#resolveDirectoryUnder(
            await this.ensureCottageDir(),
            parts.join('/'),
            true,
          );
    if (!dir) throw new Error('无法写入 .cottage 路径');

    const fileHandle = await dir.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(text);
    await writable.close();
  }

  /** 以追加方式写入 .cottage 下的文本文件（保留已有内容，写到末尾）。 */
  async appendCottageText(relativePath: string, text: string) {
    const normalized = normalizePath(relativePath);
    const parts = splitPath(normalized);
    const fileName = parts.pop();
    if (!fileName) throw new Error('无效的 .cottage 路径');

    const dir =
      parts.length === 0
        ? await this.ensureCottageDir()
        : await this.#resolveDirectoryUnder(
            await this.ensureCottageDir(),
            parts.join('/'),
            true,
          );
    if (!dir) throw new Error('无法写入 .cottage 路径');

    const fileHandle = await dir.getFileHandle(fileName, { create: true });
    const existing = fileHandle.getFile ? await fileHandle.getFile() : null;
    const writable = await fileHandle.createWritable({ keepExistingData: true });
    if (existing) {
      await writable.seek(existing.size);
    }
    await writable.write(text);
    await writable.close();
  }

  /** 列出 .cottage 目录下相对路径的文件（递归） */
  async listCottageFiles(relativePrefix = ''): Promise<string[]> {
    const cottage = await this.ensureCottageDir();
    const base = normalizePath(relativePrefix);
    const entries: string[] = [];

    const walk = async (
      dir: FileSystemDirectoryHandle,
      currentPrefix: string,
    ) => {
      for await (const [name, handle] of dir.entries()) {
        const path = currentPrefix ? `${currentPrefix}/${name}` : name;
        if (handle.kind === 'directory') {
          await walk(handle as FileSystemDirectoryHandle, path);
        } else {
          entries.push(path);
        }
      }
    };

    if (!base) {
      await walk(cottage, '');
    } else {
      const sub = await this.#resolveDirectoryUnder(cottage, base, false);
      if (sub) await walk(sub, base);
    }

    return entries.sort();
  }

  async exists(path: string): Promise<boolean> {
    const kind = await this.getEntryKind(path);
    return kind === 'file' || kind === 'directory';
  }

  async #resolveCottageFile(
    relativePath: string,
    create: boolean,
  ): Promise<FileSystemFileHandle | null> {
    const normalized = normalizePath(relativePath);
    const parts = splitPath(normalized);
    const fileName = parts.pop();
    if (!fileName) return null;

    const dir =
      parts.length === 0
        ? await this.ensureCottageDir()
        : await this.#resolveDirectoryUnder(
            await this.ensureCottageDir(),
            parts.join('/'),
            create,
          );
    if (!dir) return null;

    try {
      return await dir.getFileHandle(fileName, create ? { create: true } : undefined);
    } catch {
      return null;
    }
  }

  async #resolveDirectoryUnder(
    root: FileSystemDirectoryHandle,
    path: string,
    create: boolean,
  ): Promise<FileSystemDirectoryHandle | null> {
    const normalized = normalizePath(path);
    if (!normalized) return root;

    let current = root;
    for (const part of splitPath(normalized)) {
      try {
        current = await current.getDirectoryHandle(part, create ? { create: true } : undefined);
      } catch {
        return null;
      }
    }
    return current;
  }

  async snapshot(options?: TraverseOptions): Promise<WorkspaceSnapshot | null> {
    if (!this.#root) return null;
    const rootHandle = this.#root;
    const rootName = this.#root.name;
    // 遍历 IO 走 Web Worker，避免主线程被 File System Access API 占满；
    // Worker 不可用时 host 内部自动回退主线程（带 maybeYield）
    const walkOptions = {
      signal: options?.signal,
      skipIgnoredDirs: options?.skipIgnoredDirs,
    };
    const { files, directories, deferredDirs } = this.supportsHandleWorkers
      ? await walkWorkspaceInWorker(rootHandle, rootName, walkOptions)
      : await this.#walkWorkspace('', walkOptions);
    return {
      rootName,
      files,
      directories,
      tree: buildTree(files, directories, deferredDirs),
      deferredDirs,
    };
  }

  async #walkWorkspace(
    prefix = '',
    options?: TraverseOptions,
  ): Promise<{
    files: string[];
    directories: string[];
    deferredDirs: Record<string, DeferredDirInfo>;
  }> {
    const root = this.#requireRoot();
    const base = normalizePath(prefix);
    const skipIgnored = resolveTraverseSkipIgnored(base, options?.skipIgnoredDirs);
    const files: string[] = [];
    const directories: string[] = [];
    const deferredDirs: Record<string, DeferredDirInfo> = {};

    const walk = async (
      dir: FileSystemDirectoryHandle,
      currentPrefix: string,
    ) => {
      const childEntries: Array<[string, FileSystemHandle]> = [];
      let collectIteration = 0;
      for await (const entry of dir.entries()) {
        checkAborted(options?.signal);
        collectIteration += 1;
        await maybeYield(collectIteration);
        childEntries.push(entry);
      }

      const entryCount = childEntries.length;
      const isRoot = !currentPrefix;
      const dirName = currentPrefix
        ? currentPrefix.split('/').pop() ?? ''
        : this.#root?.name ?? '';

      // 单层条目超阈值：标记为 large 并停止递归（已在忽略区内或根目录时除外，
      // 忽略区内的子目录已通过 skipIgnored 机制单独处理；根目录不延迟）。
      const isLargeDir =
        !isRoot &&
        !pathHasTraverseSkippedSegment(currentPrefix) &&
        entryCount > DEFAULT_LARGE_DIR_ENTRY_THRESHOLD;
      if (isLargeDir && dirName && !deferredDirs[currentPrefix]) {
        deferredDirs[currentPrefix] = { reason: 'large', entryCount };
      }

      if (isLargeDir) {
        // 大目录：不展开其子条目，等用户在文件树/资源管理器中展开时再懒加载
        return;
      }

      let walkIteration = 0;
      for (const [name, handle] of childEntries) {
        walkIteration += 1;
        await maybeYield(walkIteration);
        if (name.startsWith('.')) continue;
        const path = currentPrefix ? `${currentPrefix}/${name}` : name;

        if (handle.kind === 'directory') {
          directories.push(path);
          const skipSubtree = skipIgnored && isTraverseSkippedDirName(name);
          if (skipSubtree) {
            deferredDirs[path] = { reason: 'ignored' };
            continue;
          }
          await walk(handle as FileSystemDirectoryHandle, path);
          continue;
        }

        files.push(path);
      }
    };

    if (!base) {
      await walk(root, '');
    } else {
      const dir = await this.#resolveDirectory(base, false);
      if (dir) await walk(dir, base);
    }

    return {
      files: files.sort(),
      directories: directories.sort(),
      deferredDirs,
    };
  }

  async listFiles(prefix = '', options?: TraverseOptions): Promise<string[]> {
    const { files } = await this.#walkWorkspace(prefix, options);
    return files;
  }

  async listDirectoryContents(
    dirPath = '',
    options?: Pick<TraverseOptions, 'signal' | 'includeFileMetadata'>,
  ): Promise<ExplorerEntry[]> {
    if (!this.#root) return [];
    const workerOptions = {
      signal: options?.signal,
      includeFileMetadata: options?.includeFileMetadata,
    };
    if (this.supportsHandleWorkers) {
      return listDirectoryContentsInWorker(this.#root, dirPath, workerOptions);
    }
    const { listDirectoryContentsCore } = await import('./listDirectoryContentsCore');
    return listDirectoryContentsCore(this.#root, dirPath, workerOptions);
  }

  /** 文件树懒加载：列出单层子节点（用户展开 node_modules 等时使用） */
  async listTreeChildren(
    dirPath = '',
    options?: TraverseOptions,
  ): Promise<WorkspaceFileNode[]> {
    const entries = await this.listDirectoryContents(dirPath, {
      signal: options?.signal,
      includeFileMetadata: options?.includeFileMetadata ?? false,
    });
    return explorerEntriesToTreeNodes(entries);
  }

  /**
   * 递归统计文件夹内所有文件的总大小（跳过以 `.` 开头的条目）。
   * 用户手动触发时默认深入 node_modules / .git。
   */
  async getDirectorySize(
    dirPath = '',
    options?: {
      signal?: AbortSignal;
      onDirectorySized?: (path: string, result: DirectorySizeResult) => void;
      skipIgnoredDirs?: boolean;
    },
  ): Promise<DirectorySizeResult | null> {
    const base = normalizePath(dirPath);
    const dir = base
      ? await this.#resolveDirectory(base, false)
      : this.#requireRoot();
    if (!dir) return null;

    const skipIgnored = resolveTraverseSkipIgnored(
      base,
      options?.skipIgnoredDirs ?? false,
    );

    const compute = async (
      current: FileSystemDirectoryHandle,
      prefix: string,
    ): Promise<DirectorySizeResult> => {
      checkAborted(options?.signal);

      let totalBytes = 0;
      let fileCount = 0;
      let directoryCount = 0;

      let sizeIteration = 0;
      for await (const [name, handle] of current.entries()) {
        checkAborted(options?.signal);
        sizeIteration += 1;
        await maybeYield(sizeIteration);

        if (name.startsWith('.')) continue;
        const path = prefix ? `${prefix}/${name}` : name;
        if (handle.kind === 'directory') {
          directoryCount++;
          const skipSubtree = skipIgnored && isTraverseSkippedDirName(name);
          if (skipSubtree) {
            continue;
          }
          const sub = await compute(handle as FileSystemDirectoryHandle, path);
          totalBytes += sub.totalBytes;
          fileCount += sub.fileCount;
          directoryCount += sub.directoryCount;
        } else {
          fileCount++;
          const file = await (handle as FileSystemFileHandle).getFile();
          totalBytes += file.size;
        }
      }

      const result = { totalBytes, fileCount, directoryCount };
      options?.onDirectorySized?.(prefix, result);
      return result;
    };

    return compute(dir, base);
  }

  async listDirectories(
    prefix = '',
    options?: TraverseOptions,
  ): Promise<string[]> {
    const { directories } = await this.#walkWorkspace(prefix, options);
    return directories;
  }

  async getEntryKind(path: string): Promise<EntryKind> {
    const normalized = normalizePath(path);
    if (!normalized) return null;

    const parts = splitPath(normalized);
    const name = parts.pop();
    if (!name) return null;

    const parentPath = parts.join('/');
    const parent = parentPath
      ? await this.#resolveDirectory(parentPath, false)
      : this.#requireRoot();
    if (!parent) return null;

    try {
      await parent.getFileHandle(name);
      return 'file';
    } catch {
      // continue
    }

    try {
      await parent.getDirectoryHandle(name);
      return 'directory';
    } catch {
      // continue
    }

    try {
      const files = await this.listFiles(normalized, {
        skipIgnoredDirs: !pathHasTraverseSkippedSegment(normalized),
      });
      if (files.some((f) => f === normalized || f.startsWith(`${normalized}/`))) {
        return 'directory';
      }
    } catch {
      // 路径不存在或句柄失效
    }

    return null;
  }

  async createFile(path: string, content = '') {
    return this.writeFile(path, content);
  }

  async readFile(path: string): Promise<{ path: string; content: string }> {
    const fileHandle = await this.#resolveFile(path, false);
    if (!fileHandle) {
      return { path: normalizePath(path), content: '' };
    }
    const file = await fileHandle.getFile();
    const content = await file.text();
    return { path: normalizePath(path), content };
  }

  async readFileBytes(path: string): Promise<Uint8Array> {
    const fileHandle = await this.#resolveFile(path, false);
    if (!fileHandle) return new Uint8Array();
    const file = await fileHandle.getFile();
    return new Uint8Array(await file.arrayBuffer());
  }

  async statFile(
    path: string,
  ): Promise<{ size: number; modified: number } | null> {
    const fileHandle = await this.#resolveFile(path, false);
    if (!fileHandle) return null;
    const file = await fileHandle.getFile();
    return { size: file.size, modified: file.lastModified };
  }

  async readFileForPreview(path: string): Promise<FilePreview> {
    const normalized = normalizePath(path);
    const kind = getPreviewKind(normalized);

    if (kind === 'spreadsheet' || kind === 'word' || kind === 'presentation') {
      const { loadOfficeFilePreview } = await import('./officePreview');
      return loadOfficeFilePreview(normalized, kind);
    }

    const fileHandle = await this.#resolveFile(path, false);
    if (!fileHandle) {
      if (kind === 'image' || kind === 'video' || kind === 'pdf') {
        return { kind, objectUrl: '' };
      }
      return {
        kind:
          kind === 'markdown' ? 'markdown' : kind === 'html' ? 'html' : 'text',
        content: '',
      };
    }

    const file = await fileHandle.getFile();
    if (kind === 'image' || kind === 'video') {
      return { kind, objectUrl: URL.createObjectURL(file) };
    }
    if (kind === 'pdf') {
      // 显式声明 MIME，确保浏览器使用内置 PDF 阅读器渲染
      const blob = new Blob([await file.arrayBuffer()], {
        type: 'application/pdf',
      });
      return { kind, objectUrl: URL.createObjectURL(blob) };
    }

    const content = await file.text();
    if (kind === 'html') return { kind: 'html', content };
    if (kind === 'markdown') return { kind: 'markdown', content };
    return { kind: 'text', content };
  }

  async writeFile(path: string, content: string) {
    const normalized = normalizePath(path);
    await journalBeforeMutation(normalized);
    const parts = splitPath(normalized);
    const fileName = parts.pop();
    if (!fileName) throw new Error('无效的文件路径');

    const dir =
      parts.length === 0
        ? this.#requireRoot()
        : await this.#resolveDirectory(parts.join('/'), true);
    if (!dir) throw new Error(`无法创建目录: ${parts.join('/') || '/'}`);

    const fileHandle = await dir.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
    this.#emitChange({ type: 'addFile', path: normalized });
    return { path: normalized, written: true };
  }

  async writeFileBytes(path: string, data: Uint8Array | ArrayBuffer) {
    const normalized = normalizePath(path);
    await journalBeforeMutation(normalized);
    const parts = splitPath(normalized);
    const fileName = parts.pop();
    if (!fileName) throw new Error('无效的文件路径');

    const dir =
      parts.length === 0
        ? this.#requireRoot()
        : await this.#resolveDirectory(parts.join('/'), true);
    if (!dir) throw new Error(`无法创建目录: ${parts.join('/') || '/'}`);

    const fileHandle = await dir.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    await writable.write(bytes);
    await writable.close();
    this.#emitChange({ type: 'addFile', path: normalized });
    return { path: normalized, written: true };
  }

  async rename(from: string, to: string) {
    const fromPath = normalizePath(from);
    const toPath = normalizePath(to);
    await journalBeforeMutation(fromPath);
    await journalBeforeMutation(toPath);
    if (!fromPath || !toPath) throw new Error('路径不能为空');
    if (fromPath === toPath) return { from: fromPath, to: toPath, renamed: true };

    const kind = await this.getEntryKind(fromPath);
    if (kind === 'file') {
      const bytes = await this.readFileBytes(fromPath);
      await this.writeFileBytes(toPath, bytes);
      await this.deleteFile(fromPath);
      this.#emitChange({ type: 'rename', from: fromPath, to: toPath });
      return { from: fromPath, to: toPath, renamed: true };
    }

    if (kind === 'directory') {
      const handle = await this.#resolveDirectory(fromPath, false);
      if (!handle) throw new Error(`路径不存在: ${fromPath}`);
      await this.#renameDirectoryHandle(fromPath, toPath);
      this.#emitChange({ type: 'rename', from: fromPath, to: toPath });
      return { from: fromPath, to: toPath, renamed: true };
    }

    throw new Error(`路径不存在: ${fromPath}`);
  }

  /** 移动文件/目录（rename 的语义别名） */
  async move(from: string, to: string) {
    const result = await this.rename(from, to);
    return { from: result.from, to: result.to, moved: true };
  }

  /**
   * 复制文件或目录树到目标路径（不删除源）。
   * 文件用字节拷贝以支持二进制；目录递归拷贝其下所有文件。
   */
  async copy(from: string, to: string) {
    const fromPath = normalizePath(from);
    const toPath = normalizePath(to);
    if (!fromPath || !toPath) throw new Error('路径不能为空');
    if (fromPath === toPath) {
      throw new Error('源路径与目标路径相同');
    }
    if (toPath === fromPath || toPath.startsWith(`${fromPath}/`)) {
      throw new Error('不能复制到自身或其子目录');
    }

    const kind = await this.getEntryKind(fromPath);
    if (kind === 'file') {
      if (await this.exists(toPath)) {
        throw new Error(`目标已存在: ${toPath}`);
      }
      const bytes = await this.readFileBytes(fromPath);
      await this.writeFileBytes(toPath, bytes);
      return { from: fromPath, to: toPath, copied: true, kind: 'file' as const, fileCount: 1 };
    }

    if (kind === 'directory') {
      if (await this.exists(toPath)) {
        throw new Error(`目标已存在: ${toPath}`);
      }
      const needFullScan = pathHasTraverseSkippedSegment(fromPath);
      const allFiles = await this.listFiles(fromPath, {
        skipIgnoredDirs: !needFullScan,
      });
      // listFiles(prefix) 返回 prefix 下文件；若目录为空则仅建目录
      await this.mkdir(toPath);
      let fileCount = 0;
      for (const file of allFiles.sort(
        (a, b) => a.split('/').length - b.split('/').length,
      )) {
        const next = replacePathPrefix(file, fromPath, toPath);
        const bytes = await this.readFileBytes(file);
        await this.writeFileBytes(next, bytes);
        fileCount += 1;
      }
      return {
        from: fromPath,
        to: toPath,
        copied: true,
        kind: 'directory' as const,
        fileCount,
      };
    }

    throw new Error(`路径不存在: ${fromPath}`);
  }

  /** 批量复制：items 为 { from, to } 列表 */
  async copyPaths(items: readonly { from: string; to: string }[]) {
    if (!items.length) throw new Error('请指定要复制的路径');
    const results = [];
    for (const item of items) {
      results.push(await this.copy(item.from, item.to));
    }
    return { count: results.length, results };
  }

  /** 在文件末尾追加文本；文件不存在则创建 */
  async appendFile(path: string, content: string) {
    const normalized = normalizePath(path);
    const existing = (await this.exists(normalized))
      ? (await this.readFile(normalized)).content
      : '';
    const next =
      existing.length === 0
        ? content
        : existing.endsWith('\n') || content.startsWith('\n')
          ? existing + content
          : `${existing}\n${content}`;
    await this.writeFile(normalized, next);
    return {
      path: normalized,
      appended: true,
      created: existing.length === 0,
      length: next.length,
    };
  }

  async deleteFile(path: string) {
    const normalized = normalizePath(path);
    await journalBeforeMutation(normalized);
    const parts = splitPath(normalized);
    const fileName = parts.pop();
    if (!fileName) throw new Error('无效的文件路径');

    const parentPath = parts.join('/');
    const parent = parentPath
      ? await this.#resolveDirectory(parentPath, false)
      : this.#requireRoot();
    if (!parent) {
      return { path: normalized, deleted: false };
    }

    await parent.removeEntry(fileName);
    this.#emitChange({ type: 'remove', paths: [normalized] });
    return { path: normalized, deleted: true };
  }

  async deleteEntry(path: string) {
    const normalized = normalizePath(path);
    await journalBeforeMutation(normalized);
    if (!normalized) throw new Error('无效的路径');

    const kind = await this.getEntryKind(normalized);
    if (kind === 'file') {
      return this.deleteFile(normalized);
    }

    if (kind === 'directory') {
      const parts = splitPath(normalized);
      const name = parts.pop();
      if (!name) throw new Error('无效的路径');
      const parentPath = parts.join('/');
      const parent = parentPath
        ? await this.#resolveDirectory(parentPath, false)
        : this.#requireRoot();
      if (!parent) {
        return { path: normalized, deleted: false };
      }
      await parent.removeEntry(name, { recursive: true });
      this.#emitChange({ type: 'remove', paths: [normalized] });
      return { path: normalized, deleted: true };
    }

    return { path: normalized, deleted: false };
  }

  async deletePaths(paths: string[]) {
    const normalized = [...new Set(paths.map((p) => normalizePath(p)).filter(Boolean))];
    const needFullScan = normalized.some((p) => pathHasTraverseSkippedSegment(p));
    const allFiles = await this.listFiles('', { skipIgnoredDirs: !needFullScan });
    const fileTargets = new Set<string>();
    const dirTargets: string[] = [];

    for (const path of normalized) {
      const kind = await this.getEntryKind(path);
      if (kind === 'file') {
        fileTargets.add(path);
        continue;
      }
      if (kind === 'directory') {
        dirTargets.push(path);
        for (const file of allFiles) {
          if (file === path || file.startsWith(`${path}/`)) {
            fileTargets.add(file);
          }
        }
      }
    }

    const deletedFiles: string[] = [];
    for (const file of [...fileTargets].sort(
      (a, b) => b.split('/').length - a.split('/').length,
    )) {
      const result = await this.deleteFile(file);
      if (result.deleted) deletedFiles.push(file);
    }

    const deletedDirs: string[] = [];
    for (const dir of dirTargets.sort(
      (a, b) => b.split('/').length - a.split('/').length,
    )) {
      const result = await this.deleteEntry(dir);
      if (result.deleted) deletedDirs.push(dir);
    }

    return { deletedFiles, deletedDirs };
  }

  async mkdir(path: string) {
    const normalized = normalizePath(path);
    await journalBeforeMutation(normalized);
    await this.#resolveDirectory(normalized, true);
    this.#emitChange({ type: 'addDirectory', path: normalized });
    return { path: normalized, created: true };
  }

  async compress(paths: string[], outputPath: string) {
    const prefixes = paths.map((p) => normalizePath(p)).filter(Boolean);
    if (!prefixes.length) throw new Error('请指定要压缩的路径');

    const needFullScan = prefixes.some((p) => pathHasTraverseSkippedSegment(p));
    const allFiles = await this.listFiles('', { skipIgnoredDirs: !needFullScan });
    const filePaths = collectPathsUnderPrefixes(allFiles, prefixes);
    if (!filePaths.length) throw new Error('没有可压缩的文件');

    const entries: { path: string; data: Uint8Array }[] = [];
    for (const filePath of filePaths) {
      entries.push({
        path: filePath,
        data: await this.readFileBytes(filePath),
      });
    }

    const blob = await buildZipBlob(entries);
    const buffer = await blob.arrayBuffer();
    await this.writeFileBytes(outputPath, buffer);

    return {
      outputPath: normalizePath(outputPath),
      fileCount: filePaths.length,
      files: filePaths,
    };
  }

  async extract(archivePath: string, targetDir = '') {
    const normalizedArchive = normalizePath(archivePath);
    const bytes = await this.readFileBytes(normalizedArchive);
    if (!bytes.byteLength) throw new Error('压缩包为空或不存在');

    const entries = await parseZipEntries(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    );
    const base = normalizePath(targetDir);
    const written: string[] = [];
    const createdDirs: string[] = [];

    const sorted = [...entries].sort((a, b) => {
      if (a.isDirectory === b.isDirectory) return a.path.localeCompare(b.path);
      return a.isDirectory ? -1 : 1;
    });

    for (const entry of sorted) {
      const target = resolveExtractTarget(entry.path, base);
      if (entry.isDirectory) {
        await this.mkdir(target);
        createdDirs.push(target);
        continue;
      }
      await this.writeFileBytes(target, entry.data);
      written.push(target);
    }

    return {
      archivePath: normalizedArchive,
      targetDir: base,
      written,
      createdDirs,
    };
  }

  #requireRoot() {
    if (!this.#root) {
      throw new Error('请先选择工作区');
    }
    return this.#root;
  }

  async #renameDirectoryHandle(fromPath: string, toPath: string) {
    const needFullScan = pathHasTraverseSkippedSegment(fromPath);
    const allFiles = await this.listFiles('', { skipIgnoredDirs: !needFullScan });
    const affected = allFiles.filter(
      (f) => f === fromPath || f.startsWith(`${fromPath}/`),
    );
    if (!affected.length) {
      await this.mkdir(toPath);
      const parts = splitPath(fromPath);
      const name = parts.pop();
      if (!name) return;
      const parentPath = parts.join('/');
      const parent = parentPath
        ? await this.#resolveDirectory(parentPath, false)
        : this.#requireRoot();
      if (parent) {
        try {
          await parent.removeEntry(name, { recursive: true });
        } catch {
          // 空目录可能已不存在
        }
      }
      return;
    }

    const sorted = [...affected].sort((a, b) => a.split('/').length - b.split('/').length);
    for (const file of sorted) {
      const next = replacePathPrefix(file, fromPath, toPath);
      const bytes = await this.readFileBytes(file);
      await this.writeFileBytes(next, bytes);
    }

    for (const file of [...affected].sort(
      (a, b) => b.split('/').length - a.split('/').length,
    )) {
      await this.deleteFile(file);
    }

    const parts = splitPath(fromPath);
    const name = parts.pop();
    if (!name) return;
    const parentPath = parts.join('/');
    const parent = parentPath
      ? await this.#resolveDirectory(parentPath, false)
      : this.#requireRoot();
    if (!parent) return;
    try {
      await parent.removeEntry(name, { recursive: true });
    } catch {
      // 目录可能已被清空
    }
  }

  async #resolveDirectory(path: string, create: boolean) {
    const root = this.#requireRoot();
    const parts = splitPath(path);
    let current = root;

    try {
      for (const part of parts) {
        current = await current.getDirectoryHandle(part, { create });
      }
      return current;
    } catch {
      return null;
    }
  }

  async #resolveFile(path: string, create: boolean) {
    const normalized = normalizePath(path);
    const parts = splitPath(normalized);
    const fileName = parts.pop();
    if (!fileName) return null;

    const parentPath = parts.join('/');
    const parent = parentPath
      ? await this.#resolveDirectory(parentPath, create)
      : this.#requireRoot();
    if (!parent) return null;

    try {
      return await parent.getFileHandle(fileName, { create });
    } catch {
      return null;
    }
  }
}

export const workspace = new FileSystemWorkspace();
