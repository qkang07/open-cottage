export interface ExplorerEntry {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  size: number | null;
  modified: number | null;
  extension: string;
  deferred?: import('./deferredDirs').DeferredDirReason;
  deferredEntryCount?: number;
}

export type ExplorerViewMode = 'icons' | 'list' | 'details';

export type ExplorerSortKey = 'name' | 'size' | 'type' | 'modified';

export type ExplorerSortOrder = 'asc' | 'desc';

/** 文件夹递归大小统计 */
export interface DirectorySizeResult {
  totalBytes: number;
  fileCount: number;
  directoryCount: number;
}
