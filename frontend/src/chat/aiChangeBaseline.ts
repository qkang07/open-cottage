import type { FilePreview } from '../workspace/previewKind';
import { normalizePath } from '../workspace/pathUtils';

const MAX_BASELINE_BYTES = 64 * 1024 * 1024;
const ACTIVE_INDEX_PATH = 'history/ai-changes/index.json';
const ACTIVE_OBJECT_PREFIX = 'history/ai-changes/objects/';

export type AiChangeBaselineRef =
  | { kind: 'missing' }
  | { kind: 'stored'; storagePath: string; size: number }
  | { kind: 'unavailable'; reason: 'directory' | 'oversize' | 'read-error' | 'storage-error' };

export type AiChangeKind = 'created' | 'modified' | 'generated' | 'deleted';

export interface AiChangeRecord {
  path: string;
  kind: AiChangeKind;
  baseline: AiChangeBaselineRef;
  updatedAt: number;
}

type CapturedBaseline =
  | { kind: 'missing' }
  | { kind: 'stored'; bytes: Uint8Array }
  | { kind: 'unavailable'; reason: 'directory' | 'oversize' | 'read-error' };

interface CaptureContext {
  entries: Map<string, CapturedBaseline>;
}

const activeCaptures = new Map<symbol, CaptureContext>();

const hashBytes = async (bytes: Uint8Array): Promise<string> => {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, '0'),
  ).join('');
};

const readActiveIndex = async (): Promise<Record<string, AiChangeRecord>> => {
  const { workspace } = await import('../workspace/FileSystemWorkspace');
  const raw = await workspace.readCottagePath<Record<string, AiChangeRecord>>(ACTIVE_INDEX_PATH);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw).filter(([path, record]) =>
      normalizePath(path) === path &&
      record && typeof record === 'object' &&
      typeof record.path === 'string' &&
      record.path === path &&
      record.baseline && typeof record.baseline === 'object',
    ),
  );
};

const writeActiveIndex = async (index: Record<string, AiChangeRecord>) => {
  const { workspace } = await import('../workspace/FileSystemWorkspace');
  await workspace.writeCottagePath(ACTIVE_INDEX_PATH, index);
};

export async function loadAiChangeRecords(): Promise<AiChangeRecord[]> {
  return Object.values(await readActiveIndex()).sort((a, b) => a.path.localeCompare(b.path));
}

export async function getAiChangeRecord(path: string): Promise<AiChangeRecord | null> {
  const normalized = normalizePath(path);
  return (await readActiveIndex())[normalized] ?? null;
}

export const beginAiChangeCapture = (_sessionId?: string): symbol => {
  const token = Symbol('ai-change-capture');
  activeCaptures.set(token, { entries: new Map() });
  return token;
};

/**
 * 在工作区真实写入前捕获路径的首次本地基线。基线属于工作区活动改动，
 * 不属于聊天会话；同一进程中的并发工具上下文都会拿到同一份写入前状态。
 */
export async function captureAiChangeBeforeMutation(
  rawPath: string,
  read: () => Promise<
    | { kind: 'missing' | 'directory' }
    | { kind: 'file'; size: number; bytes: Uint8Array }
  >,
): Promise<void> {
  const path = normalizePath(rawPath);
  if (!path || activeCaptures.size === 0) return;
  const targets = [...activeCaptures.values()].filter(
    (context) => !context.entries.has(path),
  );
  if (!targets.length) return;

  let captured: CapturedBaseline;
  try {
    const snapshot = await read();
    if (snapshot.kind === 'file') {
      captured = snapshot.size > MAX_BASELINE_BYTES
        ? { kind: 'unavailable', reason: 'oversize' }
        : { kind: 'stored', bytes: snapshot.bytes };
    } else if (snapshot.kind === 'missing') {
      captured = { kind: 'missing' };
    } else {
      captured = { kind: 'unavailable', reason: 'directory' };
    }
  } catch {
    captured = { kind: 'unavailable', reason: 'read-error' };
  }
  for (const context of targets) context.entries.set(path, captured);
}

const kindAfterMutation = async (path: string, baseline: CapturedBaseline): Promise<AiChangeKind> => {
  const { workspace } = await import('../workspace/FileSystemWorkspace');
  const current = await workspace.getEntryKind(path);
  if (current === null) return 'deleted';
  return baseline.kind === 'missing' ? 'created' : 'modified';
};

const persistBaselineBytes = async (
  bytes: Uint8Array | null,
): Promise<AiChangeBaselineRef> => {
  if (bytes === null) return { kind: 'missing' };
  if (bytes.byteLength > MAX_BASELINE_BYTES) {
    return { kind: 'unavailable', reason: 'oversize' };
  }
  try {
    const { workspace } = await import('../workspace/FileSystemWorkspace');
    const objectId = await hashBytes(bytes);
    const storagePath = `${ACTIVE_OBJECT_PREFIX}${objectId}.bin`;
    if (!(await workspace.readCottageBytes(storagePath))) {
      await workspace.writeCottageBytes(storagePath, bytes);
    }
    return { kind: 'stored', storagePath, size: bytes.byteLength };
  } catch {
    return { kind: 'unavailable', reason: 'storage-error' };
  }
};

/** 暂存区在用户批准后落盘时登记同一份工作区级活动基线。 */
export async function recordAiChangeFromBytes(
  rawPath: string,
  bytes: Uint8Array | null,
  kind: AiChangeKind,
): Promise<AiChangeBaselineRef> {
  const path = normalizePath(rawPath);
  const index = await readActiveIndex();
  const existing = index[path];
  if (existing) return existing.baseline;
  const baseline = await persistBaselineBytes(bytes);
  index[path] = { path, kind, baseline, updatedAt: Date.now() };
  await writeActiveIndex(index).catch(() => undefined);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('cottage:ai-changes-updated'));
  }
  return baseline;
}

/** 将本次工具捕获的基线写入工作区级活动改动记录。 */
export async function finishAiChangeCapture(
  token: symbol | null,
): Promise<Record<string, AiChangeBaselineRef> | undefined> {
  if (!token) return undefined;
  const context = activeCaptures.get(token);
  activeCaptures.delete(token);
  if (!context || context.entries.size === 0) return undefined;

  const index = await readActiveIndex();
  const refs: Record<string, AiChangeBaselineRef> = {};
  let indexChanged = false;
  for (const [path, entry] of context.entries) {
    // 同一文件已有未处理的工作区改动时，继续保留最初基线，避免多次 AI
    // 调用把 reset 目标推进到中间状态。
    const existing = index[path];
    if (existing) {
      refs[path] = existing.baseline;
      continue;
    }

    let baseline: AiChangeBaselineRef;
    baseline = entry.kind === 'stored'
      ? await persistBaselineBytes(entry.bytes)
      : entry;
    refs[path] = baseline;
    index[path] = {
      path,
      kind: await kindAfterMutation(path, entry),
      baseline,
      updatedAt: Date.now(),
    };
    indexChanged = true;
  }
  if (indexChanged) {
    await writeActiveIndex(index).catch(() => undefined);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('cottage:ai-changes-updated'));
    }
  }
  return refs;
}

const isValidStoragePath = (path: string): boolean =>
  /^history\/ai-changes\/objects\/[a-f0-9]{64}\.bin$/.test(path) ||
  /^sessions\/[a-zA-Z0-9._-]+\/change-baselines\/[a-f0-9]{64}\.bin$/.test(path);

export async function readAiChangeBaselineBytes(
  baseline: AiChangeBaselineRef,
): Promise<Uint8Array | null> {
  if (baseline.kind !== 'stored' || !isValidStoragePath(baseline.storagePath)) return null;
  const { workspace } = await import('../workspace/FileSystemWorkspace');
  return workspace.readCottageBytes(baseline.storagePath);
}

export async function loadAiChangeBaselinePreview(
  path: string,
  baseline: AiChangeBaselineRef,
): Promise<FilePreview | null> {
  const bytes = await readAiChangeBaselineBytes(baseline);
  if (!bytes) return null;
  const { loadFileBytesForPreview } = await import('../workspace/previewBytes');
  return loadFileBytesForPreview(path, bytes);
}

/** reset / mark as normal 后移除工作区级活动改动记录。 */
export async function removeAiChangeRecord(path: string): Promise<void> {
  const normalized = normalizePath(path);
  if (!normalized) return;
  const index = await readActiveIndex();
  if (!index[normalized]) return;
  const removed = index[normalized];
  delete index[normalized];
  await writeActiveIndex(index).catch(() => undefined);
  const removedBaseline = removed.baseline;
  if (
    removedBaseline.kind === 'stored' &&
    !Object.values(index).some(
      (record) =>
        record.baseline.kind === 'stored' &&
        record.baseline.storagePath === removedBaseline.storagePath,
    )
  ) {
    const { workspace } = await import('../workspace/FileSystemWorkspace');
    await workspace.deleteCottagePath(removedBaseline.storagePath).catch(() => undefined);
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('cottage:ai-changes-updated'));
  }
}
