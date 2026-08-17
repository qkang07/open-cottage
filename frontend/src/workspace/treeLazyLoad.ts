import type { DeferredDirInfo } from './deferredDirs';
import { deferredInfoForDirName } from './deferredDirs';
import type { WorkspaceFileNode } from './types';

function applyDeferredToNode(
  node: WorkspaceFileNode,
  info: DeferredDirInfo,
): WorkspaceFileNode {
  return {
    ...node,
    isLeaf: false,
    lazy: true,
    deferred: info.reason,
    deferredEntryCount: info.entryCount,
    children: node.children?.length ? node.children : [],
  };
}

/** 为 snapshot 树中延迟目录标记 lazy 与 deferred */
export function markDeferredTreeNodes(
  nodes: WorkspaceFileNode[],
  deferredDirs: Record<string, DeferredDirInfo> = {},
): WorkspaceFileNode[] {
  return nodes.map((node) => {
    if (node.isLeaf) return node;

    const children = node.children?.length
      ? markDeferredTreeNodes(node.children, deferredDirs)
      : node.children;

    const info =
      deferredDirs[node.key] ??
      deferredInfoForDirName(node.title) ??
      undefined;

    if (!info) {
      // 子节点可能因递归标记而产生新数组；仅在与原引用不同时才新建节点对象
      return children === node.children
        ? node
        : { ...node, children };
    }

    return applyDeferredToNode({ ...node, children }, info);
  });
}

/** 将懒加载得到的子节点合并进树（按 path key） */
export function injectTreeChildren(
  nodes: WorkspaceFileNode[],
  targetPath: string,
  children: WorkspaceFileNode[],
): WorkspaceFileNode[] {
  return nodes.map((node) => {
    if (node.key === targetPath) {
      return {
        ...node,
        lazy: false,
        deferred: undefined,
        deferredEntryCount: undefined,
        children: children.length ? children : undefined,
        isLeaf: false,
      };
    }
    if (!node.children?.length) return node;
    return {
      ...node,
      children: injectTreeChildren(node.children, targetPath, children),
    };
  });
}

export function explorerEntriesToTreeNodes(
  entries: Array<{
    name: string;
    path: string;
    kind: 'file' | 'directory';
    deferred?: DeferredDirInfo['reason'];
    deferredEntryCount?: number;
  }>,
): WorkspaceFileNode[] {
  return entries.map((entry) => {
    if (entry.kind === 'file') {
      return {
        key: entry.path,
        title: entry.name,
        isLeaf: true,
      };
    }

    const info =
      entry.deferred != null
        ? {
            reason: entry.deferred,
            entryCount: entry.deferredEntryCount,
          }
        : deferredInfoForDirName(entry.name);

    if (info) {
      return applyDeferredToNode(
        {
          key: entry.path,
          title: entry.name,
          isLeaf: false,
        },
        info,
      );
    }

    return {
      key: entry.path,
      title: entry.name,
      isLeaf: false,
    };
  });
}

/** 兼容 buildTree 旧调用 */
export const markTraverseSkippedLazyNodes = (
  nodes: WorkspaceFileNode[],
  deferredDirs: Record<string, DeferredDirInfo> = {},
): WorkspaceFileNode[] => markDeferredTreeNodes(nodes, deferredDirs);
