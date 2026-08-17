/**
 * 主线程全局目录子节点缓存：由 Crawler Worker（后台全量预加载）与
 * Responder Worker（即时 listDir 未命中回填）共同写入，loadTreeNode 读取。
 * 作为两个 Worker 之间的「共享文件系统信息」single source of truth。
 */

import type { WorkspaceFileNode } from './types';

const cache = new Map<string, WorkspaceFileNode[]>();

export function hasDirChildren(path: string): boolean {
  return cache.has(path);
}

export function getDirChildren(path: string): WorkspaceFileNode[] | undefined {
  return cache.get(path);
}

export function setDirChildren(
  path: string,
  children: WorkspaceFileNode[],
): void {
  // 进入缓存意味着该目录已有数据，子目录节点不再需要 deferred 警告标记
  const cleaned = children.map((node) =>
    node.isLeaf
      ? node
      : { ...node, deferred: undefined, deferredEntryCount: undefined },
  );
  cache.set(path, cleaned);
}

export function clearDirChildrenCache(): void {
  cache.clear();
}

export function getDirChildrenCacheStats(): {
  directoryCount: number;
  entryCount: number;
} {
  let entryCount = 0;
  for (const children of cache.values()) {
    entryCount += children.length;
  }
  return {
    directoryCount: cache.size,
    entryCount,
  };
}
