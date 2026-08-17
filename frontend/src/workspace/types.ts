export interface WorkspaceFileNode {
  key: string;
  title: string;
  isLeaf: boolean;
  children?: WorkspaceFileNode[];
  /** 因遍历跳过而未展开，用户点击展开时再加载 */
  lazy?: boolean;
  /** 延迟原因：配置忽略或超大目录 */
  deferred?: import('./deferredDirs').DeferredDirReason;
  deferredEntryCount?: number;
}

export interface WorkspaceSnapshot {
  rootName: string;
  files: string[];
  /** 已知目录路径（含空目录与延迟目录占位） */
  directories: string[];
  tree: WorkspaceFileNode[];
  /** 快照扫描时标记的延迟目录（path → 原因） */
  deferredDirs?: Record<string, import('./deferredDirs').DeferredDirInfo>;
}
