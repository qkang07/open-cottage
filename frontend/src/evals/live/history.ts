import type { LiveEvalReport } from './types';

const DB_NAME = 'open-cottage-evals';
const STORE_NAME = 'live-reports';
const MAX_REPORTS = 50;

export interface StoredLiveEvalReport {
  id: string;
  generatedAt: string;
  report: LiveEvalReport;
}

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });

const readAll = (db: IDBDatabase): Promise<StoredLiveEvalReport[]> =>
  new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result as StoredLiveEvalReport[]);
  });

export const sortLiveEvalHistory = (
  reports: readonly StoredLiveEvalReport[],
): StoredLiveEvalReport[] =>
  [...reports].sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));

export const loadLiveEvalHistory = async (): Promise<StoredLiveEvalReport[]> => {
  const db = await openDb();
  try {
    return sortLiveEvalHistory(await readAll(db));
  } finally {
    db.close();
  }
};

export const saveLiveEvalReport = async (
  report: LiveEvalReport,
): Promise<StoredLiveEvalReport> => {
  const db = await openDb();
  const entry: StoredLiveEvalReport = {
    id: `${report.generatedAt}:${crypto.randomUUID()}`,
    generatedAt: report.generatedAt,
    report,
  };
  try {
    const existing = sortLiveEvalHistory(await readAll(db));
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(entry);
      for (const stale of existing.slice(MAX_REPORTS - 1)) store.delete(stale.id);
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => resolve();
    });
    return entry;
  } finally {
    db.close();
  }
};

export const deleteLiveEvalReport = async (id: string): Promise<void> => {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => resolve();
    });
  } finally {
    db.close();
  }
};
