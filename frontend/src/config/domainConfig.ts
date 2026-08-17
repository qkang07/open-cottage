/**
 * 域名级 Cottage 配置持久化。
 * 将配置按域名索引存储在 IndexedDB，实现跨工作空间的全局配置。
 */

import type { CottageConfig } from './constants';

/** 域名配置记录结构（存储在 IndexedDB 中） */
interface DomainConfigRecord {
  schema: 'cottage-domain-config-v1';
  version: 1;
  host: string;
  config: CottageConfig;
  updatedAt: number;
}

const DB_NAME = 'open-cottage-config';
const DB_VERSION = 1;
const STORE_NAME = 'domain-config';

/** 打开 IndexedDB 数据库 */
const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });

/** 获取当前域名（用于配置键） */
const getCurrentHost = () => window.location.hostname || 'localhost';

/** 从 IndexedDB 加载域名级配置 */
export const loadDomainCottageConfig = async (
  host = getCurrentHost(),
): Promise<CottageConfig | null> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    tx.oncomplete = () => db.close();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB read failed'));
    const request = tx.objectStore(STORE_NAME).get(host);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB get failed'));
    request.onsuccess = () => {
      const value = request.result as DomainConfigRecord | undefined;
      if (!value || typeof value !== 'object') {
        resolve(null);
        return;
      }
      resolve(value.config ?? null);
    };
  });
};

/** 保存配置到 IndexedDB（按域名索引） */
export const saveDomainCottageConfig = async (
  config: CottageConfig,
  host = getCurrentHost(),
): Promise<void> => {
  const plainConfig = JSON.parse(JSON.stringify(config)) as CottageConfig;
  const record: DomainConfigRecord = {
    schema: 'cottage-domain-config-v1',
    version: 1,
    host,
    config: plainConfig,
    updatedAt: Date.now(),
  };
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
    tx.objectStore(STORE_NAME).put(record, host);
  });
};
