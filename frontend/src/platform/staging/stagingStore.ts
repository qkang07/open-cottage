import { normalizePath } from '../../workspace/pathUtils';

/** 单个暂存条目：记录写入前/后内容与是否新建/删除，供 UI 渲染 diff 与合并时落盘 */
export interface StagedEntry {
  path: string;
  /** 写入前磁盘内容（新建文件时为空串） */
  before: string;
  /** 写入后内容（删除时无意义） */
  after: string;
  /** 是否为新建文件（写入前磁盘不存在） */
  created: boolean;
  /** 是否标记为待删除 */
  deleted: boolean;
  /** 是否已在审批面板确认；确认后保留到整批落盘 */
  approved: boolean;
}

/** 暂存内容上限：超过则不暂存全文，仅记录元信息（与 DIFF_CAPTURE_MAX_BYTES 对齐） */
const STAGE_CONTENT_MAX_BYTES = 256 * 1024;

const withinContentLimit = (text: string): boolean =>
  text.length <= STAGE_CONTENT_MAX_BYTES;

/**
 * 内存暂存区：本回合内所有写工具的改动先落此处，不触磁盘。
 * 回合末由 CottageAgent 触发批量审批，批准后 commit() 逐文件写真实磁盘。
 * 变更时可选回调，供会话级 staging.json 落盘（刷新后可恢复批准面板）。
 */
export class StagingStore {
  private readonly entries = new Map<string, StagedEntry>();
  private onChange: (() => void) | null = null;

  setOnChange(handler: (() => void) | null): void {
    this.onChange = handler;
  }

  private notifyChange(): void {
    this.onChange?.();
  }

  has(path: string): boolean {
    return this.entries.has(normalizePath(path));
  }

  get(path: string): StagedEntry | null {
    return this.entries.get(normalizePath(path)) ?? null;
  }

  isEmpty(): boolean {
    return this.entries.size === 0;
  }

  size(): number {
    return this.entries.size;
  }

  /** 列出全部暂存条目（按路径排序，便于 UI 稳定展示） */
  entriesList(): StagedEntry[] {
    return [...this.entries.values()].sort((a, b) =>
      a.path.localeCompare(b.path),
    );
  }

  /**
   * 记录一次写入/覆盖。
   * beforeHas=true 表示磁盘已存在该文件；false 表示新建。
   * 超大内容不暂存全文（before/after 置空），合并时改走「跳过」并由调用方决定如何处理。
   */
  stageWrite(
    path: string,
    before: string,
    after: string,
    beforeHas: boolean,
  ): StagedEntry {
    const normalized = normalizePath(path);
    const limitOk = withinContentLimit(after);
    const entry: StagedEntry = {
      path: normalized,
      before: beforeHas ? before : '',
      after: limitOk ? after : '',
      created: !beforeHas,
      deleted: false,
      approved: false,
    };
    // 多次写入同一文件：保留最初捕获的 before/created，更新 after
    const existing = this.entries.get(normalized);
    if (existing) {
      entry.before = existing.before;
      entry.created = existing.created;
      entry.deleted = false;
      entry.approved = false;
    }
    this.entries.set(normalized, entry);
    this.notifyChange();
    return entry;
  }

  /** 标记待删除：合并时才真正删除磁盘文件 */
  stageDelete(path: string, before: string, beforeHas: boolean): StagedEntry {
    const normalized = normalizePath(path);
    const existing = this.entries.get(normalized);
    const entry: StagedEntry = {
      path: normalized,
      before: existing?.before ?? (beforeHas ? before : ''),
      after: '',
      created: existing?.created ?? !beforeHas,
      deleted: true,
      approved: false,
    };
    this.entries.set(normalized, entry);
    this.notifyChange();
    return entry;
  }

  /** 审批面板内就地编辑某文件的 after 内容（不改 before/created） */
  updateAfter(path: string, newAfter: string): void {
    const entry = this.entries.get(normalizePath(path));
    if (!entry || entry.deleted) return;
    entry.after = withinContentLimit(newAfter) ? newAfter : entry.after;
    this.notifyChange();
  }

  /** 将单个文件标记为已批准，等待整批审批结束后统一落盘。 */
  approveEntry(path: string, approvedAfter?: string): boolean {
    const entry = this.entries.get(normalizePath(path));
    if (!entry) return false;
    if (!entry.deleted && approvedAfter !== undefined) {
      entry.after = withinContentLimit(approvedAfter) ? approvedAfter : entry.after;
    }
    entry.approved = true;
    this.notifyChange();
    return true;
  }

  pendingEntriesList(): StagedEntry[] {
    return this.entriesList().filter((entry) => !entry.approved);
  }

  /** 审批面板内丢弃某文件（从暂存移除，既不合并也不影响磁盘） */
  discardEntry(path: string): boolean {
    const removed = this.entries.delete(normalizePath(path));
    if (removed) this.notifyChange();
    return removed;
  }

  /** 从落盘快照恢复（不触发 onChange，避免写回循环） */
  hydrate(entries: readonly StagedEntry[]): void {
    this.entries.clear();
    for (const raw of entries) {
      const path = normalizePath(raw.path);
      this.entries.set(path, {
        path,
        before: raw.before ?? '',
        after: raw.after ?? '',
        created: Boolean(raw.created),
        deleted: Boolean(raw.deleted),
        approved: Boolean(raw.approved),
      });
    }
  }

  /** 深拷贝当前条目，供 staging.json 落盘 */
  snapshot(): StagedEntry[] {
    return this.entriesList().map((entry) => ({ ...entry }));
  }

  clear(): void {
    if (this.entries.size === 0) return;
    this.entries.clear();
    this.notifyChange();
  }
}
