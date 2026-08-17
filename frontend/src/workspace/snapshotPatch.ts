import { buildTree } from './buildTree';
import { deferredInfoForDirName, type DeferredDirInfo } from './deferredDirs';
import { isPathUnderPrefix, normalizePath, replacePathPrefix } from './pathUtils';
import type { WorkspaceFileNode } from './types';
import type { WorkspaceSnapshot } from './types';

export type SnapshotPatch =
  | { type: 'addFile'; path: string }
  | { type: 'addFiles'; paths: string[] }
  | { type: 'addDirectory'; path: string }
  | { type: 'addDirectories'; paths: string[] }
  | { type: 'remove'; paths: string[] }
  | { type: 'rename'; from: string; to: string };

function parentDirectories(path: string): string[] {
  const parts = normalizePath(path).split('/').filter(Boolean);
  const parents: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    parents.push(parts.slice(0, i).join('/'));
  }
  return parents;
}

/** 补全缺失的 directories（兼容旧 snapshot） */
export function normalizeSnapshot(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  if (snapshot.directories?.length) return snapshot;
  const dirs = new Set<string>();
  for (const file of snapshot.files) {
    for (const parent of parentDirectories(file)) {
      dirs.add(parent);
    }
  }
  for (const dir of Object.keys(snapshot.deferredDirs ?? {})) {
    dirs.add(dir);
  }
  return { ...snapshot, directories: [...dirs].sort() };
}

function mergeDirectories(existing: string[], paths: string[]): string[] {
  const set = new Set(existing);
  for (const path of paths) {
    const normalized = normalizePath(path);
    if (normalized) set.add(normalized);
    for (const parent of parentDirectories(normalized)) {
      set.add(parent);
    }
  }
  return [...set].sort();
}

function rebuild(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  return {
    ...snapshot,
    tree: buildTree(
      snapshot.files,
      snapshot.directories,
      snapshot.deferredDirs ?? {},
    ),
  };
}

const compareNodes = (a: WorkspaceFileNode, b: WorkspaceFileNode): number => {
  if (a.isLeaf === b.isLeaf) return a.title.localeCompare(b.title);
  return a.isLeaf ? 1 : -1;
};

function insertSorted(
  children: WorkspaceFileNode[],
  node: WorkspaceFileNode,
) {
  let lo = 0;
  let hi = children.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (compareNodes(children[mid], node) < 0) lo = mid + 1;
    else hi = mid;
  }
  children.splice(lo, 0, node);
}

function createDirNode(
  key: string,
  title: string,
  deferredDirs: Record<string, DeferredDirInfo>,
): WorkspaceFileNode {
  const info = deferredDirs[key] ?? deferredInfoForDirName(title) ?? undefined;
  if (info) {
    return {
      key,
      title,
      isLeaf: false,
      lazy: true,
      deferred: info.reason,
      deferredEntryCount: info.entryCount,
      children: [],
    };
  }
  return { key, title, isLeaf: false, children: [] };
}

/** 沿路径逐段 getOrCreate，返回末端节点；失败返回 null */
function getOrCreateByPath(
  tree: WorkspaceFileNode[],
  path: string,
  isLeaf: boolean,
  deferredDirs: Record<string, DeferredDirInfo>,
): WorkspaceFileNode | null {
  const parts = normalizePath(path).split('/').filter(Boolean);
  if (!parts.length) return null;
  let children = tree;
  let prefix = '';
  let node: WorkspaceFileNode | null = null;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    prefix = prefix ? `${prefix}/${part}` : part;
    const last = i === parts.length - 1;
    const leaf = last ? isLeaf : false;
    const existing = children.find((n) => n.title === part);
    if (existing) {
      node = existing;
      if (!leaf && node.isLeaf) {
        node.isLeaf = false;
        node.children = node.children ?? [];
      }
    } else {
      node = leaf
        ? { key: prefix, title: part, isLeaf: true }
        : createDirNode(prefix, part, deferredDirs);
      insertSorted(children, node);
    }
    if (!leaf) children = node.children!;
  }
  return node;
}

function removeByPath(tree: WorkspaceFileNode[], path: string): boolean {
  const parts = normalizePath(path).split('/').filter(Boolean);
  if (!parts.length) return false;
  let children = tree;
  for (let i = 0; i < parts.length; i++) {
    const idx = children.findIndex((n) => n.title === parts[i]);
    if (idx === -1) return false;
    const node = children[idx];
    if (i === parts.length - 1) {
      children.splice(idx, 1);
      return true;
    }
    if (!node.children) return false;
    children = node.children;
  }
  return false;
}

/**
 * 增量更新 tree，避免每次 patch 都全量 buildTree。
 * 返回新根数组引用（触发响应式 watch）；不支持的 patch 类型返回 null，调用方 fallback 到 rebuild。
 */
function patchTree(
  tree: WorkspaceFileNode[],
  patch: SnapshotPatch,
  deferredDirs: Record<string, DeferredDirInfo>,
): WorkspaceFileNode[] | null {
  const next = tree.slice();
  switch (patch.type) {
    case 'addFile':
      return getOrCreateByPath(next, patch.path, true, deferredDirs)
        ? next
        : null;
    case 'addFiles': {
      let ok = true;
      for (const p of patch.paths) {
        if (!getOrCreateByPath(next, p, true, deferredDirs)) ok = false;
      }
      return ok ? next : null;
    }
    case 'addDirectory':
      return getOrCreateByPath(next, patch.path, false, deferredDirs)
        ? next
        : null;
    case 'addDirectories': {
      let ok = true;
      for (const p of patch.paths) {
        if (!getOrCreateByPath(next, p, false, deferredDirs)) ok = false;
      }
      return ok ? next : null;
    }
    case 'remove': {
      for (const p of patch.paths) removeByPath(next, p);
      return next;
    }
    default:
      return null;
  }
}

function pruneDeferredDirs(
  deferredDirs: Record<string, DeferredDirInfo>,
  removedPrefixes: string[],
): Record<string, DeferredDirInfo> {
  if (!removedPrefixes.length) return deferredDirs;
  const next: Record<string, DeferredDirInfo> = {};
  for (const [path, info] of Object.entries(deferredDirs)) {
    if (removedPrefixes.some((prefix) => isPathUnderPrefix(path, prefix))) continue;
    next[path] = info;
  }
  return next;
}

function renameDeferredDirs(
  deferredDirs: Record<string, DeferredDirInfo>,
  from: string,
  to: string,
): Record<string, DeferredDirInfo> {
  const next: Record<string, DeferredDirInfo> = {};
  for (const [path, info] of Object.entries(deferredDirs)) {
    next[replacePathPrefix(path, from, to)] = info;
  }
  return next;
}

export function applySnapshotPatch(
  snapshot: WorkspaceSnapshot,
  patch: SnapshotPatch,
): WorkspaceSnapshot {
  const base = normalizeSnapshot(snapshot);
  switch (patch.type) {
    case 'addFile': {
      const path = normalizePath(patch.path);
      if (!path || base.files.includes(path)) return base;
      const nextBase: WorkspaceSnapshot = {
        ...base,
        files: [...base.files, path].sort(),
        directories: mergeDirectories(base.directories, [path]),
      };
      return applyTreePatch(base, nextBase, patch);
    }
    case 'addFiles': {
      const paths = [...new Set(patch.paths.map(normalizePath).filter(Boolean))];
      const newFiles = paths.filter((path) => !base.files.includes(path));
      if (!newFiles.length && paths.every((p) => base.directories.includes(p))) {
        return base;
      }
      const nextBase: WorkspaceSnapshot = {
        ...base,
        files: [...base.files, ...newFiles].sort(),
        directories: mergeDirectories(base.directories, paths),
      };
      return applyTreePatch(base, nextBase, patch);
    }
    case 'addDirectory': {
      const path = normalizePath(patch.path);
      if (!path) return base;
      const directories = mergeDirectories(base.directories, [path]);
      if (directories.length === base.directories.length) return base;
      const nextBase: WorkspaceSnapshot = { ...base, directories };
      return applyTreePatch(base, nextBase, patch);
    }
    case 'addDirectories': {
      const paths = patch.paths.map(normalizePath).filter(Boolean);
      const directories = mergeDirectories(base.directories, paths);
      if (directories.length === base.directories.length) return base;
      const nextBase: WorkspaceSnapshot = { ...base, directories };
      return applyTreePatch(base, nextBase, patch);
    }
    case 'remove': {
      const prefixes = [...new Set(patch.paths.map(normalizePath).filter(Boolean))];
      if (!prefixes.length) return base;

      const files = base.files.filter(
        (file) => !prefixes.some((prefix) => isPathUnderPrefix(file, prefix)),
      );
      const directories = base.directories.filter(
        (dir) =>
          !prefixes.some(
            (prefix) => dir === prefix || isPathUnderPrefix(dir, prefix),
          ),
      );
      const deferredDirs = pruneDeferredDirs(base.deferredDirs ?? {}, prefixes);

      const nextBase: WorkspaceSnapshot = {
        ...base,
        files,
        directories,
        deferredDirs,
      };
      return applyTreePatch(base, nextBase, patch);
    }
    case 'rename': {
      const from = normalizePath(patch.from);
      const to = normalizePath(patch.to);
      if (!from || !to || from === to) return base;

      const files = [
        ...new Set(base.files.map((file) => replacePathPrefix(file, from, to))),
      ].sort();
      const directories = [
        ...new Set(base.directories.map((dir) => replacePathPrefix(dir, from, to))),
      ].sort();
      const deferredDirs = renameDeferredDirs(base.deferredDirs ?? {}, from, to);

      // rename 涉及子树 rekey 与跨目录移动，走全量 rebuild 保证正确性
      return rebuild({ ...base, files, directories, deferredDirs });
    }
    default:
      return base;
  }
}

/** 优先增量更新 tree，失败时 fallback 到全量 rebuild */
function applyTreePatch(
  base: WorkspaceSnapshot,
  nextBase: WorkspaceSnapshot,
  patch: SnapshotPatch,
): WorkspaceSnapshot {
  const deferredDirs = nextBase.deferredDirs ?? {};
  const patched = patchTree(base.tree, patch, deferredDirs);
  if (patched) return { ...nextBase, tree: patched };
  return rebuild(nextBase);
}
