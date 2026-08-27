const DB_NAME = 'cottage';
const DB_VERSION = 1;
const HANDLE_STORE = 'directory-handles';

export const LAST_WORKSPACE_ID_KEY = 'cottage:last-workspace-id';
export const RECENT_WORKSPACES_KEY = 'cottage:recent-workspaces';
const MAX_RECENT = 8;

export interface RecentWorkspace {
  id: string;
  kind: 'folder';
  name: string;
  /** 展示用路径；浏览器通常只能拿到文件夹名 */
  path: string;
  alias?: string;
  lastOpenedAt: number;
}

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(HANDLE_STORE)) {
        db.createObjectStore(HANDLE_STORE);
      }
    };
  });

export const saveDirectoryHandle = async (
  id: string,
  handle: FileSystemDirectoryHandle,
): Promise<void> => {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, 'readwrite');
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
    tx.objectStore(HANDLE_STORE).put(handle, id);
  });
};

export const loadDirectoryHandle = async (
  id: string,
): Promise<FileSystemDirectoryHandle | null> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, 'readonly');
    tx.oncomplete = () => db.close();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB read failed'));
    const request = tx.objectStore(HANDLE_STORE).get(id);
    request.onsuccess = () => {
      const value = request.result;
      resolve(
        value && typeof value === 'object' && 'kind' in value && value.kind === 'directory'
          ? (value as FileSystemDirectoryHandle)
          : null,
      );
    };
    request.onerror = () => reject(request.error ?? new Error('IndexedDB get failed'));
  });
};

export const removeDirectoryHandle = async (id: string): Promise<void> => {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, 'readwrite');
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'));
    tx.objectStore(HANDLE_STORE).delete(id);
  });
};

export const readRecentWorkspaces = (): RecentWorkspace[] => {
  try {
    const raw = localStorage.getItem(RECENT_WORKSPACES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): RecentWorkspace[] => {
      if (
        typeof item !== 'object' ||
        item === null ||
        typeof (item as RecentWorkspace).id !== 'string' ||
        typeof (item as RecentWorkspace).name !== 'string' ||
        typeof (item as RecentWorkspace).path !== 'string' ||
        ((item as RecentWorkspace).alias !== undefined &&
          typeof (item as RecentWorkspace).alias !== 'string') ||
        typeof (item as RecentWorkspace).lastOpenedAt !== 'number'
      ) return [];
      // v1 记录没有 kind；它们全部来自目录选择器，明确迁移为 folder。
      return [{ ...(item as Omit<RecentWorkspace, 'kind'>), kind: 'folder' }];
    });
  } catch {
    return [];
  }
};

const writeRecentWorkspaces = (items: RecentWorkspace[]) => {
  localStorage.setItem(RECENT_WORKSPACES_KEY, JSON.stringify(items));
};

export const getLastWorkspaceId = (): string | null =>
  localStorage.getItem(LAST_WORKSPACE_ID_KEY);

export const setLastWorkspaceId = (id: string) => {
  localStorage.setItem(LAST_WORKSPACE_ID_KEY, id);
};

/** 保存 handle 到 IndexedDB，并更新常用目录列表 */
export const rememberWorkspace = async (
  handle: FileSystemDirectoryHandle,
): Promise<string> => {
  const name = handle.name;
  const path = name;
  const now = Date.now();
  const recent = readRecentWorkspaces();
  const existing = recent.find((item) => item.name === name);
  const id = existing?.id ?? crypto.randomUUID();

  await saveDirectoryHandle(id, handle);

  const entry: RecentWorkspace = { id, kind: 'folder', name, path, lastOpenedAt: now };
  const next = [
    entry,
    ...recent.filter((item) => item.id !== id),
  ].slice(0, MAX_RECENT);

  writeRecentWorkspaces(next);
  setLastWorkspaceId(id);
  return id;
};

export const loadLastDirectoryHandle = async (): Promise<FileSystemDirectoryHandle | null> => {
  const id = getLastWorkspaceId();
  if (!id) return null;
  return loadDirectoryHandle(id);
};

export const loadRecentDirectoryHandle = async (
  id: string,
): Promise<FileSystemDirectoryHandle | null> => loadDirectoryHandle(id);

export const touchRecentWorkspace = (id: string) => {
  const recent = readRecentWorkspaces();
  const index = recent.findIndex((item) => item.id === id);
  if (index === -1) return;
  const [entry] = recent.splice(index, 1);
  entry.lastOpenedAt = Date.now();
  writeRecentWorkspaces([entry, ...recent]);
  setLastWorkspaceId(id);
};

export const setRecentWorkspaceAlias = (id: string, alias: string) => {
  const normalized = alias.trim();
  const recent = readRecentWorkspaces();
  const index = recent.findIndex((item) => item.id === id);
  if (index === -1) return;
  const next = [...recent];
  const current = next[index];
  next[index] = {
    ...current,
    alias: normalized || undefined,
  };
  writeRecentWorkspaces(next);
};

/** 从最近列表与 IndexedDB 中移除文件夹记录 */
export const forgetRecentWorkspace = async (id: string): Promise<void> => {
  const recent = readRecentWorkspaces();
  const next = recent.filter((item) => item.id !== id);
  writeRecentWorkspaces(next);
  const { forgetWorkspaceLastModelPresetId } = await import('./modelPreference');
  forgetWorkspaceLastModelPresetId(id);
  await removeDirectoryHandle(id);
  const lastId = getLastWorkspaceId();
  if (lastId === id) {
    if (next.length > 0) {
      setLastWorkspaceId(next[0].id);
    } else {
      localStorage.removeItem(LAST_WORKSPACE_ID_KEY);
    }
  }
};
