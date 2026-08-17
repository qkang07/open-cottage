/** API Key 仅存浏览器 IndexedDB，不写入工作空间 .cottage */

import type { LlmProviderId } from './llmProviders';
import type { ThirdPartySearchProviderId } from './constants';

/** 与 LLM 提供商一一对应；另含第三方搜索提供商（tavily/bing/brave/serper/exa） */
export type SecretProviderId = LlmProviderId | ThirdPartySearchProviderId;

/** 提供商密钥条目（API Key + 可选 Base URL） */
export interface ProviderSecretEntry {
  id?: string;
  alias?: string;
  apiKey: string;
  baseUrl?: string;
}

/** MCP 服务器令牌（按 serverId 索引） */
export interface McpSecretEntry {
  token: string;
}

export type ProviderSecrets = Partial<Record<SecretProviderId, ProviderSecretEntry>> & {
  /** 同一服务商可保存多个具名连接；旧的 provider 顶层条目继续作为兼容默认项。 */
  providerConnections?: Partial<Record<LlmProviderId, ProviderSecretEntry[]>>;
  /** MCP 服务器鉴权令牌，按 serverId 索引 */
  mcp?: Record<string, McpSecretEntry>;
  /** 可选厄商嵌入 API Key（RAG 用） */
  embeddingVendor?: ProviderSecretEntry;
  /**
   * 模型预设专属 API Key，按 presetId 索引。
   * 与 modelPresets 一一对应，不会写入工作空间。
   */
  presetApiKeys?: Record<string, ProviderSecretEntry>;
};

const DB_NAME = 'open-cottage-secrets';
const STORE_NAME = 'secrets';
const RECORD_KEY = 'default';

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });

/** 从 IndexedDB 加载所有提供商密钥 */
export const loadProviderSecrets = async (): Promise<ProviderSecrets> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(RECORD_KEY);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const value = request.result;
      resolve(
        value && typeof value === 'object' ? (value as ProviderSecrets) : {},
      );
    };
    tx.oncomplete = () => db.close();
  });
};

/** 保存所有提供商密钥到 IndexedDB（深拷贝避免 Vue reactive 对象） */
export const saveProviderSecrets = async (
  secrets: ProviderSecrets,
): Promise<void> => {
  // 深拷贝为普通对象，避免传入 Vue reactive proxy 导致 IndexedDB 结构化克隆失败
  const plainSecrets = JSON.parse(JSON.stringify(secrets)) as ProviderSecrets;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(plainSecrets, RECORD_KEY);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
    tx.oncomplete = () => db.close();
  });
};

/** 获取指定提供商的密钥条目 */
export const getSecretForProvider = (
  secrets: ProviderSecrets,
  provider: SecretProviderId,
  connectionId?: string,
): ProviderSecretEntry | undefined => {
  const storedConnections = secrets.providerConnections?.[provider as LlmProviderId] ?? [];
  const legacyConnection = secrets[provider];
  const connections = legacyConnection
    ? [...storedConnections, legacyConnection]
    : storedConnections;
  if (connectionId) {
    // 指定连接必须精确命中。连接被删除后不能静默回退到同厂商的其他密钥。
    return connections.find((entry) => entry.id === connectionId);
  }
  return storedConnections[0] ?? legacyConnection;
};

export const getProviderConnections = (
  secrets: ProviderSecrets,
  provider: LlmProviderId,
): ProviderSecretEntry[] => {
  const connections = secrets.providerConnections?.[provider] ?? [];
  return connections.length ? connections : secrets[provider] ? [secrets[provider]!] : [];
};

/** 脱敏显示 API Key（仅显示前 4 位和后 4 位） */
export const maskApiKey = (key: string): string => {
  const trimmed = key.trim();
  if (trimmed.length <= 8) return '••••••••';
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
};

/** 获取指定预设的专属 API Key */
export const getPresetApiKey = (
  secrets: ProviderSecrets,
  presetId: string,
): ProviderSecretEntry | undefined => secrets.presetApiKeys?.[presetId];

/** 设置指定预设的专属 API Key（返回新对象，不修改原对象） */
export const setPresetApiKey = (
  secrets: ProviderSecrets,
  presetId: string,
  entry: ProviderSecretEntry | undefined,
): ProviderSecrets => {
  const next = { ...secrets };
  const nextPresetApiKeys = { ...(next.presetApiKeys ?? {}) };
  if (entry?.apiKey?.trim() || entry?.baseUrl?.trim()) {
    nextPresetApiKeys[presetId] = {
      apiKey: entry.apiKey?.trim() ?? '',
      ...(entry.baseUrl?.trim() ? { baseUrl: entry.baseUrl.trim() } : {}),
    };
  } else {
    delete nextPresetApiKeys[presetId];
  }
  if (Object.keys(nextPresetApiKeys).length === 0) {
    delete next.presetApiKeys;
  } else {
    next.presetApiKeys = nextPresetApiKeys;
  }
  return next;
};
