/** LLM API Key 状态检查工具集。 */

import type { LlmModelConfig, ModelPreset } from './constants';
import { normalizeProviderId, type LlmProviderId } from './llmProviders';
import {
  getProviderConnections,
  getSecretForProvider,
  type ProviderSecrets,
} from './secrets';

/**
 * 自定义 Base URL 可指向不要求鉴权的 OpenAI 兼容 API，因此 Key 为可选；
 * 使用厂商默认地址时仍要求 Key。
 */
export const isApiKeyRequiredForProvider = (
  _providerId: LlmProviderId,
  configBaseUrl?: string,
  secretBaseUrl?: string,
): boolean => !(configBaseUrl?.trim() || secretBaseUrl?.trim());

export const isApiKeyRequiredForConfig = (
  config: Pick<LlmModelConfig, 'provider' | 'baseUrl'>,
  secretBaseUrl?: string,
): boolean => isApiKeyRequiredForProvider(
  normalizeProviderId(config.provider), config.baseUrl, secretBaseUrl,
);

const resolveSecretBaseUrl = (secrets: ProviderSecrets, provider: LlmProviderId, presetId?: string, connectionId?: string): string | undefined =>
  (presetId ? secrets.presetApiKeys?.[presetId]?.baseUrl : undefined) ||
  getSecretForProvider(secrets, provider, connectionId)?.baseUrl;

/** 指定连接必须精确存在；未指定连接的旧配置至少需要该服务商仍有一个连接。 */
export const providerConnectionExists = (
  providerId: LlmProviderId,
  connectionId: string | undefined,
  secrets: ProviderSecrets,
): boolean => {
  const connections = getProviderConnections(secrets, normalizeProviderId(providerId));
  const normalizedConnectionId = connectionId?.trim();
  if (!normalizedConnectionId) return connections.length > 0;
  return connections.some((connection) => connection.id === normalizedConnectionId);
};

export const presetHasProviderConnection = (
  preset: Pick<ModelPreset, 'config'>,
  secrets: ProviderSecrets,
): boolean => providerConnectionExists(
  normalizeProviderId(preset.config.provider),
  preset.config.connectionId,
  secrets,
);

export const presetHasApiKey = (
  preset: Pick<ModelPreset, 'id' | 'config'>,
  secrets: ProviderSecrets,
): boolean => {
  if (!presetHasProviderConnection(preset, secrets)) return false;
  const provider = normalizeProviderId(preset.config.provider);
  if (!isApiKeyRequiredForConfig(preset.config, resolveSecretBaseUrl(secrets, provider, preset.id, preset.config.connectionId))) return true;
  if (preset.config.apiKey?.trim()) return true;
  if (secrets.presetApiKeys?.[preset.id]?.apiKey?.trim()) return true;
  return Boolean(getSecretForProvider(secrets, provider, preset.config.connectionId)?.apiKey?.trim());
};

export const resolveActiveApiKey = (
  config: LlmModelConfig,
  presetId: string | undefined,
  secrets: ProviderSecrets,
): string => {
  const provider = normalizeProviderId(config.provider);
  return config.apiKey?.trim() ||
    (presetId ? secrets.presetApiKeys?.[presetId]?.apiKey?.trim() : '') ||
    getSecretForProvider(secrets, provider, config.connectionId)?.apiKey?.trim() || '';
};
