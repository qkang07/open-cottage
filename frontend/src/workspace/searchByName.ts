/**
 * 按文件名 / 路径搜索（遍历工作区文件列表）
 */

import { workspace } from './FileSystemWorkspace';
import {
  matchesPathFilters,
  matchesSizeFilters,
  type FileSearchFilters,
} from './searchFilters';

export interface FilenameSearchMatch {
  path: string;
  name: string;
}

export interface FilenameSearchOptions {
  query: string;
  caseSensitive?: boolean;
  filters?: FileSearchFilters;
  maxResults?: number;
  signal?: AbortSignal;
  onProgress?: (scanned: number, total: number) => void;
}

export interface FilenameSearchResult {
  query: string;
  fileCount: number;
  truncated: boolean;
  results: FilenameSearchMatch[];
}

export async function searchFilesByName(
  options: FilenameSearchOptions,
): Promise<FilenameSearchResult> {
  const {
    query,
    caseSensitive = false,
    filters = {},
    maxResults = 200,
    signal,
    onProgress,
  } = options;

  const q = query.trim();
  const cap = Math.max(1, Math.min(maxResults, 1000));
  const flags = caseSensitive ? '' : 'i';
  const matcher = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);

  const allFiles = await workspace.listFiles();
  const results: FilenameSearchMatch[] = [];
  let truncated = false;

  for (let i = 0; i < allFiles.length; i += 1) {
    if (signal?.aborted) break;
    onProgress?.(i + 1, allFiles.length);

    const path = allFiles[i];
    if (!matchesPathFilters(path, filters)) continue;

    const name = path.split('/').pop() ?? path;
    if (!matcher.test(name) && !matcher.test(path)) continue;

    if (
      filters.minSizeBytes !== undefined ||
      filters.maxSizeBytes !== undefined
    ) {
      const stat = await workspace.statFile(path);
      if (!matchesSizeFilters(stat?.size, filters)) continue;
    }

    results.push({ path, name });
    if (results.length >= cap) {
      truncated = allFiles.length > i + 1;
      break;
    }
  }

  return {
    query: q,
    fileCount: results.length,
    truncated,
    results,
  };
}
