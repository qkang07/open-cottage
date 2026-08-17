/**
 * 厂商 API 嵌入 Provider：复用模型配置中的预设（凭据 + Base URL），
 * 调用 OpenAI 兼容的 /embeddings 接口生成向量。
 * 与 chat 相同地走代理/直连与密钥解析逻辑。
 */

import { getCottageConfig } from '../config/store';
import {
  getPresetApiKey,
  getSecretForProvider,
  loadProviderSecrets,
  type SecretProviderId,
} from '../config/secrets';
import {
  getProviderDefinition,
  normalizeProviderId,
  resolveLlmBaseUrl,
  providerLabel,
  type LlmProviderId,
} from '../config/llmProviders';
import {
  defaultOpenAiBaseForProvider,
  resolveOpenAiClientProxy,
} from '../config/aiProxy';
import type { EmbeddingProvider } from './types';

/** 各厂商默认嵌入模型（用户未填写 vendorModel 时使用） */
const DEFAULT_EMBEDDING_MODEL: Partial<Record<LlmProviderId, string>> = {
  openai: 'text-embedding-3-small',
  zhipu: 'embedding-3',
  dashscope: 'text-embedding-v3',
  siliconflow: 'BAAI/bge-m3',
  doubao: 'doubao-embedding',
  qianfan: 'embedding-v1',
  baichuan: 'Baichuan-Text-Embedding',
};

/**
 * 同步推导厂商嵌入的 modelId（与建库写入 manifest.model 一致），
 * 供「配置变更需重建」判断使用。预设缺失时返回 null。
 */
export function getVendorEmbeddingModelId(
  presetId: string | undefined,
  modelOverride: string | undefined,
): string | null {
  const config = getCottageConfig();
  const preset = config.modelPresets?.find((p) => p.id === presetId);
  if (!preset) return null;
  const providerId = normalizeProviderId(preset.config.provider);
  const model =
    modelOverride?.trim() ||
    DEFAULT_EMBEDDING_MODEL[providerId] ||
    preset.config.model;
  return `vendor:${providerId}:${model}`;
}

interface ResolvedVendorEmbedding {
  providerId: LlmProviderId;
  model: string;
  baseURL: string;
  apiKey: string;
  fetchImpl: typeof fetch;
  extraBody: Record<string, unknown>;
}

const trimTrailingSlash = (s: string): string => s.replace(/\/$/, '');

/**
 * 根据预设 ID 解析出调用 /embeddings 所需的全部参数。
 */
async function resolveVendorEmbedding(
  presetId: string | undefined,
  modelOverride: string | undefined,
): Promise<ResolvedVendorEmbedding> {
  const config = getCottageConfig();
  const preset = config.modelPresets?.find((p) => p.id === presetId);
  if (!preset) {
    throw new Error(
      '未选择有效的嵌入模型，请在「设置 → 语义索引」中选择一个已配置的模型',
    );
  }

  const providerId = normalizeProviderId(preset.config.provider);
  const def = getProviderDefinition(providerId);
  if (def.kind === 'anthropic') {
    throw new Error(
      `${providerLabel(providerId)} 不提供文本嵌入接口，请改用其它厂商或本地模型`,
    );
  }

  const model =
    modelOverride?.trim() ||
    DEFAULT_EMBEDDING_MODEL[providerId] ||
    preset.config.model;

  const secrets = await loadProviderSecrets();
  const presetSecret = getPresetApiKey(secrets, preset.id);
  const providerSecret = getSecretForProvider(
    secrets,
    providerId as SecretProviderId,
  );
  const apiKey =
    preset.config.apiKey?.trim() ||
    presetSecret?.apiKey?.trim() ||
    providerSecret?.apiKey?.trim() ||
    '';
  let baseURL: string | undefined;
  if (def.kind === 'openai') {
    baseURL = defaultOpenAiBaseForProvider('openai');
  } else {
    baseURL = resolveLlmBaseUrl(
      providerId,
      preset.config.baseUrl,
      providerSecret?.baseUrl,
    );
  }
  if (!baseURL) {
    throw new Error(`${providerLabel(providerId)} 需配置 Base URL`);
  }
  if (!apiKey && !(preset.config.baseUrl?.trim() || providerSecret?.baseUrl?.trim())) {
    throw new Error(`请先为「${providerLabel(providerId)}」配置 API Key 后再使用厂商嵌入`);
  }

  const proxy = resolveOpenAiClientProxy(providerId, baseURL, !apiKey);
  return {
    providerId,
    model,
    baseURL: trimTrailingSlash(proxy.baseURL),
    apiKey,
    fetchImpl: proxy.fetch,
    extraBody: {},
  };
}

class VendorEmbeddingProvider implements EmbeddingProvider {
  readonly modelId: string;
  dim = 0;
  private resolved: ResolvedVendorEmbedding;
  private onInitDetail?: (detail: string) => void;

  constructor(
    resolved: ResolvedVendorEmbedding,
    onInitDetail?: (detail: string) => void,
  ) {
    this.resolved = resolved;
    this.modelId = `vendor:${resolved.providerId}:${resolved.model}`;
    this.onInitDetail = onInitDetail;
  }

  /** 探测一次以确定向量维度，避免无新增 chunk 时 dim 为 0 */
  async init(): Promise<void> {
    this.onInitDetail?.(`连接 ${providerLabel(this.resolved.providerId)} 嵌入接口…`);
    const [probe] = await this.embed(['cottage']);
    this.dim = probe?.length ?? 0;
    if (!this.dim) {
      throw new Error('厂商嵌入返回为空，无法确定向量维度');
    }
    this.onInitDetail?.(`嵌入接口就绪（${this.resolved.model}，dim=${this.dim}）`);
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (!texts.length) return [];
    const { baseURL, apiKey, model, fetchImpl, extraBody } = this.resolved;
    const response = await fetchImpl(`${baseURL}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        input: texts,
        encoding_format: 'float',
        ...extraBody,
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        `厂商嵌入请求失败（${response.status}）：${detail.slice(0, 200)}`,
      );
    }
    const payload = (await response.json()) as {
      data?: { embedding: number[]; index: number }[];
    };
    const data = payload.data ?? [];
    if (data.length !== texts.length) {
      throw new Error('厂商嵌入返回数量与输入不一致');
    }
    const ordered = [...data].sort((a, b) => a.index - b.index);
    return ordered.map((item) => new Float32Array(item.embedding));
  }

  async embedQuery(text: string): Promise<Float32Array> {
    const [result] = await this.embed([text]);
    return result;
  }

  dispose(): void {
    // 无持久资源
  }
}

let cached: { key: string; provider: VendorEmbeddingProvider } | null = null;

/**
 * 获取厂商嵌入 provider（按 presetId + model 缓存）。
 */
export async function getVendorEmbeddingProvider(
  presetId: string | undefined,
  model: string | undefined,
  onInitDetail?: (detail: string) => void,
): Promise<EmbeddingProvider> {
  const resolved = await resolveVendorEmbedding(presetId, model);
  const key = `${presetId ?? ''}|${resolved.model}|${resolved.baseURL}`;
  if (cached && cached.key === key && cached.provider.dim > 0) {
    onInitDetail?.('嵌入接口已就绪');
    return cached.provider;
  }
  const provider = new VendorEmbeddingProvider(resolved, onInitDetail);
  await provider.init();
  cached = { key, provider };
  return provider;
}

/** 释放厂商 provider 缓存 */
export function disposeVendorEmbeddingProvider(): void {
  cached = null;
}
