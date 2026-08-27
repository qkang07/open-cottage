import { normalizePath, splitPath } from './pathUtils';

const DB_NAME = 'open-cottage-virtual-workspaces';
const DB_VERSION = 1;
const ENTRY_STORE = 'entries';
const META_STORE = 'workspaces';

export const VIRTUAL_WORKSPACE_ID = 'virtual:chat';
export const VIRTUAL_WORKSPACE_NAME = '聊天工作区';

interface VirtualEntryRecord {
  workspaceId: string;
  path: string;
  kind: 'file' | 'directory';
  content?: ArrayBuffer;
  size: number;
  modified: number;
}

interface VirtualWorkspaceMeta {
  id: string;
  name: string;
  usageBytes: number;
  createdAt: number;
  updatedAt: number;
}

type UsageListener = (workspaceId: string, usageBytes: number) => void;
const usageListeners = new Set<UsageListener>();

const requestResult = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });

const transactionDone = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
  });

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前浏览器不支持 IndexedDB，无法创建聊天工作区'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ENTRY_STORE)) {
        const entries = db.createObjectStore(ENTRY_STORE, {
          keyPath: ['workspaceId', 'path'],
        });
        entries.createIndex('workspaceId', 'workspaceId', { unique: false });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'id' });
      }
    };
  });

const defaultMeta = (): VirtualWorkspaceMeta => {
  const now = Date.now();
  return {
    id: VIRTUAL_WORKSPACE_ID,
    name: VIRTUAL_WORKSPACE_NAME,
    usageBytes: 0,
    createdAt: now,
    updatedAt: now,
  };
};

const notifyUsage = (workspaceId: string, usageBytes: number) => {
  for (const listener of usageListeners) listener(workspaceId, usageBytes);
};

export const usageAfterWrite = (
  currentUsage: number,
  previousFileSize: number,
  nextFileSize: number,
): number => Math.max(0, currentUsage - previousFileSize + nextFileSize);

export const usageAfterRemoval = (
  currentUsage: number,
  removedBytes: number,
): number => Math.max(0, currentUsage - removedBytes);

const copyArrayBuffer = (bytes: Uint8Array | ArrayBuffer): ArrayBuffer => {
  if (bytes instanceof ArrayBuffer) return bytes.slice(0);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

const getAllEntries = async (workspaceId: string): Promise<VirtualEntryRecord[]> => {
  const db = await openDb();
  try {
    const tx = db.transaction(ENTRY_STORE, 'readonly');
    const records = await requestResult(
      tx.objectStore(ENTRY_STORE).index('workspaceId').getAll(workspaceId),
    );
    await transactionDone(tx);
    return records as VirtualEntryRecord[];
  } finally {
    db.close();
  }
};

const ensureParentDirectories = (
  store: IDBObjectStore,
  workspaceId: string,
  path: string,
  now: number,
) => {
  const parts = splitPath(path);
  parts.pop();
  for (let index = 1; index <= parts.length; index += 1) {
    const parentPath = parts.slice(0, index).join('/');
    store.put({
      workspaceId,
      path: parentPath,
      kind: 'directory',
      size: 0,
      modified: now,
    } satisfies VirtualEntryRecord);
  }
};

export const ensureVirtualWorkspace = async (): Promise<VirtualWorkspaceMeta> => {
  const db = await openDb();
  try {
    const tx = db.transaction(META_STORE, 'readwrite');
    const store = tx.objectStore(META_STORE);
    const existing = (await requestResult(
      store.get(VIRTUAL_WORKSPACE_ID),
    )) as VirtualWorkspaceMeta | undefined;
    const meta = existing ?? defaultMeta();
    if (!existing) store.put(meta);
    await transactionDone(tx);
    return meta;
  } finally {
    db.close();
  }
};

export const getVirtualWorkspaceUsage = async (): Promise<number> =>
  (await ensureVirtualWorkspace()).usageBytes;

export const subscribeVirtualWorkspaceUsage = (listener: UsageListener): (() => void) => {
  usageListeners.add(listener);
  return () => usageListeners.delete(listener);
};

async function getEntry(path: string): Promise<VirtualEntryRecord | null> {
  const normalized = normalizePath(path);
  if (!normalized) return null;
  const db = await openDb();
  try {
    const tx = db.transaction(ENTRY_STORE, 'readonly');
    const value = await requestResult(
      tx.objectStore(ENTRY_STORE).get([VIRTUAL_WORKSPACE_ID, normalized]),
    );
    await transactionDone(tx);
    return (value as VirtualEntryRecord | undefined) ?? null;
  } finally {
    db.close();
  }
}

async function putDirectory(path: string): Promise<void> {
  const normalized = normalizePath(path);
  if (!normalized) return;
  const db = await openDb();
  try {
    const tx = db.transaction(ENTRY_STORE, 'readwrite');
    const store = tx.objectStore(ENTRY_STORE);
    const now = Date.now();
    ensureParentDirectories(store, VIRTUAL_WORKSPACE_ID, normalized, now);
    store.put({
      workspaceId: VIRTUAL_WORKSPACE_ID,
      path: normalized,
      kind: 'directory',
      size: 0,
      modified: now,
    } satisfies VirtualEntryRecord);
    await transactionDone(tx);
  } finally {
    db.close();
  }
}

async function putFile(path: string, bytes: Uint8Array | ArrayBuffer): Promise<void> {
  const normalized = normalizePath(path);
  if (!normalized) throw new Error('无效的文件路径');
  const content = copyArrayBuffer(bytes);
  const db = await openDb();
  let nextUsage = 0;
  try {
    const tx = db.transaction([ENTRY_STORE, META_STORE], 'readwrite');
    const entries = tx.objectStore(ENTRY_STORE);
    const metas = tx.objectStore(META_STORE);
    const key = [VIRTUAL_WORKSPACE_ID, normalized];
    const existing = (await requestResult(entries.get(key))) as
      | VirtualEntryRecord
      | undefined;
    if (existing?.kind === 'directory') {
      tx.abort();
      throw new Error(`目标是文件夹: ${normalized}`);
    }
    const meta =
      ((await requestResult(metas.get(VIRTUAL_WORKSPACE_ID))) as
        | VirtualWorkspaceMeta
        | undefined) ?? defaultMeta();
    const now = Date.now();
    ensureParentDirectories(entries, VIRTUAL_WORKSPACE_ID, normalized, now);
    entries.put({
      workspaceId: VIRTUAL_WORKSPACE_ID,
      path: normalized,
      kind: 'file',
      content,
      size: content.byteLength,
      modified: now,
    } satisfies VirtualEntryRecord);
    nextUsage = usageAfterWrite(
      meta.usageBytes,
      existing?.size ?? 0,
      content.byteLength,
    );
    metas.put({ ...meta, usageBytes: nextUsage, updatedAt: now });
    await transactionDone(tx);
  } finally {
    db.close();
  }
  notifyUsage(VIRTUAL_WORKSPACE_ID, nextUsage);
}

async function removePath(path: string, recursive: boolean): Promise<boolean> {
  const normalized = normalizePath(path);
  if (!normalized) return false;
  const all = await getAllEntries(VIRTUAL_WORKSPACE_ID);
  const target = all.find((entry) => entry.path === normalized);
  if (!target) return false;
  const descendants = all.filter((entry) => entry.path.startsWith(`${normalized}/`));
  if (target.kind === 'directory' && descendants.length && !recursive) {
    throw new DOMException('Directory is not empty', 'InvalidModificationError');
  }
  const removed = [target, ...descendants];
  const removedBytes = removed.reduce((sum, entry) => sum + entry.size, 0);
  const db = await openDb();
  let nextUsage = 0;
  try {
    const tx = db.transaction([ENTRY_STORE, META_STORE], 'readwrite');
    const entries = tx.objectStore(ENTRY_STORE);
    const metas = tx.objectStore(META_STORE);
    for (const entry of removed) entries.delete([VIRTUAL_WORKSPACE_ID, entry.path]);
    const meta =
      ((await requestResult(metas.get(VIRTUAL_WORKSPACE_ID))) as
        | VirtualWorkspaceMeta
        | undefined) ?? defaultMeta();
    nextUsage = usageAfterRemoval(meta.usageBytes, removedBytes);
    metas.put({ ...meta, usageBytes: nextUsage, updatedAt: Date.now() });
    await transactionDone(tx);
  } finally {
    db.close();
  }
  notifyUsage(VIRTUAL_WORKSPACE_ID, nextUsage);
  return true;
}

export const resetVirtualWorkspace = async (): Promise<void> => {
  const db = await openDb();
  try {
    const tx = db.transaction([ENTRY_STORE, META_STORE], 'readwrite');
    const entries = tx.objectStore(ENTRY_STORE);
    const all = (await requestResult(
      entries.index('workspaceId').getAllKeys(VIRTUAL_WORKSPACE_ID),
    )) as IDBValidKey[];
    for (const key of all) entries.delete(key);
    tx.objectStore(META_STORE).put(defaultMeta());
    await transactionDone(tx);
  } finally {
    db.close();
  }
  notifyUsage(VIRTUAL_WORKSPACE_ID, 0);
};

const directChildren = async (dirPath: string): Promise<VirtualEntryRecord[]> => {
  const base = normalizePath(dirPath);
  const prefix = base ? `${base}/` : '';
  const all = await getAllEntries(VIRTUAL_WORKSPACE_ID);
  return all.filter((entry) => {
    if (!entry.path.startsWith(prefix) || entry.path === base) return false;
    return !entry.path.slice(prefix.length).includes('/');
  });
};

const toBytes = async (data: unknown): Promise<Uint8Array> => {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  throw new TypeError('不支持的写入数据类型');
};

class VirtualWritable {
  #path: string;
  #bytes: Uint8Array;
  #position = 0;
  #closed = false;

  private constructor(path: string, bytes: Uint8Array) {
    this.#path = path;
    this.#bytes = bytes;
  }

  static async create(path: string, keepExistingData: boolean) {
    const existing = keepExistingData ? await getEntry(path) : null;
    const bytes = existing?.kind === 'file' && existing.content
      ? new Uint8Array(existing.content.slice(0))
      : new Uint8Array();
    return new VirtualWritable(path, bytes);
  }

  async write(data: unknown) {
    if (this.#closed) throw new DOMException('Stream is closed', 'InvalidStateError');
    if (data && typeof data === 'object' && 'type' in data) {
      const command = data as { type: string; position?: number; size?: number; data?: unknown };
      if (command.type === 'seek') return this.seek(command.position ?? 0);
      if (command.type === 'truncate') return this.truncate(command.size ?? 0);
      if (command.type === 'write') {
        if (command.position !== undefined) this.#position = command.position;
        data = command.data;
      }
    }
    const incoming = await toBytes(data);
    const required = this.#position + incoming.byteLength;
    if (required > this.#bytes.byteLength) {
      const next = new Uint8Array(required);
      next.set(this.#bytes);
      this.#bytes = next;
    }
    this.#bytes.set(incoming, this.#position);
    this.#position += incoming.byteLength;
  }

  async seek(position: number) {
    if (!Number.isSafeInteger(position) || position < 0) throw new TypeError('无效的写入位置');
    this.#position = position;
  }

  async truncate(size: number) {
    if (!Number.isSafeInteger(size) || size < 0) throw new TypeError('无效的文件大小');
    const next = new Uint8Array(size);
    next.set(this.#bytes.subarray(0, size));
    this.#bytes = next;
    this.#position = Math.min(this.#position, size);
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    await putFile(this.#path, this.#bytes);
  }

  async abort() {
    this.#closed = true;
  }
}

class VirtualFileHandle {
  readonly kind = 'file' as const;
  readonly name: string;
  readonly workspaceId = VIRTUAL_WORKSPACE_ID;
  readonly path: string;

  constructor(path: string) {
    this.path = normalizePath(path);
    this.name = splitPath(this.path).at(-1) ?? this.path;
  }

  async getFile(): Promise<File> {
    const entry = await getEntry(this.path);
    if (!entry || entry.kind !== 'file') throw new DOMException('File not found', 'NotFoundError');
    return new File([entry.content ?? new ArrayBuffer(0)], this.name, {
      lastModified: entry.modified,
    });
  }

  async createWritable(options?: { keepExistingData?: boolean }) {
    return VirtualWritable.create(this.path, options?.keepExistingData === true);
  }

  async isSameEntry(other: unknown) {
    return other instanceof VirtualFileHandle && other.path === this.path;
  }

  async queryPermission() { return 'granted' as PermissionState; }
  async requestPermission() { return 'granted' as PermissionState; }
}

class VirtualDirectoryHandle {
  readonly kind = 'directory' as const;
  readonly name: string;
  readonly workspaceId = VIRTUAL_WORKSPACE_ID;
  readonly path: string;

  constructor(path = '') {
    this.path = normalizePath(path);
    this.name = this.path ? (splitPath(this.path).at(-1) ?? this.path) : VIRTUAL_WORKSPACE_NAME;
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    const path = normalizePath(this.path ? `${this.path}/${name}` : name);
    const existing = await getEntry(path);
    if (existing?.kind === 'file') throw new DOMException('A file exists at this path', 'TypeMismatchError');
    if (!existing) {
      if (!options?.create) throw new DOMException('Directory not found', 'NotFoundError');
      await putDirectory(path);
    }
    return new VirtualDirectoryHandle(path);
  }

  async getFileHandle(name: string, options?: { create?: boolean }) {
    const path = normalizePath(this.path ? `${this.path}/${name}` : name);
    const existing = await getEntry(path);
    if (existing?.kind === 'directory') throw new DOMException('A directory exists at this path', 'TypeMismatchError');
    if (!existing) {
      if (!options?.create) throw new DOMException('File not found', 'NotFoundError');
      await putFile(path, new Uint8Array());
    }
    return new VirtualFileHandle(path);
  }

  async removeEntry(name: string, options?: { recursive?: boolean }) {
    const path = normalizePath(this.path ? `${this.path}/${name}` : name);
    const removed = await removePath(path, options?.recursive === true);
    if (!removed) throw new DOMException('Entry not found', 'NotFoundError');
  }

  async *entries(): AsyncGenerator<[string, FileSystemHandle]> {
    for (const entry of await directChildren(this.path)) {
      yield [
        splitPath(entry.path).at(-1) ?? entry.path,
        (entry.kind === 'directory'
          ? new VirtualDirectoryHandle(entry.path)
          : new VirtualFileHandle(entry.path)) as unknown as FileSystemHandle,
      ];
    }
  }

  async *keys(): AsyncGenerator<string> {
    for await (const [name] of this.entries()) yield name;
  }

  async *values(): AsyncGenerator<FileSystemHandle> {
    for await (const [, handle] of this.entries()) yield handle;
  }

  async resolve(possibleDescendant: unknown): Promise<string[] | null> {
    if (
      !(possibleDescendant instanceof VirtualDirectoryHandle) &&
      !(possibleDescendant instanceof VirtualFileHandle)
    ) return null;
    const target = possibleDescendant.path;
    if (!this.path) return target ? splitPath(target) : [];
    if (target === this.path) return [];
    if (!target.startsWith(`${this.path}/`)) return null;
    return splitPath(target.slice(this.path.length + 1));
  }

  async isSameEntry(other: unknown) {
    return other instanceof VirtualDirectoryHandle && other.path === this.path;
  }

  async queryPermission() { return 'granted' as PermissionState; }
  async requestPermission() { return 'granted' as PermissionState; }
}

export const openVirtualDirectoryHandle = async (): Promise<FileSystemDirectoryHandle> => {
  await ensureVirtualWorkspace();
  return new VirtualDirectoryHandle() as unknown as FileSystemDirectoryHandle;
};

export const isVirtualDirectoryHandle = (handle: unknown): boolean =>
  handle instanceof VirtualDirectoryHandle;
