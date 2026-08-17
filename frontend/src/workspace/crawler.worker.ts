/**
 * Crawler Worker：后台预加载工作区目录树到主线程 dirChildrenCache。
 * - 与 Snapshot 一致：不递归进入 node_modules / .git，过大目录只缓存一层
 * - 结果按「目录数」或「时间」批量 postMessage，降低主线程消息风暴
 */

import { DEFAULT_LARGE_DIR_ENTRY_THRESHOLD } from './deferredDirs';
import { isTraverseSkippedDirName } from './traverseIgnore';
import type { WorkspaceFileNode } from './types';

/** 累计多少个目录结果后立即抛出一批 */
const BATCH_DIR_LIMIT = 32;
/** 距上次抛出超过该毫秒数则抛出一批（有积压时） */
const BATCH_TIME_MS = 80;

let rootHandle: FileSystemDirectoryHandle | null = null;
let crawling = false;

interface DirBatchItem {
  path: string;
  children: WorkspaceFileNode[];
}

let batch: DirBatchItem[] = [];
let lastFlushAt = 0;

self.onmessage = (event: MessageEvent<unknown>) => {
  const message = event.data as
    | { type: 'init'; rootHandle: FileSystemDirectoryHandle }
    | { kind: 'start' };

  if (message && 'type' in message && message.type === 'init') {
    rootHandle = message.rootHandle;
    self.postMessage({ kind: 'init', init: 'done' });
    return;
  }

  if (message && 'kind' in message && message.kind === 'start') {
    if (!crawling) {
      crawling = true;
      void crawl();
    }
  }
};

function flushBatch(force = false): void {
  if (!batch.length) return;
  const elapsed = performance.now() - lastFlushAt;
  if (!force && batch.length < BATCH_DIR_LIMIT && elapsed < BATCH_TIME_MS) {
    return;
  }
  self.postMessage({ kind: 'dirsLoaded', dirs: batch });
  batch = [];
  lastFlushAt = performance.now();
}

function enqueueDir(path: string, children: WorkspaceFileNode[]): void {
  batch.push({ path, children });
  flushBatch(false);
}

async function crawl(): Promise<void> {
  if (!rootHandle) return;
  batch = [];
  lastFlushAt = performance.now();
  try {
    await crawlDir(rootHandle, '');
    flushBatch(true);
    self.postMessage({ kind: 'crawlDone' });
  } catch (error) {
    flushBatch(true);
    self.postMessage({
      kind: 'crawlDone',
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    crawling = false;
  }
}

async function crawlDir(
  dir: FileSystemDirectoryHandle,
  prefix: string,
): Promise<void> {
  if (!crawling) return;

  const children: WorkspaceFileNode[] = [];
  let entryIteration = 0;
  for await (const [name, handle] of dir.entries()) {
    if (!crawling) return;
    entryIteration += 1;
    // 枚举过程也可能拖很久：达到时间上限时先抛出已积压批次
    if (entryIteration % 64 === 0) flushBatch(false);
    if (name.startsWith('.')) continue;
    const path = prefix ? `${prefix}/${name}` : name;
    children.push(
      handle.kind === 'file'
        ? { key: path, title: name, isLeaf: true }
        : { key: path, title: name, isLeaf: false },
    );
  }

  // 与 buildTree 排序一致：文件夹在前，文件在后，同类型按名称
  children.sort((a, b) =>
    a.isLeaf === b.isLeaf
      ? a.title.localeCompare(b.title)
      : a.isLeaf
        ? 1
        : -1,
  );

  enqueueDir(prefix, children);

  const isRoot = !prefix;
  if (
    !isRoot &&
    children.length > DEFAULT_LARGE_DIR_ENTRY_THRESHOLD
  ) {
    // 过大目录：已缓存本层子节点，不再向下递归
    return;
  }

  for (const child of children) {
    if (!crawling) return;
    if (child.isLeaf) continue;
    // 与 Snapshot 一致：不递归预加载 node_modules / .git
    if (isTraverseSkippedDirName(child.title)) continue;
    try {
      const sub = await dir.getDirectoryHandle(child.title);
      await crawlDir(sub, child.key);
    } catch {
      // 子目录可能已被删除，跳过
    }
  }
}
