/**
 * 工作空间递归遍历的纯函数实现：主线程与 Web Worker 共用同一份逻辑。
 * 把遍历 IO（File System Access API）从主线程移到 Worker，避免阻塞 UI。
 */

import { checkAborted } from '../util/yield';
import {
  DEFAULT_LARGE_DIR_ENTRY_THRESHOLD,
  type DeferredDirInfo,
} from './deferredDirs';
import { normalizePath } from './pathUtils';
import {
  isTraverseSkippedDirName,
  pathHasTraverseSkippedSegment,
  resolveTraverseSkipIgnored,
} from './traverseIgnore';

export interface WalkOptions {
  signal?: AbortSignal;
  /** 递归遍历时跳过 node_modules / .git（默认 true，处于忽略区内时为 false） */
  skipIgnoredDirs?: boolean;
  /** 每次迭代后的让出回调（主线程传 maybeYield 让出 UI；Worker 传 null 全速跑） */
  yieldFn?: (iteration: number) => Promise<void> | void;
}

export interface WalkResult {
  files: string[];
  directories: string[];
  deferredDirs: Record<string, DeferredDirInfo>;
}

/**
 * 从给定根目录递归遍历工作空间，收集 files / directories / deferredDirs。
 * 与 FileSystemWorkspace.#walkWorkspace 行为一致，但不依赖实例状态。
 */
export async function walkWorkspaceCore(
  root: FileSystemDirectoryHandle,
  rootName: string,
  options: WalkOptions = {},
): Promise<WalkResult> {
  const base = normalizePath('');
  const skipIgnored = resolveTraverseSkipIgnored(base, options.skipIgnoredDirs);
  const files: string[] = [];
  const directories: string[] = [];
  const deferredDirs: Record<string, DeferredDirInfo> = {};
  const yieldFn = options.yieldFn;

  const walk = async (
    dir: FileSystemDirectoryHandle,
    currentPrefix: string,
  ) => {
    const childEntries: Array<[string, FileSystemHandle]> = [];
    let collectIteration = 0;
    for await (const entry of dir.entries()) {
      checkAborted(options.signal);
      collectIteration += 1;
      if (yieldFn) await yieldFn(collectIteration);
      childEntries.push(entry);
    }

    const entryCount = childEntries.length;
    const isRoot = !currentPrefix;
    const dirName = currentPrefix
      ? (currentPrefix.split('/').pop() ?? '')
      : rootName;

    // 单层条目超阈值：标记为 large 并停止递归（根目录不延迟）
    const isLargeDir =
      !isRoot &&
      !pathHasTraverseSkippedSegment(currentPrefix) &&
      entryCount > DEFAULT_LARGE_DIR_ENTRY_THRESHOLD;
    if (isLargeDir && dirName && !deferredDirs[currentPrefix]) {
      deferredDirs[currentPrefix] = { reason: 'large', entryCount };
    }
    if (isLargeDir) return;

    let walkIteration = 0;
    for (const [name, handle] of childEntries) {
      walkIteration += 1;
      if (yieldFn) await yieldFn(walkIteration);
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

  await walk(root, '');

  return {
    files: files.sort(),
    directories: directories.sort(),
    deferredDirs,
  };
}
