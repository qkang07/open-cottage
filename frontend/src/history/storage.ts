import { workspace } from '../workspace/FileSystemWorkspace';

const V2_SEGMENTS = ['.cottage', 'history', 'v2'] as const;

const split = (path: string) =>
  path.replace(/\\/g, '/').split('/').filter(Boolean);

async function getV2Root(
  create: boolean,
): Promise<FileSystemDirectoryHandle | null> {
  let dir = workspace.rootHandle;
  if (!dir) return null;
  try {
    for (const segment of V2_SEGMENTS) {
      dir = await dir.getDirectoryHandle(segment, { create });
    }
    return dir;
  } catch {
    return null;
  }
}

async function resolveParent(
  path: string,
  create: boolean,
): Promise<{ dir: FileSystemDirectoryHandle; name: string } | null> {
  const root = await getV2Root(create);
  if (!root) return null;
  const parts = split(path);
  const name = parts.pop();
  if (!name) return null;
  let dir = root;
  try {
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create });
    }
    return { dir, name };
  } catch {
    return null;
  }
}

export async function historyV2Exists(): Promise<boolean> {
  return (await getV2Root(false)) !== null;
}

export async function readHistoryBytes(path: string): Promise<Uint8Array | null> {
  const resolved = await resolveParent(path, false);
  if (!resolved) return null;
  try {
    const handle = await resolved.dir.getFileHandle(resolved.name);
    const file = await handle.getFile();
    return new Uint8Array(await file.arrayBuffer());
  } catch {
    return null;
  }
}

export async function writeHistoryBytes(
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  const resolved = await resolveParent(path, true);
  if (!resolved) throw new Error(`无法创建历史存储路径：${path}`);
  const handle = await resolved.dir.getFileHandle(resolved.name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(bytes);
  await writable.close();
}

export async function readHistoryJson<T>(path: string): Promise<T | null> {
  const bytes = await readHistoryBytes(path);
  if (!bytes) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

export async function writeHistoryJson(path: string, value: unknown): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(value, null, 2));
  await writeHistoryBytes(path, bytes);
}

export async function deleteHistoryPath(
  path: string,
  options?: { recursive?: boolean },
): Promise<boolean> {
  const resolved = await resolveParent(path, false);
  if (!resolved) return false;
  try {
    await resolved.dir.removeEntry(resolved.name, {
      recursive: options?.recursive ?? false,
    });
    return true;
  } catch {
    return false;
  }
}

export async function listHistoryFiles(prefix = ''): Promise<string[]> {
  const root = await getV2Root(false);
  if (!root) return [];
  const parts = split(prefix);
  let start = root;
  try {
    for (const part of parts) {
      start = await start.getDirectoryHandle(part);
    }
  } catch {
    return [];
  }

  const files: string[] = [];
  const walk = async (dir: FileSystemDirectoryHandle, path: string) => {
    for await (const [name, handle] of dir.entries()) {
      const child = path ? `${path}/${name}` : name;
      if (handle.kind === 'directory') {
        await walk(handle as FileSystemDirectoryHandle, child);
      } else {
        files.push(child);
      }
    }
  };
  await walk(start, parts.join('/'));
  return files.sort();
}

export async function historyFileSize(path: string): Promise<number> {
  const resolved = await resolveParent(path, false);
  if (!resolved) return 0;
  try {
    const handle = await resolved.dir.getFileHandle(resolved.name);
    return (await handle.getFile()).size;
  } catch {
    return 0;
  }
}

export async function hashBytes(bytes: Uint8Array): Promise<string> {
  const copy = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', copy);
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, '0'),
  ).join('');
}

export const objectPath = (objectId: string) =>
  `objects/${objectId.slice(0, 2)}/${objectId}`;

export async function ensureHistoryObject(
  objectId: string,
  bytes: Uint8Array,
): Promise<void> {
  const existing = await readHistoryBytes(objectPath(objectId));
  if (existing && (await hashBytes(existing)) === objectId) return;
  await writeHistoryBytes(objectPath(objectId), bytes);
}

export async function readHistoryObject(
  objectId: string,
): Promise<Uint8Array | null> {
  const bytes = await readHistoryBytes(objectPath(objectId));
  if (!bytes || (await hashBytes(bytes)) !== objectId) return null;
  return bytes;
}

export async function deleteHistoryObject(objectId: string): Promise<boolean> {
  return deleteHistoryPath(objectPath(objectId));
}
