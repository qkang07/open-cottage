import { workspace } from '../workspace/FileSystemWorkspace';
import { hashBytes } from '../history/storage';
import { DEFAULT_COTTAGE_CONFIG } from '../config/constants';
import { getCottageConfig } from '../config/store';

interface CheckpointEntry {
  path: string;
  state: 'missing' | 'file' | 'directory';
  objectId?: string;
  size?: number;
  modified?: number;
}

export interface PlanStepCheckpoint {
  schema: 1;
  planId: string;
  stepId: string;
  entries: CheckpointEntry[];
  createdAt: number;
  updatedAt: number;
}

export interface CheckpointObjectIndexEntry {
  objectId: string;
  refCount: number;
  size: number;
  integrity: 'ok' | 'missing' | 'corrupt';
}

export interface CheckpointObjectIndex {
  schema: 1;
  planId: string;
  entries: CheckpointObjectIndexEntry[];
  totalBytes: number;
  updatedAt: number;
}

const split = (path: string) => path.replace(/\\/g, '/').split('/').filter(Boolean);

const getCheckpointRoot = async (
  planId: string,
  create: boolean,
): Promise<FileSystemDirectoryHandle | null> => {
  let dir = await workspace.ensureCottageDir();
  try {
    for (const segment of ['plans', 'v1', planId, 'checkpoints']) {
      dir = await dir.getDirectoryHandle(segment, { create });
    }
    return dir;
  } catch {
    return null;
  }
};

const writeObject = async (
  planId: string,
  objectId: string,
  bytes: Uint8Array,
): Promise<void> => {
  let dir = await getCheckpointRoot(planId, true);
  if (!dir) throw new Error('无法创建计划检查点目录');
  dir = await dir.getDirectoryHandle('objects', { create: true });
  dir = await dir.getDirectoryHandle(objectId.slice(0, 2), { create: true });
  const handle = await dir.getFileHandle(objectId, { create: true });
  const current = await handle.getFile();
  if (current.size === bytes.byteLength) {
    const existing = new Uint8Array(await current.arrayBuffer());
    if ((await hashBytes(existing)) === objectId) return;
  }
  const writable = await handle.createWritable();
  await writable.write(bytes);
  await writable.close();
};

const readObject = async (
  planId: string,
  objectId: string,
): Promise<Uint8Array | null> => {
  let dir = await getCheckpointRoot(planId, false);
  if (!dir) return null;
  try {
    dir = await dir.getDirectoryHandle('objects');
    dir = await dir.getDirectoryHandle(objectId.slice(0, 2));
    const handle = await dir.getFileHandle(objectId);
    return new Uint8Array(await (await handle.getFile()).arrayBuffer());
  } catch {
    return null;
  }
};

const checkpointPath = (planId: string, stepId: string) =>
  `plans/v1/${planId}/checkpoints/${stepId}.json`;

export const loadPlanStepCheckpoint = (
  planId: string,
  stepId: string,
): Promise<PlanStepCheckpoint | null> =>
  workspace.readCottagePath<PlanStepCheckpoint>(checkpointPath(planId, stepId));

const objectIndexPath = (planId: string) =>
  `plans/v1/${planId}/checkpoints/object-index.json`;

const listPlanCheckpoints = async (planId: string) => {
  const files = await workspace
    .listCottageFiles(`plans/v1/${planId}/checkpoints`)
    .catch(() => []);
  return (
    await Promise.all(
      files
        .filter(
          (path) =>
            path.endsWith('.json') &&
            !path.endsWith('/object-index.json'),
        )
        .map((path) => workspace.readCottagePath<PlanStepCheckpoint>(path)),
    )
  ).filter((item): item is PlanStepCheckpoint => Boolean(item?.stepId));
};

export const rebuildCheckpointObjectIndex = async (
  planId: string,
  persist = true,
): Promise<CheckpointObjectIndex> => {
  const checkpoints = await listPlanCheckpoints(planId);
  const refs = new Map<string, { refCount: number; size: number }>();
  for (const entry of checkpoints.flatMap((checkpoint) => checkpoint.entries)) {
    if (!entry.objectId) continue;
    const current = refs.get(entry.objectId) ?? { refCount: 0, size: entry.size ?? 0 };
    current.refCount += 1;
    current.size = Math.max(current.size, entry.size ?? 0);
    refs.set(entry.objectId, current);
  }
  const entries: CheckpointObjectIndexEntry[] = [];
  for (const [objectId, ref] of refs) {
    const bytes = await readObject(planId, objectId);
    entries.push({
      objectId,
      refCount: ref.refCount,
      size: ref.size,
      integrity: !bytes
        ? 'missing'
        : (await hashBytes(bytes)) === objectId
          ? 'ok'
          : 'corrupt',
    });
  }
  const index: CheckpointObjectIndex = {
    schema: 1,
    planId,
    entries,
    totalBytes: entries.reduce((sum, entry) => sum + entry.size, 0),
    updatedAt: Date.now(),
  };
  if (persist) await workspace.writeCottagePath(objectIndexPath(planId), index);
  return index;
};

const removeCheckpointObject = async (planId: string, objectId: string) => {
  let dir = await getCheckpointRoot(planId, false);
  if (!dir) return false;
  try {
    dir = await dir.getDirectoryHandle('objects');
    dir = await dir.getDirectoryHandle(objectId.slice(0, 2));
    await dir.removeEntry(objectId);
    return true;
  } catch {
    return false;
  }
};

export const garbageCollectCheckpointObjects = async (planId: string) => {
  const checkpoints = await listPlanCheckpoints(planId);
  const referenced = new Set(
    checkpoints.flatMap((checkpoint) =>
      checkpoint.entries.flatMap((entry) => (entry.objectId ? [entry.objectId] : [])),
    ),
  );
  const files = await workspace
    .listCottageFiles(`plans/v1/${planId}/checkpoints/objects`)
    .catch(() => []);
  const removed: string[] = [];
  for (const path of files) {
    const objectId = path.split('/').at(-1);
    if (!objectId || referenced.has(objectId)) continue;
    if (await removeCheckpointObject(planId, objectId)) removed.push(objectId);
  }
  const index = await rebuildCheckpointObjectIndex(planId);
  return { removed, index };
};

export const deletePlanStepCheckpoint = async (planId: string, stepId: string) => {
  const root = await getCheckpointRoot(planId, false);
  if (!root) return { deleted: false, removedObjects: [] as string[] };
  try {
    await root.removeEntry(`${stepId}.json`);
  } catch {
    return { deleted: false, removedObjects: [] as string[] };
  }
  const gc = await garbageCollectCheckpointObjects(planId);
  return { deleted: true, removedObjects: gc.removed };
};

const checkpointLimits = () => {
  const defaults = DEFAULT_COTTAGE_CONFIG.history?.limits;
  const current = getCottageConfig().history?.limits;
  return {
    maxFileBytes: current?.maxFileBytes ?? defaults?.maxFileBytes ?? 20 * 1024 * 1024,
    maxStepBytes: Math.min(
      current?.maxPoolBytes ?? defaults?.maxPoolBytes ?? 500 * 1024 * 1024,
      100 * 1024 * 1024,
    ),
    maxPlanBytes:
      current?.maxPoolBytes ?? defaults?.maxPoolBytes ?? 500 * 1024 * 1024,
  };
};

const captureFile = async (
  planId: string,
  path: string,
): Promise<CheckpointEntry> => {
  const stat = await workspace.statFile(path);
  const limits = checkpointLimits();
  if (stat && stat.size > limits.maxFileBytes) {
    throw new Error(`文件超过单文件检查点上限，已阻止写入：${path}`);
  }
  const bytes = await workspace.readFileBytes(path);
  const objectId = await hashBytes(bytes);
  await writeObject(planId, objectId, bytes);
  return {
    path,
    state: 'file',
    objectId,
    size: bytes.byteLength,
    modified: stat?.modified,
  };
};

const capturePath = async (
  planId: string,
  path: string,
): Promise<CheckpointEntry[]> => {
  const kind = await workspace.getEntryKind(path);
  if (!kind) return [{ path, state: 'missing' }];
  if (kind === 'file') return [await captureFile(planId, path)];
  const files = await workspace.listFiles(path, { skipIgnoredDirs: false });
  const entries: CheckpointEntry[] = [{ path, state: 'directory' }];
  for (const file of files) entries.push(await captureFile(planId, file));
  return entries;
};

export const capturePlanStepPaths = async (
  planId: string,
  stepId: string,
  paths: readonly string[],
): Promise<PlanStepCheckpoint> => {
  const existing = await loadPlanStepCheckpoint(planId, stepId);
  const byPath = new Map((existing?.entries ?? []).map((entry) => [entry.path, entry]));
  for (const path of [...new Set(paths)]) {
    if (byPath.has(path)) continue;
    for (const entry of await capturePath(planId, path)) {
      if (!byPath.has(entry.path)) byPath.set(entry.path, entry);
    }
  }
  const totalBytes = [...byPath.values()].reduce((sum, entry) => sum + (entry.size ?? 0), 0);
  if (totalBytes > checkpointLimits().maxStepBytes) {
    await garbageCollectCheckpointObjects(planId);
    throw new Error('步骤检查点超过容量上限，已阻止继续写入；请缩小步骤或路径范围');
  }
  const checkpointFiles = await workspace
    .listCottageFiles(`plans/v1/${planId}/checkpoints`)
    .catch(() => []);
  const otherCheckpoints = (
    await Promise.all(
      checkpointFiles
        .filter(
          (path) =>
            path.endsWith('.json') &&
            !path.endsWith('/object-index.json') &&
            !path.endsWith(`/${stepId}.json`),
        )
        .map((path) => workspace.readCottagePath<PlanStepCheckpoint>(path)),
    )
  ).filter((item): item is PlanStepCheckpoint => Boolean(item));
  const uniqueObjects = new Map<string, number>();
  for (const entry of [
    ...otherCheckpoints.flatMap((item) => item.entries),
    ...byPath.values(),
  ]) {
    if (entry.objectId) uniqueObjects.set(entry.objectId, entry.size ?? 0);
  }
  const planBytes = [...uniqueObjects.values()].reduce((sum, size) => sum + size, 0);
  if (planBytes > checkpointLimits().maxPlanBytes) {
    await garbageCollectCheckpointObjects(planId);
    throw new Error('计划检查点总量超过工作区历史配额，已阻止继续写入');
  }
  const now = Date.now();
  const checkpoint: PlanStepCheckpoint = {
    schema: 1,
    planId,
    stepId,
    entries: [...byPath.values()],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await workspace.writeCottagePath(checkpointPath(planId, stepId), checkpoint);
  await rebuildCheckpointObjectIndex(planId);
  return checkpoint;
};

export const restorePlanStepCheckpoint = async (
  planId: string,
  stepId: string,
): Promise<string[]> => {
  const checkpoint = await loadPlanStepCheckpoint(planId, stepId);
  if (!checkpoint) throw new Error('没有可恢复的步骤检查点');
  const objectBytes = new Map<string, Uint8Array>();
  for (const entry of checkpoint.entries) {
    if (entry.state !== 'file' || !entry.objectId || objectBytes.has(entry.objectId)) continue;
    const bytes = await readObject(planId, entry.objectId);
    if (!bytes || (await hashBytes(bytes)) !== entry.objectId) {
      throw new Error(`检查点对象损坏：${entry.path}`);
    }
    objectBytes.set(entry.objectId, bytes);
  }
  const roots = checkpoint.entries.filter((entry) =>
    !checkpoint.entries.some(
      (other) => other.path !== entry.path && entry.path.startsWith(`${other.path}/`),
    ),
  );
  for (const root of roots) {
    if (await workspace.exists(root.path)) await workspace.deleteEntry(root.path);
  }
  const directories = checkpoint.entries
    .filter((entry) => entry.state === 'directory')
    .sort((a, b) => split(a.path).length - split(b.path).length);
  for (const entry of directories) await workspace.mkdir(entry.path);
  for (const entry of checkpoint.entries) {
    if (entry.state !== 'file' || !entry.objectId) continue;
    const bytes = objectBytes.get(entry.objectId)!;
    await workspace.writeFileBytes(entry.path, bytes);
  }
  return roots.map((entry) => entry.path);
};

export interface CheckpointRestorePreview {
  create: string[];
  overwrite: string[];
  delete: string[];
  move: Array<{ from: string; to: string }>;
}

export const previewPlanStepCheckpoint = async (
  planId: string,
  stepId: string,
): Promise<CheckpointRestorePreview> => {
  const checkpoint = await loadPlanStepCheckpoint(planId, stepId);
  if (!checkpoint) throw new Error('没有可恢复的步骤检查点');
  const preview: CheckpointRestorePreview = {
    create: [],
    overwrite: [],
    delete: [],
    move: [],
  };
  for (const entry of checkpoint.entries) {
    const exists = await workspace.exists(entry.path);
    if (entry.state === 'missing') {
      if (exists) preview.delete.push(entry.path);
    } else if (exists) {
      if (entry.state === 'file') preview.overwrite.push(entry.path);
    } else {
      preview.create.push(entry.path);
    }
  }
  return preview;
};
