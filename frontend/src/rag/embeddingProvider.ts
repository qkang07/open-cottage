/**
 * 本地嵌入 Provider：基于 @huggingface/transformers (v4)
 * 在主线程运行（Worker 内会加载独立实例）；使用 Cache Storage 缓存模型权重
 */

import type { EmbeddingProvider } from './types';
import type { RagEmbeddingConfig } from '../config/constants';
import {
  getVendorEmbeddingProvider,
  getVendorEmbeddingModelId,
} from './vendorEmbeddingProvider';

/**
 * 推导当前嵌入配置对应的 modelId（与 manifest.model 写入值一致）。
 * vendor 预设缺失时返回 null。
 */
export function getExpectedEmbeddingModelId(
  embeddingConfig: RagEmbeddingConfig | undefined,
): string | null {
  if (embeddingConfig?.provider === 'vendor') {
    return getVendorEmbeddingModelId(
      embeddingConfig.vendorPresetId,
      embeddingConfig.vendorModel,
    );
  }
  return embeddingConfig?.localModel ?? 'minilm';
}

/**
 * 按嵌入配置选择 provider：local（transformers.js）或 vendor（厂商 API）。
 */
export async function getEmbeddingProvider(
  embeddingConfig: RagEmbeddingConfig | undefined,
  onInitDetail?: (detail: string) => void,
): Promise<EmbeddingProvider> {
  if (embeddingConfig?.provider === 'vendor') {
    return getVendorEmbeddingProvider(
      embeddingConfig.vendorPresetId,
      embeddingConfig.vendorModel,
      onInitDetail,
    );
  }
  return getLocalEmbeddingProvider(
    embeddingConfig?.localModel ?? 'minilm',
    embeddingConfig?.localDevice ?? 'auto',
    onInitDetail,
  );
}

/** 模型到 HuggingFace 仓库的映射 */
const MODEL_MAP: Record<string, { repo: string; dim: number }> = {
  minilm: { repo: 'Xenova/all-MiniLM-L6-v2', dim: 384 },
  'bge-small': { repo: 'Xenova/bge-small-en-v1.5', dim: 384 },
};

type LocalModelId = 'minilm' | 'bge-small';
type DevicePreference = 'auto' | 'wasm' | 'webgpu';

let cachedProvider: LocalEmbeddingProvider | null = null;

/**
 * 获取或创建本地嵌入 provider（单例）
 */
export async function getLocalEmbeddingProvider(
  modelId: LocalModelId = 'minilm',
  device: DevicePreference = 'auto',
  onInitDetail?: (detail: string) => void,
): Promise<EmbeddingProvider> {
  if (cachedProvider && cachedProvider.modelId === modelId) {
    onInitDetail?.('嵌入模型已就绪');
    return cachedProvider;
  }
  if (cachedProvider) {
    cachedProvider.dispose();
  }
  cachedProvider = new LocalEmbeddingProvider(modelId, device, onInitDetail);
  await cachedProvider.init();
  return cachedProvider;
}

/**
 * 释放缓存的 provider
 */
export function disposeLocalEmbeddingProvider(): void {
  if (cachedProvider) {
    cachedProvider.dispose();
    cachedProvider = null;
  }
}

class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly modelId: string;
  readonly dim: number;
  private device: DevicePreference;
  private pipeline: unknown = null;
  private onInitDetail?: (detail: string) => void;

  constructor(
    modelId: LocalModelId,
    device: DevicePreference,
    onInitDetail?: (detail: string) => void,
  ) {
    const entry = MODEL_MAP[modelId];
    if (!entry) throw new Error(`Unknown local embedding model: ${modelId}`);
    this.modelId = modelId;
    this.dim = entry.dim;
    this.device = device;
    this.onInitDetail = onInitDetail;
  }

  async init(): Promise<void> {
    this.onInitDetail?.('加载 transformers.js 运行时…');
    const transformers = await import('@huggingface/transformers');

    const entry = MODEL_MAP[this.modelId as LocalModelId]!;

    let resolvedDevice: 'wasm' | 'webgpu' = 'wasm';
    if (this.device === 'webgpu' || this.device === 'auto') {
      try {
        const gpu = (navigator as unknown as { gpu?: unknown }).gpu;
        if (gpu) {
          resolvedDevice = 'webgpu';
        }
      } catch {
        // WebGPU not available, stay with wasm
      }
    }
    if (this.device === 'wasm') {
      resolvedDevice = 'wasm';
    }

    this.onInitDetail?.(
      `下载并加载模型 ${entry.repo}（${resolvedDevice.toUpperCase()}）…`,
    );

    this.pipeline = await transformers.pipeline(
      'feature-extraction',
      entry.repo,
      {
        device: resolvedDevice,
        dtype: 'fp32',
      },
    );

    this.onInitDetail?.('嵌入模型就绪');
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (!this.pipeline) throw new Error('Embedding provider not initialized');
    const results: Float32Array[] = [];
    const pipe = this.pipeline as (
      input: string[],
      options: { pooling: string; normalize: boolean },
    ) => Promise<{ tolist(): number[][] }>;

    // Process in batches to avoid OOM
    const batchSize = 8;
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const output = await pipe(batch, { pooling: 'mean', normalize: true });
      const vectors = output.tolist();
      for (const vec of vectors) {
        results.push(new Float32Array(vec));
      }
    }
    return results;
  }

  async embedQuery(text: string): Promise<Float32Array> {
    const [result] = await this.embed([text]);
    return result;
  }

  dispose(): void {
    this.pipeline = null;
  }
}
