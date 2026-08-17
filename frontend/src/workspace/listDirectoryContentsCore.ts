/**
 * 单层目录列表的纯函数实现：主线程与 Web Worker 共用。
 * 把 FSA `dir.entries()` 遍历从主线程移到 Worker，避免展开大目录时卡 UI。
 */

import { checkAborted } from '../util/yield';
import { normalizePath } from './pathUtils';
import type { ExplorerEntry } from './explorerTypes';

export interface ListDirOptions {
  signal?: AbortSignal;
  includeFileMetadata?: boolean;
  yieldFn?: (iteration: number) => Promise<void> | void;
}

async function resolveDirectory(
  root: FileSystemDirectoryHandle,
  path: string,
): Promise<FileSystemDirectoryHandle | null> {
  if (!path) return root;
  const parts = path.split('/').filter(Boolean);
  let current = root;
  for (const part of parts) {
    try {
      current = await current.getDirectoryHandle(part);
    } catch {
      return null;
    }
  }
  return current;
}

export async function listDirectoryContentsCore(
  root: FileSystemDirectoryHandle,
  dirPath: string,
  options: ListDirOptions = {},
): Promise<ExplorerEntry[]> {
  const base = normalizePath(dirPath);
  const dir = base ? await resolveDirectory(root, base) : root;
  if (!dir) return [];

  const entries: ExplorerEntry[] = [];
  const includeFileMetadata = options.includeFileMetadata !== false;
  const yieldFn = options.yieldFn;
  let iteration = 0;

  for await (const [name, handle] of dir.entries()) {
    checkAborted(options.signal);
    iteration += 1;
    if (yieldFn) await yieldFn(iteration);

    if (name.startsWith('.')) continue;
    const path = base ? `${base}/${name}` : name;

    if (handle.kind === 'directory') {
      entries.push({
        name,
        path,
        kind: 'directory',
        size: null,
        modified: null,
        extension: '',
      });
      continue;
    }

    const dot = name.lastIndexOf('.');
    const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';

    if (!includeFileMetadata) {
      entries.push({
        name,
        path,
        kind: 'file',
        size: null,
        modified: null,
        extension,
      });
      continue;
    }

    const file = await (handle as FileSystemFileHandle).getFile();
    entries.push({
      name,
      path,
      kind: 'file',
      size: file.size,
      modified: file.lastModified,
      extension,
    });
  }

  return entries;
}
