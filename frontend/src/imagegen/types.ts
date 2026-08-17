/**
 * 图片生成能力的核心类型。
 * 适配层将各厂商 images API 归一为 bytes 输出，落盘与对话注入由工具层完成。
 */

import type { LlmProviderId } from '../config/llmProviders';

/**
 * 适配器类别：OpenAI 兼容同步接口 / DashScope 原生异步任务接口 /
 * OpenRouter 统一 Image API（文生图与图生图共用单一 /images 端点）
 */
export type ImageGenAdapterKind =
  | 'openai-images'
  | 'dashscope-native'
  | 'openrouter-images';

export interface ImageGenRequest {
  prompt: string;
  /** 生成张数，默认 1 */
  n?: number;
  /** 尺寸，如 '1024x1024'；适配器负责转厂商格式 */
  size?: string;
  /** 反向提示词（仅部分厂商支持，其余忽略） */
  negativePrompt?: string;
}

export interface ImageEditRequest extends ImageGenRequest {
  referenceImages: Uint8Array[];
  referenceMimes: string[];
  mask?: Uint8Array;
  maskMime?: string;
}

export interface GeneratedImage {
  bytes: Uint8Array;
  mime: string;
}

export interface ImageGenResult {
  images: GeneratedImage[];
  warnings?: string[];
  /** 下载失败（如 CORS）时保底回传的原始图片链接（通常短期有效） */
  fallbackUrls?: string[];
  /** 厂商改写后的实际提示词（如 dall-e-3） */
  revisedPrompt?: string;
}

export type ImageGenProgressFn = (message: string) => void;

/** 调用生图 API 所需的全部已解析参数 */
export interface ResolvedImageGenContext {
  providerId: LlmProviderId;
  model: string;
  adapter: ImageGenAdapterKind;
  supportsEdit: boolean;
  /** 是否支持 negative_prompt */
  supportsNegativePrompt: boolean;
  /** 是否接受 size 参数 */
  supportsSize: boolean;
  /** 单次调用最大张数 */
  maxN: number;
  /**
   * API 基地址（已含代理/网关改写）：
   * - openai-images：OpenAI 兼容 base，如 https://api.openai.com/v1
   * - dashscope-native：原生 base，如 https://dashscope.aliyuncs.com/api/v1
   */
  baseURL: string;
  apiKey: string;
  fetchImpl: typeof fetch;
  /** 模型不接受 response_format 参数（如 gpt-image-1，恒返回 b64） */
  omitResponseFormat: boolean;
  /** 异步任务轮询总超时（毫秒） */
  pollTimeoutMs: number;
}

export interface ImageGenAdapter {
  generate(
    ctx: ResolvedImageGenContext,
    req: ImageGenRequest,
    signal?: AbortSignal,
    onProgress?: ImageGenProgressFn,
  ): Promise<ImageGenResult>;
  edit(
    ctx: ResolvedImageGenContext,
    req: ImageEditRequest,
    signal?: AbortSignal,
    onProgress?: ImageGenProgressFn,
  ): Promise<ImageGenResult>;
}
