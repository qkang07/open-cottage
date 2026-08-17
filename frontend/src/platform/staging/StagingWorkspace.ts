import { workspace, type EntryKind } from '../../workspace/FileSystemWorkspace';
import { normalizePath } from '../../workspace/pathUtils';
import { basenameOf, parentDirOf } from '../../workspace/suggestEntryPath';
import type { ExplorerEntry } from '../../workspace/explorerTypes';
import type { StagedEntry, StagingStore } from './stagingStore';

/**
 * 暂存感知的 workspace 门面：包裹真实 workspace 单例，拦截工具实际调用的
 * read / exists / write / list 等只读与写入路径。
 *
 * - 写入先落 StagingStore，不触磁盘；
 * - 读取叠加暂存，保证 Agent 自身后续 readFile 看到的是暂存后的内容；
 * - commit() 在用户批准后逐文件写真实磁盘；discard() 仅清空。
 */
export class StagingWorkspace {
  constructor(private readonly store: StagingStore) {}

  private realExists(path: string): Promise<boolean> {
    return workspace.exists(path);
  }

  private async realRead(path: string): Promise<string> {
    const { content } = await workspace.readFile(path);
    return content;
  }

  async readFile(path: string): Promise<{ path: string; content: string }> {
    const normalized = normalizePath(path);
    const entry = this.store.get(normalized);
    if (entry) {
      if (entry.deleted) return { path: normalized, content: '' };
      return { path: normalized, content: entry.after };
    }
    return workspace.readFile(normalized);
  }

  async exists(path: string): Promise<boolean> {
    const normalized = normalizePath(path);
    const entry = this.store.get(normalized);
    if (entry) return !entry.deleted;
    return this.realExists(normalized);
  }

  async getEntryKind(path: string): Promise<EntryKind> {
    const normalized = normalizePath(path);
    const entry = this.store.get(normalized);
    if (entry) return entry.deleted ? null : 'file';
    // 暂存文件的祖先目录视为存在
    const prefix = normalized ? `${normalized}/` : '';
    if (
      normalized &&
      this.store
        .entriesList()
        .some((e) => !e.deleted && e.path.startsWith(prefix))
    ) {
      return 'directory';
    }
    return workspace.getEntryKind(normalized);
  }

  async readFileBytes(path: string): Promise<Uint8Array> {
    const normalized = normalizePath(path);
    const entry = this.store.get(normalized);
    if (entry) {
      if (entry.deleted) return new Uint8Array();
      return new TextEncoder().encode(entry.after);
    }
    return workspace.readFileBytes(normalized);
  }

  async statFile(
    path: string,
  ): Promise<{ size: number; modified: number } | null> {
    const normalized = normalizePath(path);
    const entry = this.store.get(normalized);
    if (entry) {
      if (entry.deleted) return null;
      return { size: new TextEncoder().encode(entry.after).length, modified: Date.now() };
    }
    return workspace.statFile(normalized);
  }

  async listDirectoryContents(
    dirPath = '',
    options?: { includeFileMetadata?: boolean },
  ): Promise<ExplorerEntry[]> {
    const base = normalizePath(dirPath);
    const real = await workspace.listDirectoryContents(base, {
      includeFileMetadata: options?.includeFileMetadata ?? true,
    });
    const map = new Map(real.map((e) => [e.name, e]));

    for (const entry of this.store.entriesList()) {
      const parent = parentDirOf(entry.path);
      if (parent !== base) {
        // 暂存深层文件：在当前目录露出中间目录名
        const prefix = base ? `${base}/` : '';
        if (!entry.deleted && entry.path.startsWith(prefix)) {
          const rest = entry.path.slice(prefix.length);
          const first = rest.split('/')[0];
          if (first && rest.includes('/') && !map.has(first)) {
            map.set(first, {
              name: first,
              path: base ? `${base}/${first}` : first,
              kind: 'directory',
              size: null,
              modified: null,
              extension: '',
            });
          }
        }
        continue;
      }
      const name = basenameOf(entry.path);
      if (entry.deleted) {
        map.delete(name);
        continue;
      }
      const ext = name.includes('.') ? (name.split('.').pop() ?? '') : '';
      map.set(name, {
        name,
        path: entry.path,
        kind: 'file',
        size: new TextEncoder().encode(entry.after).length,
        modified: Date.now(),
        extension: ext,
      });
    }

    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async writeFile(path: string, content: string) {
    const normalized = normalizePath(path);
    const existing = this.store.get(normalized);
    const beforeHas = existing
      ? !existing.deleted
      : await this.realExists(normalized);
    const before = existing
      ? existing.after
      : beforeHas
        ? await this.realRead(normalized)
        : '';
    this.store.stageWrite(normalized, before, content, beforeHas);
    return { path: normalized, written: true };
  }

  async createFile(path: string, content = '') {
    return this.writeFile(path, content);
  }

  async appendFile(path: string, content: string) {
    const normalized = normalizePath(path);
    const existing = await this.exists(normalized)
      ? (await this.readFile(normalized)).content
      : '';
    const next =
      existing.length === 0
        ? content
        : existing.endsWith('\n') || content.startsWith('\n')
          ? existing + content
          : `${existing}\n${content}`;
    await this.writeFile(normalized, next);
    return {
      path: normalized,
      appended: true,
      created: existing.length === 0,
      length: next.length,
    };
  }

  async deleteFile(path: string) {
    const normalized = normalizePath(path);
    const existing = this.store.get(normalized);
    const beforeHas = existing
      ? !existing.deleted
      : await this.realExists(normalized);
    const before = existing
      ? existing.after
      : beforeHas
        ? await this.realRead(normalized)
        : '';
    this.store.stageDelete(normalized, before, beforeHas);
    return { path: normalized, deleted: true };
  }

  async listFiles(prefix = ''): Promise<string[]> {
    const base = normalizePath(prefix);
    const real = await workspace.listFiles(base);
    const set = new Set(real);
    for (const entry of this.store.entriesList()) {
      if (entry.deleted) {
        set.delete(entry.path);
        continue;
      }
      if (!base || entry.path === base || entry.path.startsWith(`${base}/`)) {
        set.add(entry.path);
      }
    }
    return [...set].sort();
  }

  /** 用户批准后：逐文件写真实磁盘，完成后清空暂存。返回已落盘条目。 */
  async commit(): Promise<StagedEntry[]> {
    const entries = this.store.entriesList();
    const committed: StagedEntry[] = [];
    for (const entry of entries) {
      if (entry.deleted) {
        if (await this.realExists(entry.path)) {
          await workspace.deleteFile(entry.path);
        }
        committed.push(entry);
        continue;
      }
      await workspace.writeFile(entry.path, entry.after);
      committed.push(entry);
    }
    this.store.clear();
    return committed;
  }

  /** 用户丢弃：清空暂存，不触磁盘。 */
  discard(): void {
    this.store.clear();
  }
}
