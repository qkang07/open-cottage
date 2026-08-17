/**
 * 轻量 Merkle 目录树：聚合文件内容哈希，用于全量建库时跳过未变更子树的内容读取。
 */

import { hashContent } from './chunker';
import type { IndexedFileEntry } from './types';

export const MERKLE_VERSION = 1;

export interface MerkleSnapshot {
  version: typeof MERKLE_VERSION;
  root: string;
  /** 目录路径（'' = 工作区根）→ 子树聚合哈希 */
  dirs: Record<string, string>;
}

export const parentDir = (filePath: string): string => {
  const idx = filePath.lastIndexOf('/');
  return idx >= 0 ? filePath.slice(0, idx) : '';
};

export const isInDir = (filePath: string, dir: string): boolean => {
  if (dir === '') return true;
  return filePath.startsWith(`${dir}/`);
};

export const collectAllDirs = (paths: string[]): string[] => {
  const dirs = new Set<string>(['']);
  for (const path of paths) {
    let dir = parentDir(path);
    while (true) {
      dirs.add(dir);
      if (!dir) break;
      dir = parentDir(dir);
    }
  }
  return [...dirs].sort(
    (a, b) =>
      b.split('/').filter(Boolean).length - a.split('/').filter(Boolean).length,
  );
};

export const directChildDirs = (parent: string, allDirs: Set<string>): string[] => {
  const result: string[] = [];
  for (const d of allDirs) {
    if (d === parent) continue;
    if (parent === '') {
      if (d && !d.includes('/')) result.push(d);
    } else if (d.startsWith(`${parent}/`)) {
      const rest = d.slice(parent.length + 1);
      if (rest && !rest.includes('/')) result.push(d);
    }
  }
  return result.sort();
};

const hashMerkleNode = async (labels: string[]): Promise<string> => {
  if (labels.length === 0) return hashContent('');
  const sorted = [...labels].sort();
  return hashContent(sorted.join('\n'));
};

const groupFilesByDir = (paths: string[]): Map<string, string[]> => {
  const map = new Map<string, string[]>();
  for (const path of paths) {
    const dir = parentDir(path);
    if (!map.has(dir)) map.set(dir, []);
    map.get(dir)!.push(path);
  }
  return map;
};

/** 自底向上构建目录 Merkle 快照 */
export const buildMerkleSnapshot = async (
  filePaths: string[],
  fileHashes: Record<string, string>,
): Promise<MerkleSnapshot> => {
  const dirs = collectAllDirs(filePaths);
  const dirSet = new Set(dirs);
  const filesByDir = groupFilesByDir(filePaths);
  const dirHashes: Record<string, string> = {};

  for (const dir of dirs) {
    const labels: string[] = [];
    for (const file of filesByDir.get(dir) ?? []) {
      const hash = fileHashes[file];
      if (hash) labels.push(`f:${file}\0${hash}`);
    }
    for (const child of directChildDirs(dir, dirSet)) {
      const childHash = dirHashes[child];
      if (childHash) labels.push(`d:${child}\0${childHash}`);
    }
    dirHashes[dir] = await hashMerkleNode(labels);
  }

  return {
    version: MERKLE_VERSION,
    root: dirHashes[''] ?? (await hashMerkleNode([])),
    dirs: dirHashes,
  };
};

export interface PlanFileReadsResult {
  pathsToRead: Set<string>;
  knownHashes: Record<string, string>;
}

/**
 * 根据 Merkle 快照规划需读取内容的文件路径。
 * 未变更子树内的文件沿用 filesIndex 中已有哈希，避免 readFile。
 */
export const planFileReads = async (
  candidates: string[],
  existingFiles: Record<string, IndexedFileEntry>,
  oldMerkle: MerkleSnapshot | null,
  force: boolean,
): Promise<PlanFileReadsResult> => {
  const pathsToRead = new Set<string>();
  const knownHashes: Record<string, string> = {};

  if (force || !oldMerkle || candidates.length === 0) {
    return { pathsToRead: new Set(candidates), knownHashes: {} };
  }

  for (const path of candidates) {
    if (!existingFiles[path]) pathsToRead.add(path);
  }

  const dirs = collectAllDirs(candidates);
  const dirSet = new Set(dirs);
  const filesByDir = groupFilesByDir(candidates);
  const dirHashes: Record<string, string> = {};

  for (const dir of dirs) {
    const labels: string[] = [];
    for (const file of filesByDir.get(dir) ?? []) {
      if (pathsToRead.has(file)) continue;
      const hash = existingFiles[file]?.hash;
      if (hash) labels.push(`f:${file}\0${hash}`);
    }
    for (const child of directChildDirs(dir, dirSet)) {
      const childHash = dirHashes[child];
      if (childHash) labels.push(`d:${child}\0${childHash}`);
    }
    dirHashes[dir] = await hashMerkleNode(labels);
  }

  if (dirHashes[''] === oldMerkle.root && pathsToRead.size === 0) {
    for (const path of candidates) {
      const hash = existingFiles[path]?.hash;
      if (hash) knownHashes[path] = hash;
    }
    return { pathsToRead, knownHashes };
  }

  const queue = [''];
  while (queue.length > 0) {
    const dir = queue.shift()!;
    const dirHash = dirHashes[dir];

    if (dirHash === oldMerkle.dirs[dir]) {
      for (const path of candidates) {
        if (isInDir(path, dir) && existingFiles[path] && !pathsToRead.has(path)) {
          knownHashes[path] = existingFiles[path].hash;
        }
      }
      continue;
    }

    for (const file of filesByDir.get(dir) ?? []) {
      if (!pathsToRead.has(file)) pathsToRead.add(file);
    }
    for (const child of directChildDirs(dir, dirSet)) {
      queue.push(child);
    }
  }

  return { pathsToRead, knownHashes };
};
