import { normalizePath } from '../workspace/pathUtils';
import { workspace } from '../workspace/FileSystemWorkspace';
import type { MutationEntry, ToolMutationReport } from './types';

interface MutationSnapshot {
  path: string;
  kind: 'file' | 'directory';
  exists: boolean;
  hash?: string;
  size?: number;
}

export interface MutationJournalOptions {
  allowedPathPrefixes: string[];
  onBeforePath?: (path: string) => void | Promise<void>;
}

export interface MutationJournalRuntime {
  begin(options: MutationJournalOptions): void;
  end(): Promise<ToolMutationReport>;
  abort(): void;
}

interface ActiveJournal {
  options: MutationJournalOptions;
  before: Map<string, MutationSnapshot>;
  touched: Set<string>;
}

let active: ActiveJournal | null = null;

const hashBytes = async (bytes: Uint8Array) => {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, '0'),
  ).join('');
};

const isInternal = (path: string) => path === '.cottage' || path.startsWith('.cottage/');

const within = (path: string, prefixes: readonly string[]) => {
  const candidate = path.toLowerCase();
  return prefixes.some((prefix) => {
    const root = normalizePath(prefix).toLowerCase();
    return candidate === root || candidate.startsWith(`${root}/`);
  });
};

const assertWorkspaceResolution = async (path: string) => {
  const root = workspace.rootHandle;
  if (!root) throw new Error('工作区未打开');
  const parts = path.split('/').filter(Boolean);
  let current: FileSystemDirectoryHandle = root;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!;
    try {
      if (index === parts.length - 1) {
        let handle: FileSystemHandle;
        try {
          handle = await current.getDirectoryHandle(part);
        } catch {
          handle = await current.getFileHandle(part);
        }
        if (!(await root.resolve(handle))) {
          throw new Error(`路径真实位置逃逸工作区：${path}`);
        }
        return;
      }
      current = await current.getDirectoryHandle(part);
      if (!(await root.resolve(current))) {
        throw new Error(`路径真实位置逃逸工作区：${path}`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('逃逸工作区')) throw error;
      // Remaining segments are new. Their nearest existing parent was resolved
      // through a handle rooted in the selected workspace.
      return;
    }
  }
};

const snapshot = async (path: string): Promise<MutationSnapshot> => {
  const kind = await workspace.getEntryKind(path);
  if (kind === 'file') {
    const bytes = await workspace.readFileBytes(path);
    return {
      path,
      kind,
      exists: true,
      hash: await hashBytes(bytes),
      size: bytes.byteLength,
    };
  }
  return { path, kind: 'directory', exists: kind === 'directory' };
};

export const beginMutationJournal = (options: MutationJournalOptions) => {
  if (active) throw new Error('Mutation Journal 已在执行；写工具必须串行');
  active = { options, before: new Map(), touched: new Set() };
};

/** Called by FileSystemWorkspace immediately before the physical mutation. */
export const journalBeforeMutation = async (rawPath: string): Promise<void> => {
  if (!active) return;
  const raw = rawPath.replace(/\\/g, '/').trim();
  if (
    !raw ||
    raw.startsWith('/') ||
    /^[a-zA-Z]:\//.test(raw) ||
    raw.split('/').some((part) => part === '..')
  ) {
    throw new Error(`无效或越界的动态输出路径：${rawPath}`);
  }
  const path = normalizePath(rawPath);
  if (!path) return;
  if (isInternal(path)) throw new Error('计划工具不能写入内部 .cottage 路径');
  if (!within(path, active.options.allowedPathPrefixes)) {
    throw new Error(`动态输出路径超出已批准范围：${path}`);
  }
  await assertWorkspaceResolution(path);
  const parts = path.split('/');
  for (let index = 1; index < parts.length; index += 1) {
    const parent = parts.slice(0, index).join('/');
    if (!within(parent, active.options.allowedPathPrefixes)) continue;
    if ((await workspace.getEntryKind(parent)) !== null) continue;
    if (!active.before.has(parent)) {
      active.before.set(parent, {
        path: parent,
        kind: 'directory',
        exists: false,
      });
    }
    active.touched.add(parent);
  }
  if (!active.before.has(path)) {
    await active.options.onBeforePath?.(path);
    const initial = await snapshot(path);
    active.before.set(path, initial);
    if (initial.exists && initial.kind === 'directory') {
      const descendants = await workspace.listFiles(path, { skipIgnoredDirs: false });
      for (const file of descendants) {
        if (!active.before.has(file)) {
          await active.options.onBeforePath?.(file);
          active.before.set(file, await snapshot(file));
        }
        active.touched.add(file);
      }
    }
  }
  active.touched.add(path);
};

const asEntry = (value: MutationSnapshot): MutationEntry => ({
  path: value.path,
  kind: value.kind,
  ...(value.hash ? { beforeHash: value.hash } : {}),
  ...(value.size !== undefined ? { size: value.size } : {}),
});

export const endMutationJournal = async (): Promise<ToolMutationReport> => {
  const journal = active;
  const report: ToolMutationReport = { created: [], modified: [], deleted: [], moved: [] };
  if (!journal) return report;

  for (const path of journal.touched) {
    const before = journal.before.get(path) ?? {
      path,
      kind: 'file' as const,
      exists: false,
    };
    const after = await snapshot(path);
    if (!before.exists && after.exists) {
      report.created.push({
        path,
        kind: after.kind,
        afterHash: after.hash,
        size: after.size,
      });
    } else if (before.exists && !after.exists) {
      report.deleted.push(asEntry(before));
    } else if (
      before.exists &&
      after.exists &&
      (before.hash !== after.hash || before.kind !== after.kind)
    ) {
      report.modified.push({
        path,
        kind: after.kind,
        beforeHash: before.hash,
        afterHash: after.hash,
        size: after.size,
      });
    }
  }

  // FileSystem Access has no portable atomic move primitive. The workspace
  // implements rename as copy+delete; pair equal hashes into a moved record.
  for (const deleted of [...report.deleted]) {
    if (!deleted.beforeHash) continue;
    const created = report.created.find((item) => item.afterHash === deleted.beforeHash);
    if (!created) continue;
    report.moved.push({ from: deleted, to: created });
    report.deleted.splice(report.deleted.indexOf(deleted), 1);
    report.created.splice(report.created.indexOf(created), 1);
  }
  active = null;
  return report;
};

export const abortMutationJournal = () => {
  active = null;
};

export const mutationJournalActive = () => active !== null;

/** 生产默认实现；评测可注入绑定隔离工作区的同契约 journal。 */
export const workspaceMutationJournal: MutationJournalRuntime = {
  begin: beginMutationJournal,
  end: endMutationJournal,
  abort: abortMutationJournal,
};
