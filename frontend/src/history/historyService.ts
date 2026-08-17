import {
  DEFAULT_COTTAGE_CONFIG,
  DEFAULT_HISTORY_IGNORE_GLOBS,
} from '../config/constants';
import { getCottageConfig } from '../config/store';
import { workspace } from '../workspace/FileSystemWorkspace';
import { isLikelyTextPath } from '../workspace/search';
import { buildIgnoreGlobs, filterTrackedFiles } from './ignore';
import {
  deleteHistoryObject,
  deleteHistoryPath,
  ensureHistoryObject,
  hashBytes,
  historyFileSize,
  historyV2Exists,
  listHistoryFiles,
  readHistoryJson,
  readHistoryObject,
  writeHistoryJson,
} from './storage';
import {
  HISTORY_SCHEMA_VERSION,
  type HistoryBase,
  type HistoryCleanupEntry,
  type HistoryChangeType,
  type HistoryDeleteResult,
  type HistoryFileState,
  type HistoryFileSummary,
  type HistoryFileVersionSummary,
  type HistoryIndex,
  type HistoryMeta,
  type HistoryPoolStats,
  type HistorySnapshot,
  type HistoryVersion,
  type HistoryVersionSource,
  type HistoryVersionSummary,
  type StoredHistoryFile,
} from './types';

const BASE_PATH = 'base.json';
const INDEX_PATH = 'index.json';
const META_PATH = 'meta.json';
const versionPath = (id: string) => `versions/${id}.json`;

const DEFAULT_META: HistoryMeta = {
  schema: HISTORY_SCHEMA_VERSION,
  status: 'disabled',
  lastVersionAt: null,
  cleanupLog: [],
};

let operationQueue: Promise<unknown> = Promise.resolve();
let mutationSuppressionDepth = 0;

const withLock = async <T>(operation: () => Promise<T>): Promise<T> => {
  const next = operationQueue.then(operation, operation);
  operationQueue = next.then(() => undefined, () => undefined);
  return next;
};

export const isHistoryMutationSuppressed = () => mutationSuppressionDepth > 0;

const suppressWorkspaceMutationTracking = async <T>(
  operation: () => Promise<T>,
): Promise<T> => {
  mutationSuppressionDepth += 1;
  try {
    return await operation();
  } finally {
    mutationSuppressionDepth -= 1;
  }
};

interface ResolvedHistoryConfig {
  enabled: boolean;
  autoCheckpoint: boolean;
  manualEditDebounceMs: number;
  trackGlobs: string[];
  ignoreGlobs: string[];
  maxTrackedFiles: number;
  limits: {
    maxFileBytes: number;
    maxBytesPerFile: number;
    maxPoolBytes: number;
  };
}

const historyConfig = (): ResolvedHistoryConfig => {
  const defaults = DEFAULT_COTTAGE_CONFIG.history;
  const current = getCottageConfig().history ?? {};
  return {
    enabled: current.enabled ?? defaults.enabled ?? false,
    autoCheckpoint: current.autoCheckpoint ?? defaults.autoCheckpoint ?? true,
    manualEditDebounceMs:
      current.manualEditDebounceMs ?? defaults.manualEditDebounceMs ?? 1500,
    trackGlobs: current.trackGlobs ?? defaults.trackGlobs ?? ['**'],
    ignoreGlobs:
      current.ignoreGlobs ?? defaults.ignoreGlobs ?? DEFAULT_HISTORY_IGNORE_GLOBS,
    maxTrackedFiles: current.maxTrackedFiles ?? defaults.maxTrackedFiles ?? 10000,
    limits: {
      maxFileBytes:
        current.limits?.maxFileBytes ?? defaults.limits?.maxFileBytes ?? 20 * 1024 * 1024,
      maxBytesPerFile:
        current.limits?.maxBytesPerFile ??
        defaults.limits?.maxBytesPerFile ??
        100 * 1024 * 1024,
      maxPoolBytes:
        current.limits?.maxPoolBytes ??
        defaults.limits?.maxPoolBytes ??
        500 * 1024 * 1024,
    },
  };
};

const trackedPaths = (paths: string[]): string[] => {
  const config = historyConfig();
  return filterTrackedFiles(
    [...new Set(paths.map((path) => path.replace(/\\/g, '/')).filter(Boolean))],
    config.trackGlobs,
    buildIgnoreGlobs(config.ignoreGlobs),
  ).filter((path) => path !== '.cottage' && !path.startsWith('.cottage/'));
};

const readBase = () => readHistoryJson<HistoryBase>(BASE_PATH);
const readVersion = (id: string) =>
  readHistoryJson<HistoryVersion>(versionPath(id));

async function loadVersions(index: HistoryIndex): Promise<HistoryVersion[]> {
  const versions = await Promise.all(index.versionIds.map(readVersion));
  return versions.filter((version): version is HistoryVersion => Boolean(version));
}

async function rebuildIndex(base: HistoryBase | null): Promise<HistoryIndex> {
  const files = await listHistoryFiles('versions');
  const versions = (
    await Promise.all(
      files
        .filter((path) => path.endsWith('.json'))
        .map((path) => readHistoryJson<HistoryVersion>(path)),
    )
  )
    .filter((version): version is HistoryVersion => Boolean(version))
    .sort((a, b) => a.at - b.at);
  const index: HistoryIndex = {
    schema: HISTORY_SCHEMA_VERSION,
    baseId: base?.id ?? null,
    versionIds: versions.map((version) => version.id),
    fileHistory: {},
    objectRefs: {},
    cachedUsage: {
      objectBytes: 0,
      textBytes: 0,
      binaryBytes: 0,
      fileCount: 0,
    },
    updatedAt: Date.now(),
  };
  await saveIndex(index);
  return index;
}

async function readIndex(base?: HistoryBase | null): Promise<HistoryIndex> {
  const resolvedBase = base === undefined ? await readBase() : base;
  const index = await readHistoryJson<HistoryIndex>(INDEX_PATH);
  if (
    index?.schema === HISTORY_SCHEMA_VERSION &&
    index.baseId === (resolvedBase?.id ?? null) &&
    index.fileHistory &&
    index.objectRefs &&
    index.cachedUsage
  ) {
    const [records, diskFiles] = await Promise.all([
      Promise.all(index.versionIds.map(readVersion)),
      listHistoryFiles('versions'),
    ]);
    const diskIds = diskFiles
      .filter((path) => path.endsWith('.json'))
      .map((path) => path.split('/').at(-1)!.replace(/\.json$/, ''))
      .sort();
    const indexedIds = [...index.versionIds].sort();
    if (
      records.every(Boolean) &&
      diskIds.length === indexedIds.length &&
      diskIds.every((id, position) => id === indexedIds[position])
    ) {
      return index;
    }
  }
  return rebuildIndex(resolvedBase);
}

const saveIndex = async (index: HistoryIndex) => {
  const base = await readBase();
  const versions = await loadVersions(index);
  const fileHistory: Record<string, string[]> = {};
  const objectRefs: HistoryIndex['objectRefs'] = {};
  const visit = (recordId: string, files: Record<string, HistoryFileState>) => {
    for (const [path, state] of Object.entries(files)) {
      (fileHistory[path] ??= []).push(recordId);
      if (state.state !== 'stored') continue;
      const current = objectRefs[state.objectId];
      objectRefs[state.objectId] = {
        count: (current?.count ?? 0) + 1,
        size: state.size,
        binary: Boolean(current?.binary || state.binary),
      };
    }
  };
  if (base) visit(base.id, base.files);
  versions.forEach((version) => visit(version.id, version.changes));
  const objects = Object.values(objectRefs);
  index.fileHistory = fileHistory;
  index.objectRefs = objectRefs;
  index.cachedUsage = {
    objectBytes: objects.reduce((sum, ref) => sum + ref.size, 0),
    textBytes: objects
      .filter((ref) => !ref.binary)
      .reduce((sum, ref) => sum + ref.size, 0),
    binaryBytes: objects
      .filter((ref) => ref.binary)
      .reduce((sum, ref) => sum + ref.size, 0),
    fileCount: Object.keys(fileHistory).length,
  };
  index.updatedAt = Date.now();
  await writeHistoryJson(INDEX_PATH, index);
};

export async function loadHistoryMeta(): Promise<HistoryMeta> {
  if (!(await historyV2Exists())) {
    return { ...DEFAULT_META };
  }
  return (await readHistoryJson<HistoryMeta>(META_PATH)) ?? { ...DEFAULT_META };
}

const saveMeta = (meta: HistoryMeta) => writeHistoryJson(META_PATH, meta);

const appendCleanup = async (entry: HistoryCleanupEntry) => {
  const meta = await loadHistoryMeta();
  meta.cleanupLog = [...meta.cleanupLog, entry].slice(-50);
  await saveMeta(meta);
};

function applyChanges(
  files: Map<string, HistoryFileState>,
  changes: Record<string, HistoryFileState>,
) {
  for (const [path, state] of Object.entries(changes)) {
    if (state.state === 'deleted') files.delete(path);
    else files.set(path, state);
  }
}

async function snapshotAtUnlocked(versionId?: string): Promise<HistorySnapshot | null> {
  const base = await readBase();
  if (!base) return null;
  const index = await readIndex(base);
  const versions = await loadVersions(index);
  const files = new Map(Object.entries(base.files));
  const baseSummary = summarizeVersion(base, files, true);
  if (!versionId || versionId === base.id) {
    if (!versionId && versions.length) {
      for (const version of versions) applyChanges(files, version.changes);
      return {
        version: summarizeVersion(versions.at(-1)!, files, false),
        files,
      };
    }
    return { version: baseSummary, files };
  }
  for (const version of versions) {
    applyChanges(files, version.changes);
    if (version.id === versionId) {
      return { version: summarizeVersion(version, files, false), files };
    }
  }
  return null;
}

export const loadHistorySnapshot = (versionId?: string) =>
  withLock(() => snapshotAtUnlocked(versionId));

function summarizeVersion(
  version: HistoryBase | HistoryVersion,
  files: Map<string, HistoryFileState>,
  isBase: boolean,
): HistoryVersionSummary {
  const unavailableCount = [...files.values()].filter(
    (state) => state.state === 'unavailable',
  ).length;
  const versionFiles = 'files' in version ? version.files : version.changes;
  const renamedFrom: Record<string, string> = {};
  for (const [path, state] of Object.entries(versionFiles)) {
    if (state.state === 'stored' && state.renamedFrom) {
      renamedFrom[path] = state.renamedFrom;
    }
  }
  return {
    id: version.id,
    at: version.at,
    source: version.source,
    label: version.label,
    changedPaths: Object.keys(versionFiles),
    changeTypes:
      version.changeTypes ??
      Object.fromEntries(
        Object.entries(versionFiles).map(
          ([path, state]) => [path, state.state === 'deleted' ? 'deleted' : 'modified'],
        ),
      ),
    renamedFrom: Object.keys(renamedFrom).length ? renamedFrom : undefined,
    complete: unavailableCount === 0,
    unavailableCount,
    isBase,
  };
}

export async function listHistoryVersions(): Promise<HistoryVersionSummary[]> {
  return withLock(async () => {
    const base = await readBase();
    if (!base) return [];
    const index = await readIndex(base);
    const versions = await loadVersions(index);
    const files = new Map(Object.entries(base.files));
    const summaries = [summarizeVersion(base, files, true)];
    for (const version of versions) {
      applyChanges(files, version.changes);
      summaries.push(summarizeVersion(version, files, false));
    }
    return summaries.reverse();
  });
}

const sameState = (a: HistoryFileState | undefined, b: HistoryFileState) => {
  if (!a || a.state !== b.state) return false;
  if (a.state === 'deleted' || b.state === 'deleted') return a.state === b.state;
  if (a.state === 'stored' && b.state === 'stored') return a.objectId === b.objectId;
  return (
    a.state === 'unavailable' &&
    b.state === 'unavailable' &&
    a.reason === b.reason &&
    a.size === b.size &&
    a.modified === b.modified
  );
};

async function captureFile(path: string): Promise<HistoryFileState> {
  const stat = await workspace.statFile(path);
  if (!stat) return { state: 'deleted' };
  const binary = !isLikelyTextPath(path);
  if (stat.size > historyConfig().limits.maxFileBytes) {
    return {
      state: 'unavailable',
      reason: 'oversize',
      size: stat.size,
      modified: stat.modified,
      binary,
    };
  }
  try {
    const bytes = await workspace.readFileBytes(path);
    const objectId = await hashBytes(bytes);
    await ensureHistoryObject(objectId, bytes);
    return {
      state: 'stored',
      objectId,
      size: bytes.byteLength,
      modified: stat.modified,
      binary,
    };
  } catch {
    return {
      state: 'unavailable',
      reason: 'storage-error',
      size: stat.size,
      modified: stat.modified,
      binary,
    };
  }
}

async function expandedMutationPaths(paths: string[]): Promise<string[]> {
  const normalized = trackedPaths(paths);
  const current = trackedPaths(await workspace.listFiles());
  const latest = await snapshotAtUnlocked();
  const known = [...(latest?.files.keys() ?? [])];
  const result = new Set<string>();
  for (const path of normalized) {
    const matches = [...current, ...known].filter(
      (candidate) => candidate === path || candidate.startsWith(`${path}/`),
    );
    if (matches.length) matches.forEach((candidate) => result.add(candidate));
    else result.add(path);
  }
  return [...result].sort();
}

interface CaptureOptions {
  force?: boolean;
  skipLimits?: boolean;
  allowWhenPaused?: boolean;
}

async function captureVersionUnlocked(
  paths: string[],
  label: string,
  source: HistoryVersionSource,
  options: CaptureOptions = {},
): Promise<string | null> {
  if (!historyConfig().enabled || !workspace.isOpen) return null;
  const initialMeta = await loadHistoryMeta();
  if (!options.allowWhenPaused && initialMeta.status === 'error') return null;
  if (!options.allowWhenPaused && initialMeta.status === 'paused') {
    await resumeCaptureIfPossibleUnlocked();
    if ((await loadHistoryMeta()).status === 'paused') return null;
  }
  const currentTrackedCount = trackedPaths(await workspace.listFiles()).length;
  if (!options.allowWhenPaused && currentTrackedCount > historyConfig().maxTrackedFiles) {
    const meta = await loadHistoryMeta();
    await saveMeta({
      ...meta,
      schema: HISTORY_SCHEMA_VERSION,
      status: 'paused',
      error: `可追踪文件数 ${currentTrackedCount} 超过上限 ${historyConfig().maxTrackedFiles}`,
    });
    return null;
  }
  const expanded = await expandedMutationPaths(paths);
  if (!expanded.length && !options.force) return null;
  const latest = await snapshotAtUnlocked();
  const previousFiles = latest?.files ?? new Map<string, HistoryFileState>();
  const changes: Record<string, HistoryFileState> = {};
  const changeTypes: Record<string, HistoryChangeType> = {};
  for (const path of expanded) {
    const state = await captureFile(path);
    const previous = previousFiles.get(path);
    if (!sameState(previous, state)) {
      changes[path] = state;
      changeTypes[path] =
        state.state === 'deleted'
          ? 'deleted'
          : previous === undefined || previous.state === 'deleted'
            ? 'added'
            : 'modified';
    }
  }

  // 检测重命名：删除的文件和新增的文件具有相同的内容哈希
  const addedObjects = new Map<string, string>();
  for (const [path, state] of Object.entries(changes)) {
    if (changeTypes[path] === 'added' && state.state === 'stored') {
      addedObjects.set(state.objectId, path);
    }
  }
  for (const [path, state] of Object.entries(changes)) {
    if (changeTypes[path] !== 'deleted') continue;
    const previous = previousFiles.get(path);
    if (previous?.state !== 'stored') continue;
    const newPath = addedObjects.get(previous.objectId);
    if (newPath) {
      const newState = changes[newPath];
      if (newState?.state === 'stored') {
        changes[newPath] = { ...newState, renamedFrom: path };
        changeTypes[newPath] = 'renamed';
        delete changes[path];
        delete changeTypes[path];
        addedObjects.delete(previous.objectId);
      }
    }
  }

  if (!Object.keys(changes).length && !options.force) return latest?.version.id ?? null;

  const record = {
    schema: HISTORY_SCHEMA_VERSION,
    id: crypto.randomUUID(),
    at: Date.now(),
    source,
    label,
  } as const;
  const base = await readBase();
  if (!base) {
    const nextBase: HistoryBase = { ...record, files: changes, changeTypes };
    await writeHistoryJson(BASE_PATH, nextBase);
    await saveIndex({
      schema: HISTORY_SCHEMA_VERSION,
      baseId: nextBase.id,
      versionIds: [],
      fileHistory: {},
      objectRefs: {},
      cachedUsage: {
        objectBytes: 0,
        textBytes: 0,
        binaryBytes: 0,
        fileCount: 0,
      },
      updatedAt: Date.now(),
    });
  } else {
    const version: HistoryVersion = { ...record, changes, changeTypes };
    await writeHistoryJson(versionPath(version.id), version);
    const index = await readIndex(base);
    index.versionIds.push(version.id);
    await saveIndex(index);
  }
  const meta = await loadHistoryMeta();
  await saveMeta({
    ...meta,
    schema: HISTORY_SCHEMA_VERSION,
    status: 'ready',
    lastVersionAt: record.at,
    error: undefined,
  });
  if (!options.skipLimits) await enforceLimitsUnlocked();
  return record.id;
}

export function captureHistoryVersion(
  paths: string[],
  label: string,
  source: HistoryVersionSource,
  options?: CaptureOptions,
): Promise<string | null> {
  return withLock(() => captureVersionUnlocked(paths, label, source, options));
}

export function createManualCheckpoint(
  label: string,
  force = false,
): Promise<string | null> {
  return withLock(async () => {
    const files = trackedPaths(await workspace.listFiles());
    const latest = await snapshotAtUnlocked();
    const paths = [...new Set([...files, ...(latest?.files.keys() ?? [])])];
    return captureVersionUnlocked(paths, label, 'manual', { force });
  });
}

async function detectExternalChangesUnlocked(): Promise<void> {
  const current = trackedPaths(await workspace.listFiles());
  const latest = await snapshotAtUnlocked();
  if (!latest) {
    await captureVersionUnlocked(current, '初始版本', 'initial', { force: true });
    return;
  }
  const candidates = new Set<string>();
  const currentSet = new Set(current);
  for (const path of current) {
    const stat = await workspace.statFile(path);
    const known = latest.files.get(path);
    if (!known || known.state !== 'stored' || !stat) {
      candidates.add(path);
      continue;
    }
    if (known.size !== stat.size || known.modified !== stat.modified) candidates.add(path);
  }
  for (const path of latest.files.keys()) {
    if (!currentSet.has(path)) candidates.add(path);
  }
  if (candidates.size) {
    await captureVersionUnlocked([...candidates], '检测到工作区外部修改', 'external');
  }
}

export function initializeHistory(): Promise<HistoryMeta> {
  return withLock(async () => {
    if (!historyConfig().enabled || !workspace.isOpen) return { ...DEFAULT_META };
    const files = trackedPaths(await workspace.listFiles());
    if (files.length > historyConfig().maxTrackedFiles) {
      const meta: HistoryMeta = {
        schema: HISTORY_SCHEMA_VERSION,
        status: 'paused',
        lastVersionAt: null,
        error: `可追踪文件数 ${files.length} 超过上限 ${historyConfig().maxTrackedFiles}`,
        cleanupLog: (await loadHistoryMeta()).cleanupLog,
      };
      await saveMeta(meta);
      return meta;
    }
    try {
      const previous = await loadHistoryMeta();
      await saveMeta({ ...previous, status: 'ready', error: undefined });
      await detectExternalChangesUnlocked();
      await enforceLimitsUnlocked();
      const meta = await loadHistoryMeta();
      if (meta.status === 'paused') return meta;
      const ready: HistoryMeta = { ...meta, status: 'ready', error: undefined };
      await saveMeta(ready);
      await garbageCollectUnlocked();
      return ready;
    } catch (error) {
      const failed: HistoryMeta = {
        schema: HISTORY_SCHEMA_VERSION,
        status: 'error',
        lastVersionAt: null,
        error: error instanceof Error ? error.message : String(error),
        cleanupLog: (await loadHistoryMeta()).cleanupLog,
      };
      await saveMeta(failed);
      return failed;
    }
  });
}

export function resetHistoryService(): void {
  operationQueue = Promise.resolve();
  mutationSuppressionDepth = 0;
}

async function allRecords() {
  const base = await readBase();
  const index = await readIndex(base);
  const versions = await loadVersions(index);
  return { base, index, versions };
}

function storedRefs(state: HistoryFileState | undefined): StoredHistoryFile[] {
  return state?.state === 'stored' ? [state] : [];
}

async function referencedObjects() {
  const { base, versions } = await allRecords();
  const refs = new Map<string, { count: number; size: number; binary: boolean }>();
  const visit = (state: HistoryFileState) => {
    for (const stored of storedRefs(state)) {
      const current = refs.get(stored.objectId);
      refs.set(stored.objectId, {
        count: (current?.count ?? 0) + 1,
        size: stored.size,
        binary: Boolean(current?.binary || stored.binary),
      });
    }
  };
  if (base) Object.values(base.files).forEach(visit);
  versions.forEach((version) => Object.values(version.changes).forEach(visit));
  return refs;
}

async function garbageCollectUnlocked(): Promise<number> {
  const refs = await referencedObjects();
  let freed = 0;
  for (const path of await listHistoryFiles('objects')) {
    const objectId = path.split('/').at(-1)!;
    if (refs.has(objectId)) continue;
    freed += await historyFileSize(path);
    await deleteHistoryObject(objectId);
  }
  return freed;
}

export function garbageCollectHistory(): Promise<number> {
  return withLock(garbageCollectUnlocked);
}

async function poolStatsUnlocked(): Promise<HistoryPoolStats> {
  const refs = await referencedObjects();
  let objectBytes = 0;
  let textBytes = 0;
  let binaryBytes = 0;
  let metadataBytes = 0;
  let objectCount = 0;
  for (const path of await listHistoryFiles()) {
    const size = await historyFileSize(path);
    if (path.startsWith('objects/')) {
      objectBytes += size;
      objectCount += 1;
      const objectId = path.split('/').at(-1) ?? '';
      const ref = refs.get(objectId);
      if (ref?.binary) binaryBytes += size;
      else if (ref) textBytes += size;
    } else {
      metadataBytes += size;
    }
  }
  const files = await fileSummariesUnlocked();
  const versions = await versionSummariesUnlocked();
  return {
    objectBytes,
    metadataBytes,
    totalBytes: objectBytes + metadataBytes,
    textBytes,
    binaryBytes,
    objectCount,
    fileCount: files.length,
    versionCount: versions.length,
    limitBytes: historyConfig().limits.maxPoolBytes,
  };
}

async function resumeCaptureIfPossibleUnlocked(): Promise<void> {
  const meta = await loadHistoryMeta();
  if (meta.status !== 'paused') return;
  const trackedCount = trackedPaths(await workspace.listFiles()).length;
  const stats = await poolStatsUnlocked();
  if (
    trackedCount <= historyConfig().maxTrackedFiles &&
    stats.totalBytes <= historyConfig().limits.maxPoolBytes
  ) {
    await saveMeta({ ...meta, status: 'ready', error: undefined });
  }
}

export function getHistoryPoolStats(): Promise<HistoryPoolStats> {
  return withLock(poolStatsUnlocked);
}

async function versionSummariesUnlocked(): Promise<HistoryVersionSummary[]> {
  const base = await readBase();
  if (!base) return [];
  const index = await readIndex(base);
  const versions = await loadVersions(index);
  const files = new Map(Object.entries(base.files));
  const result = [summarizeVersion(base, files, true)];
  for (const version of versions) {
    applyChanges(files, version.changes);
    result.push(summarizeVersion(version, files, false));
  }
  return result.reverse();
}

async function fileVersionsUnlocked(path: string): Promise<HistoryFileVersionSummary[]> {
  const { base, versions } = await allRecords();
  const result: HistoryFileVersionSummary[] = [];
  if (base?.files[path]) {
    const state = base.files[path];
    result.push({
      versionId: base.id,
      at: base.at,
      source: base.source,
      label: base.label,
      path,
      state,
      restorable: state.state !== 'unavailable',
    });
  }
  for (const version of versions) {
    const state = version.changes[path];
    if (!state) continue;
    result.push({
      versionId: version.id,
      at: version.at,
      source: version.source,
      label: version.label,
      path,
      state,
      restorable: state.state !== 'unavailable',
    });
  }
  return result.reverse();
}

export function listFileHistory(path: string): Promise<HistoryFileVersionSummary[]> {
  return withLock(() => fileVersionsUnlocked(path));
}

async function fileSummariesUnlocked(): Promise<HistoryFileSummary[]> {
  const { base, versions } = await allRecords();
  const events = new Map<string, Array<{ at: number; state: HistoryFileState }>>();
  const add = (path: string, at: number, state: HistoryFileState) => {
    const list = events.get(path) ?? [];
    list.push({ at, state });
    events.set(path, list);
  };
  if (base) Object.entries(base.files).forEach(([path, state]) => add(path, base.at, state));
  versions.forEach((version) =>
    Object.entries(version.changes).forEach(([path, state]) => add(path, version.at, state)),
  );
  return [...events.entries()].map(([path, entries]) => {
    const objects = new Map<string, StoredHistoryFile>();
    entries.forEach(({ state }) => {
      if (state.state === 'stored') objects.set(state.objectId, state);
    });
    const latest = entries.at(-1)!;
    const latestKnown = [...entries]
      .reverse()
      .find(({ state }) => state.state !== 'deleted')?.state;
    return {
      path,
      binary: latestKnown?.state === 'stored' || latestKnown?.state === 'unavailable'
        ? latestKnown.binary
        : false,
      versions: entries.length,
      logicalBytes: [...objects.values()].reduce((sum, state) => sum + state.size, 0),
      latestAt: latest.at,
      unavailableVersions: entries.filter(({ state }) => state.state === 'unavailable').length,
    };
  });
}

export function listHistoryFilesSummary(): Promise<HistoryFileSummary[]> {
  return withLock(async () =>
    (await fileSummariesUnlocked()).sort((a, b) => b.logicalBytes - a.logicalBytes),
  );
}

async function writeStateForRevision(
  path: string,
  versionId: string,
  state: HistoryFileState,
): Promise<boolean> {
  const base = await readBase();
  if (base?.id === versionId && base.files[path]) {
    base.files[path] = state;
    await writeHistoryJson(BASE_PATH, base);
    await saveIndex(await readIndex(base));
    return true;
  }
  const version = await readVersion(versionId);
  if (!version?.changes[path]) return false;
  version.changes[path] = state;
  await writeHistoryJson(versionPath(version.id), version);
  await saveIndex(await readIndex(base));
  return true;
}

async function deleteFileRevisionUnlocked(
  path: string,
  versionId: string,
  reason: 'user-deleted' | 'quota-pruned',
): Promise<HistoryDeleteResult> {
  const revisions = await fileVersionsUnlocked(path);
  const target = revisions.find((revision) => revision.versionId === versionId);
  if (
    !target ||
    (target.state.state === 'unavailable' && target.state.reason === reason)
  ) {
    return { revisionsRemoved: 0, versionsRemoved: 0, logicalBytesRemoved: 0, bytesFreed: 0 };
  }
  const fileSummary = (await fileSummariesUnlocked()).find((file) => file.path === path);
  const replacement: HistoryFileState = {
    state: 'unavailable',
    reason,
    size: target.state.state === 'deleted' ? 0 : target.state.size,
    modified: target.state.state === 'deleted' ? target.at : target.state.modified,
    binary:
      target.state.state === 'deleted'
        ? (fileSummary?.binary ?? false)
        : target.state.binary,
  };
  await writeStateForRevision(path, versionId, replacement);
  const bytesFreed = await garbageCollectUnlocked();
  return {
    revisionsRemoved: 1,
    versionsRemoved: 0,
    logicalBytesRemoved: target.state.state === 'stored' ? target.state.size : 0,
    bytesFreed,
  };
}

export function deleteFileHistoryRevision(
  path: string,
  versionId: string,
): Promise<HistoryDeleteResult> {
  return withLock(async () => {
    const result = await deleteFileRevisionUnlocked(path, versionId, 'user-deleted');
    if (result.revisionsRemoved) {
      await appendCleanup({
        at: Date.now(),
        reason: 'manual',
        versionsRemoved: 0,
        revisionsRemoved: result.revisionsRemoved,
        bytesFreed: result.bytesFreed,
      });
      await resumeCaptureIfPossibleUnlocked();
    }
    return result;
  });
}

export function deleteAllFileHistory(path: string): Promise<HistoryDeleteResult> {
  return withLock(async () => {
    const revisions = await fileVersionsUnlocked(path);
    let revisionsRemoved = 0;
    let logicalBytesRemoved = 0;
    let bytesFreed = 0;
    for (const revision of revisions) {
      const result = await deleteFileRevisionUnlocked(
        path,
        revision.versionId,
        'user-deleted',
      );
      revisionsRemoved += result.revisionsRemoved;
      logicalBytesRemoved += result.logicalBytesRemoved;
      bytesFreed += result.bytesFreed;
    }
    bytesFreed += await garbageCollectUnlocked();
    if (revisionsRemoved) {
      await appendCleanup({
        at: Date.now(),
        reason: 'manual',
        versionsRemoved: 0,
        revisionsRemoved,
        bytesFreed,
      });
      await resumeCaptureIfPossibleUnlocked();
    }
    return { revisionsRemoved, versionsRemoved: 0, logicalBytesRemoved, bytesFreed };
  });
}

async function deleteVersionUnlocked(versionId: string): Promise<boolean> {
  const base = await readBase();
  if (!base) return false;
  const index = await readIndex(base);
  if (base.id === versionId) {
    const nextId = index.versionIds.shift();
    if (!nextId) {
      await deleteHistoryPath(BASE_PATH);
      index.baseId = null;
      await saveIndex(index);
      return true;
    }
    const next = await readVersion(nextId);
    if (!next) return false;
    const files = new Map(Object.entries(base.files));
    applyChanges(files, next.changes);
    const promoted: HistoryBase = {
      schema: HISTORY_SCHEMA_VERSION,
      id: next.id,
      at: next.at,
      source: next.source,
      label: next.label,
      files: Object.fromEntries(files),
      changeTypes: Object.fromEntries(
        [...files.keys()].map((path) => [path, 'added' as const]),
      ),
    };
    await writeHistoryJson(BASE_PATH, promoted);
    await deleteHistoryPath(versionPath(nextId));
    index.baseId = promoted.id;
    await saveIndex(index);
    return true;
  }
  const position = index.versionIds.indexOf(versionId);
  if (position < 0) return false;
  const target = await readVersion(versionId);
  const nextId = index.versionIds[position + 1];
  if (target && nextId) {
    const next = await readVersion(nextId);
    if (next) {
      const previousId = position > 0 ? index.versionIds[position - 1] : base.id;
      const previous = await snapshotAtUnlocked(previousId);
      next.changes = { ...target.changes, ...next.changes };
      next.changeTypes = Object.fromEntries(
        Object.entries(next.changes).map(([path, state]) => {
          const before = previous?.files.get(path);
          const type: HistoryChangeType =
            state.state === 'deleted'
              ? 'deleted'
              : before === undefined || before.state === 'deleted'
                ? 'added'
                : 'modified';
          return [path, type];
        }),
      );
      await writeHistoryJson(versionPath(next.id), next);
    }
  }
  index.versionIds.splice(position, 1);
  await deleteHistoryPath(versionPath(versionId));
  await saveIndex(index);
  return true;
}

export function deleteHistoryVersion(versionId: string): Promise<HistoryDeleteResult> {
  return withLock(async () => {
    const before = await poolStatsUnlocked();
    const removed = await deleteVersionUnlocked(versionId);
    const gc = removed ? await garbageCollectUnlocked() : 0;
    if (removed) {
      await appendCleanup({
        at: Date.now(),
        reason: 'manual',
        versionsRemoved: 1,
        revisionsRemoved: 0,
        bytesFreed: gc,
      });
      await resumeCaptureIfPossibleUnlocked();
    }
    const after = removed ? await poolStatsUnlocked() : before;
    return {
      revisionsRemoved: 0,
      versionsRemoved: removed ? 1 : 0,
      logicalBytesRemoved: Math.max(0, before.totalBytes - after.totalBytes),
      bytesFreed: gc,
    };
  });
}

async function enforceLimitsUnlocked(): Promise<void> {
  const config = historyConfig();
  const files = await fileSummariesUnlocked();
  let prunedRevisions = 0;
  let freed = 0;
  for (const file of files) {
    if (file.logicalBytes <= config.limits.maxBytesPerFile) continue;
    const revisions = (await fileVersionsUnlocked(file.path))
      .filter((revision) => revision.state.state === 'stored')
      .reverse();
    let total = file.logicalBytes;
    for (const revision of revisions.slice(0, -1)) {
      if (total <= config.limits.maxBytesPerFile) break;
      if (revision.state.state !== 'stored') continue;
      const result = await deleteFileRevisionUnlocked(
        file.path,
        revision.versionId,
        'quota-pruned',
      );
      total =
        (await fileSummariesUnlocked()).find((item) => item.path === file.path)
          ?.logicalBytes ?? 0;
      prunedRevisions += result.revisionsRemoved;
      freed += result.bytesFreed;
    }
  }
  if (prunedRevisions) {
    await appendCleanup({
      at: Date.now(),
      reason: 'file-limit',
      versionsRemoved: 0,
      revisionsRemoved: prunedRevisions,
      bytesFreed: freed,
    });
  }

  let stats = await poolStatsUnlocked();
  let versionsRemoved = 0;
  let poolBytesFreed = 0;
  while (stats.totalBytes > config.limits.maxPoolBytes) {
    const summaries = await versionSummariesUnlocked();
    if (summaries.length <= 1) break;
    const oldest = summaries.at(-1)!;
    if (!(await deleteVersionUnlocked(oldest.id))) break;
    versionsRemoved += 1;
    poolBytesFreed += await garbageCollectUnlocked();
    stats = await poolStatsUnlocked();
  }
  if (versionsRemoved) {
    poolBytesFreed += await garbageCollectUnlocked();
    await appendCleanup({
      at: Date.now(),
      reason: 'pool-limit',
      versionsRemoved,
      revisionsRemoved: 0,
      bytesFreed: poolBytesFreed,
    });
    stats = await poolStatsUnlocked();
  }
  if (stats.totalBytes > config.limits.maxPoolBytes) {
    const meta = await loadHistoryMeta();
    await saveMeta({
      ...meta,
      status: 'paused',
      error: '最新版本已超过历史池容量，已暂停创建新版本',
    });
  }
}

export function enforceHistoryLimits(): Promise<void> {
  return withLock(enforceLimitsUnlocked);
}

export async function readFileVersionBytes(
  versionId: string,
  path: string,
): Promise<Uint8Array | null> {
  return withLock(async () => {
    const snapshot = await snapshotAtUnlocked(versionId);
    const state = snapshot?.files.get(path);
    if (!state) return new Uint8Array();
    if (state.state !== 'stored') return null;
    return readHistoryObject(state.objectId);
  });
}

export async function readFileVersionText(
  versionId: string,
  path: string,
): Promise<string | null> {
  const bytes = await readFileVersionBytes(versionId, path);
  return bytes === null ? null : new TextDecoder().decode(bytes);
}

async function ensureRestorableCurrent(paths: string[]): Promise<void> {
  const limit = historyConfig().limits.maxFileBytes;
  for (const path of paths) {
    const stat = await workspace.statFile(path);
    if (stat && stat.size > limit) {
      throw new Error(
        `无法安全恢复：当前文件 ${path} 超过单文件保存上限。请先提高上限或自行备份该文件`,
      );
    }
  }
}

async function ensureProtectionVersion(
  versionId: string | null,
  existingPaths: string[],
): Promise<void> {
  if (!versionId) throw new Error('无法创建恢复前保护版本');
  const safety = await snapshotAtUnlocked(versionId);
  const unavailable = existingPaths.filter(
    (path) => safety?.files.get(path)?.state !== 'stored',
  );
  if (unavailable.length) {
    throw new Error(`恢复前保护版本不完整：${unavailable.join(', ')}`);
  }
}

async function recordRollbackFailure(paths: string[], cause: unknown) {
  const meta = await loadHistoryMeta();
  const detail = cause instanceof Error ? cause.message : String(cause);
  await saveMeta({
    ...meta,
    status: 'error',
    error: `恢复失败且回滚不完整：${paths.join(', ')}；${detail}`,
  });
}

export function restoreFile(versionId: string, path: string): Promise<boolean> {
  return withLock(async () => {
    const target = await snapshotAtUnlocked(versionId);
    const state = target?.files.get(path);
    if (!target || state?.state === 'unavailable') return false;
    await ensureRestorableCurrent([path]);
    const beforeExists = Boolean(await workspace.statFile(path));
    const before = beforeExists ? await workspace.readFileBytes(path) : null;
    const safetyId = await captureVersionUnlocked([path], `恢复 ${path} 前的保护版本`, 'restore', {
      force: true,
      skipLimits: true,
      allowWhenPaused: true,
    });
    await ensureProtectionVersion(safetyId, beforeExists ? [path] : []);
    try {
      await suppressWorkspaceMutationTracking(async () => {
        if (!state) await workspace.deleteFile(path).catch(() => undefined);
        else if (state.state === 'stored') {
          const bytes = await readHistoryObject(state.objectId);
          if (!bytes) throw new Error('历史内容已丢失');
          await workspace.writeFileBytes(path, bytes);
        }
      });
    } catch (error) {
      try {
        await suppressWorkspaceMutationTracking(async () => {
          if (before) await workspace.writeFileBytes(path, before);
          else await workspace.deleteFile(path).catch(() => undefined);
        });
      } catch (rollbackError) {
        await recordRollbackFailure([path], rollbackError);
        throw new Error(`恢复失败且 ${path} 回滚失败`, { cause: error });
      }
      throw error;
    }
    await captureVersionUnlocked([path], `恢复 ${path}`, 'restore', { force: true });
    return true;
  });
}

export function restoreTree(versionId: string): Promise<boolean> {
  return withLock(async () => {
    const target = await snapshotAtUnlocked(versionId);
    if (!target || !target.version.complete) return false;
    const currentPaths = trackedPaths(await workspace.listFiles());
    const targetPaths = trackedPaths([...target.files.keys()]);
    const targetPathSet = new Set(targetPaths);
    const affected = [...new Set([...currentPaths, ...targetPaths])];
    await ensureRestorableCurrent(affected);
    const before = new Map<string, Uint8Array>();
    for (const path of currentPaths) before.set(path, await workspace.readFileBytes(path));
    const safetyId = await captureVersionUnlocked(
      currentPaths,
      '恢复工作区前的保护版本',
      'restore',
      { force: true, skipLimits: true, allowWhenPaused: true },
    );
    await ensureProtectionVersion(safetyId, currentPaths);
    try {
      await suppressWorkspaceMutationTracking(async () => {
        for (const path of currentPaths) {
          if (!targetPathSet.has(path)) await workspace.deleteFile(path).catch(() => undefined);
        }
        for (const path of targetPaths) {
          const state = target.files.get(path)!;
          if (state.state !== 'stored') throw new Error(`版本中的 ${path} 不可恢复`);
          const bytes = await readHistoryObject(state.objectId);
          if (!bytes) throw new Error(`历史对象缺失：${path}`);
          await workspace.writeFileBytes(path, bytes);
        }
      });
    } catch (error) {
      const rollbackFailures: string[] = [];
      await suppressWorkspaceMutationTracking(async () => {
        const now = trackedPaths(await workspace.listFiles());
        for (const path of now) {
          if (before.has(path)) continue;
          try {
            await workspace.deleteFile(path);
          } catch {
            rollbackFailures.push(path);
          }
        }
        for (const [path, bytes] of before) {
          try {
            await workspace.writeFileBytes(path, bytes);
          } catch {
            rollbackFailures.push(path);
          }
        }
      });
      if (rollbackFailures.length) {
        await recordRollbackFailure(rollbackFailures, error);
        throw new Error(`工作区恢复失败且以下文件回滚失败：${rollbackFailures.join(', ')}`, {
          cause: error,
        });
      }
      throw error;
    }
    await captureVersionUnlocked(affected, `恢复到 ${target.version.label}`, 'restore', {
      force: true,
    });
    return true;
  });
}

export function isBinaryPath(path: string): boolean {
  return !isLikelyTextPath(path);
}
