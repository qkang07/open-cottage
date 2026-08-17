import { markTraverseSkippedLazyNodes } from './treeLazyLoad';
import type { DeferredDirInfo } from './deferredDirs';
import type { WorkspaceFileNode } from './types';

export const buildTree = (
  files: string[],
  directories: string[] = [],
  deferredDirs: Record<string, DeferredDirInfo> = {},
): WorkspaceFileNode[] => {
  const root: WorkspaceFileNode[] = [];
  // 按 key（完整路径）索引节点，避免每层 children 数组线性 find
  const byKey = new Map<string, WorkspaceFileNode>();

  const getOrCreate = (
    parentChildren: WorkspaceFileNode[],
    title: string,
    key: string,
    isLeaf: boolean,
  ): WorkspaceFileNode => {
    let node = byKey.get(key);
    if (!node) {
      node = { key, title, isLeaf, children: isLeaf ? undefined : [] };
      byKey.set(key, node);
      parentChildren.push(node);
    } else if (!isLeaf && !node.children) {
      node.children = [];
      node.isLeaf = false;
    }
    return node;
  };

  const allPaths = [
    ...directories.map((path) => ({ path, isLeaf: false })),
    ...files.map((path) => ({ path, isLeaf: true })),
  ];

  for (const entry of allPaths) {
    const parts = entry.path.split('/').filter(Boolean);
    let currentChildren = root;
    let prefix = '';
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      prefix = prefix ? `${prefix}/${part}` : part;
      const isLeaf = index === parts.length - 1 ? entry.isLeaf : false;
      const node = getOrCreate(currentChildren, part, prefix, isLeaf);
      if (!isLeaf) {
        currentChildren = node.children!;
      }
    }
  }

  // 原地排序，避免对每个节点做 `...node` 展开产生大量临时对象
  const sortNodes = (nodes: WorkspaceFileNode[]): WorkspaceFileNode[] => {
    for (const node of nodes) {
      if (node.children) sortNodes(node.children);
    }
    nodes.sort((a, b) => {
      if (a.isLeaf === b.isLeaf) return a.title.localeCompare(b.title);
      return a.isLeaf ? 1 : -1;
    });
    return nodes;
  };

  return markTraverseSkippedLazyNodes(sortNodes(root), deferredDirs);
};
