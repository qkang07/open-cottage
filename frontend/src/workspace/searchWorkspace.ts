/**
 * 工作区内容搜索（供 UI 与 Agent 工具复用）
 */

import { workspace } from './FileSystemWorkspace';
import {
  buildSearchMatcher,
  isLikelyTextPath,
  searchInContent,
  type SearchLineMatch,
} from './search';
import {
  matchesPathFilters,
  matchesSizeFilters,
  mergeIncludeGlobs,
  type FileSearchFilters,
} from './searchFilters';

export interface WorkspaceSearchMatch {
  path: string;
  matches: SearchLineMatch[];
}

export interface WorkspaceSearchOptions extends FileSearchFilters {
  query: string;
  isRegex?: boolean;
  caseSensitive?: boolean;
  contextLines?: number;
  maxResults?: number;
  onProgress?: (scanned: number, total: number) => void;
  signal?: AbortSignal;
}

export interface WorkspaceSearchResult {
  query: string;
  fileCount: number;
  matchCount: number;
  truncated: boolean;
  results: WorkspaceSearchMatch[];
}

/** 在工作空间纯文本文件中按内容搜索（类似 grep） */
export async function searchWorkspace(
  options: WorkspaceSearchOptions,
): Promise<WorkspaceSearchResult> {
  const {
    query,
    isRegex,
    caseSensitive,
    include,
    exclude,
    extensions,
    minSizeBytes,
    maxSizeBytes,
    contextLines,
    maxResults,
    onProgress,
    signal,
  } = options;

  const matcher = buildSearchMatcher(query, { isRegex, caseSensitive });
  const pathFilters: FileSearchFilters = {
    include: mergeIncludeGlobs(include, extensions),
    exclude,
    minSizeBytes,
    maxSizeBytes,
  };
  const ctx = Math.max(0, Math.min(contextLines ?? 1, 5));
  const totalCap = Math.max(1, Math.min(maxResults ?? 20, 200));
  const perFileCap = 30;
  const needsSizeCheck =
    minSizeBytes !== undefined || maxSizeBytes !== undefined;

  const candidates = (await workspace.listFiles()).filter((p) => {
    if (!isLikelyTextPath(p)) return false;
    return matchesPathFilters(p, pathFilters);
  });

  const results: WorkspaceSearchMatch[] = [];
  let matchCount = 0;
  let truncated = false;

  for (let i = 0; i < candidates.length; i += 1) {
    if (signal?.aborted) break;
    onProgress?.(i + 1, candidates.length);

    if (matchCount >= totalCap) {
      truncated = true;
      break;
    }

    const path = candidates[i];
    if (needsSizeCheck) {
      const stat = await workspace.statFile(path);
      if (!matchesSizeFilters(stat?.size, pathFilters)) continue;
    }

    const { content } = await workspace.readFile(path);
    if (!content) continue;

    const remaining = Math.min(perFileCap, totalCap - matchCount);
    const matches = searchInContent(content, matcher, {
      contextLines: ctx,
      maxMatches: remaining,
    });

    if (matches.length) {
      results.push({ path, matches });
      matchCount += matches.length;
    }
  }

  return {
    query,
    fileCount: results.length,
    matchCount,
    truncated,
    results,
  };
}
