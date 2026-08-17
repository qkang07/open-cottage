/**
 * 统一工作区搜索入口（文本 / 向量 / 文件名）
 */

import type { SearchLineMatch } from './search';
import { searchFilesByName } from './searchByName';
import { parseSizeInput, type FileSearchFilters } from './searchFilters';
import { searchWorkspace } from './searchWorkspace';

export type WorkspaceSearchMode = 'text' | 'filename';

export interface WorkspaceSearchRunOptions extends FileSearchFilters {
  query: string;
  mode: WorkspaceSearchMode;
  caseSensitive?: boolean;
  isRegex?: boolean;
  maxResults?: number;
  signal?: AbortSignal;
  onProgress?: (scanned: number, total: number) => void;
}

export interface TextSearchResultGroup {
  kind: 'text';
  path: string;
  matches: SearchLineMatch[];
}

export interface FilenameSearchResultGroup {
  kind: 'filename';
  path: string;
  name: string;
}

export type WorkspaceSearchResultGroup =
  | TextSearchResultGroup
  | FilenameSearchResultGroup;

export interface WorkspaceSearchRunResult {
  mode: WorkspaceSearchMode;
  groups: WorkspaceSearchResultGroup[];
  summary: string | null;
}

export interface WorkspaceSearchFilterForm {
  includePattern: string;
  excludePattern: string;
  fileTypePreset: string;
  minSizeInput: string;
  maxSizeInput: string;
}

export function filtersFromForm(form: WorkspaceSearchFilterForm): FileSearchFilters {
  const include = form.includePattern.trim()
    ? form.includePattern.split(',').map((s) => s.trim()).filter(Boolean)
    : undefined;
  const exclude = form.excludePattern.trim()
    ? form.excludePattern.split(',').map((s) => s.trim()).filter(Boolean)
    : undefined;
  const minSizeBytes = parseSizeInput(form.minSizeInput);
  const maxSizeBytes = parseSizeInput(form.maxSizeInput);
  return {
    include,
    exclude,
    minSizeBytes,
    maxSizeBytes,
  };
}

export async function runWorkspaceSearch(
  options: WorkspaceSearchRunOptions,
): Promise<WorkspaceSearchRunResult> {
  const {
    query,
    mode,
    caseSensitive,
    isRegex,
    include,
    exclude,
    extensions,
    minSizeBytes,
    maxSizeBytes,
    maxResults,
    signal,
    onProgress,
  } = options;

  const filters: FileSearchFilters = {
    include,
    exclude,
    extensions,
    minSizeBytes,
    maxSizeBytes,
  };

  if (mode === 'filename') {
    const result = await searchFilesByName({
      query,
      caseSensitive,
      filters,
      maxResults: maxResults ?? 50,
      signal,
      onProgress,
    });
    if (signal?.aborted) {
      return { mode, groups: [], summary: null };
    }
    const groups: WorkspaceSearchResultGroup[] = result.results.map((r) => ({
      kind: 'filename',
      path: r.path,
      name: r.name,
    }));
    return {
      mode,
      groups,
      summary: result.fileCount
        ? `${result.fileCount} 个文件${result.truncated ? '（已截断）' : ''}`
        : '未找到匹配文件',
    };
  }

  const result = await searchWorkspace({
    query,
    caseSensitive,
    isRegex,
    include: filters.include,
    exclude: filters.exclude,
    extensions: filters.extensions,
    minSizeBytes: filters.minSizeBytes,
    maxSizeBytes: filters.maxSizeBytes,
    contextLines: 1,
    maxResults: maxResults ?? 20,
    signal,
    onProgress,
  });
  if (signal?.aborted) {
    return { mode, groups: [], summary: null };
  }
  const groups: WorkspaceSearchResultGroup[] = result.results.map((r) => ({
    kind: 'text',
    path: r.path,
    matches: r.matches,
  }));
  return {
    mode,
    groups,
    summary: result.matchCount
      ? `${result.matchCount} 个结果，${result.fileCount} 个文件${
          result.truncated ? '（已截断）' : ''
        }`
      : '未找到匹配',
  };
}
