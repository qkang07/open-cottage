export const HISTORY_SCHEMA_VERSION = 2 as const;

export type HistoryVersionSource =
  | 'initial'
  | 'manual'
  | 'agent'
  | 'external'
  | 'restore';

export type HistoryUnavailableReason =
  | 'oversize'
  | 'user-deleted'
  | 'quota-pruned'
  | 'storage-error';

export type HistoryChangeType = 'added' | 'modified' | 'deleted' | 'renamed';

export interface StoredHistoryFile {
  state: 'stored';
  objectId: string;
  size: number;
  modified: number;
  binary: boolean;
  /** 重命名来源路径（仅当 changeType 为 renamed 时存在） */
  renamedFrom?: string;
}

export interface UnavailableHistoryFile {
  state: 'unavailable';
  reason: HistoryUnavailableReason;
  size: number;
  modified: number;
  binary: boolean;
}

export interface DeletedHistoryFile {
  state: 'deleted';
}

export type HistoryFileState =
  | StoredHistoryFile
  | UnavailableHistoryFile
  | DeletedHistoryFile;

export interface HistoryBase {
  schema: typeof HISTORY_SCHEMA_VERSION;
  id: string;
  at: number;
  source: HistoryVersionSource;
  label: string;
  files: Record<string, HistoryFileState>;
  changeTypes: Record<string, HistoryChangeType>;
}

export interface HistoryVersion {
  schema: typeof HISTORY_SCHEMA_VERSION;
  id: string;
  at: number;
  source: HistoryVersionSource;
  label: string;
  changes: Record<string, HistoryFileState>;
  changeTypes: Record<string, HistoryChangeType>;
}

export interface HistoryCleanupEntry {
  at: number;
  reason: 'file-limit' | 'pool-limit' | 'manual';
  versionsRemoved: number;
  revisionsRemoved: number;
  bytesFreed: number;
}

export interface HistoryMeta {
  schema: typeof HISTORY_SCHEMA_VERSION;
  status: 'ready' | 'disabled' | 'paused' | 'error';
  lastVersionAt: number | null;
  error?: string;
  cleanupLog: HistoryCleanupEntry[];
}

export interface HistoryIndex {
  schema: typeof HISTORY_SCHEMA_VERSION;
  baseId: string | null;
  versionIds: string[];
  fileHistory: Record<string, string[]>;
  objectRefs: Record<
    string,
    { count: number; size: number; binary: boolean }
  >;
  cachedUsage: {
    objectBytes: number;
    textBytes: number;
    binaryBytes: number;
    fileCount: number;
  };
  updatedAt: number;
}

export interface HistoryVersionSummary {
  id: string;
  at: number;
  source: HistoryVersionSource;
  label: string;
  changedPaths: string[];
  changeTypes: Record<string, HistoryChangeType>;
  /** 重命名文件的原路径映射（仅当 changeType 为 renamed 时存在） */
  renamedFrom?: Record<string, string>;
  complete: boolean;
  unavailableCount: number;
  isBase: boolean;
}

export interface HistoryFileVersionSummary {
  versionId: string;
  at: number;
  source: HistoryVersionSource;
  label: string;
  path: string;
  state: HistoryFileState;
  restorable: boolean;
}

export interface HistoryFileSummary {
  path: string;
  binary: boolean;
  versions: number;
  logicalBytes: number;
  latestAt: number;
  unavailableVersions: number;
}

export interface HistoryPoolStats {
  objectBytes: number;
  metadataBytes: number;
  totalBytes: number;
  textBytes: number;
  binaryBytes: number;
  objectCount: number;
  fileCount: number;
  versionCount: number;
  limitBytes: number;
}

export interface HistoryDeleteResult {
  revisionsRemoved: number;
  versionsRemoved: number;
  logicalBytesRemoved: number;
  bytesFreed: number;
}

export interface HistorySnapshot {
  version: HistoryVersionSummary;
  files: Map<string, HistoryFileState>;
}
