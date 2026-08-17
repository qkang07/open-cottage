/**
 * OpenRouter 统一 Image API 适配器：
 * 文生图与图生图共用 POST {base}/images（JSON）端点，
 * 图生图以 input_references 传 base64 data URL 的参考图（不支持 mask）。
 * 响应恒为 data[].b64_json（media_type 标识实际格式），无 response_format 参数。
 */

import type {
  GeneratedImage,
  ImageGenAdapter,
  ImageGenResult,
  ResolvedImageGenContext,
} from './types';
import {
  base64ToBytes,
  bytesToBase64,
  clampImageCount,
  readErrorDetail,
  withTimeout,
} from './shared';

const REQUEST_TIMEOUT_MS = 180_000;

interface OpenRouterImageItem {
  b64_json?: string;
  /** 实际输出格式（如 image/png、image/jpeg、image/svg+xml），缺省按 png */
  media_type?: string;
}

interface OpenRouterImagesResponse {
  data?: OpenRouterImageItem[];
}

function normalizeResponse(payload: OpenRouterImagesResponse): ImageGenResult {
  const items = payload.data ?? [];
  if (!items.length) {
    throw new Error('生图接口返回为空（无 data 字段）');
  }
  const images: GeneratedImage[] = [];
  for (const item of items) {
    if (!item.b64_json) continue;
    const mime = item.media_type?.startsWith('image/')
      ? item.media_type
      : 'image/png';
    images.push({ bytes: base64ToBytes(item.b64_json), mime });
  }
  if (!images.length) {
    throw new Error('生图接口返回为空（data 中无 b64_json）');
  }
  return { images };
}

async function requestImages(
  ctx: ResolvedImageGenContext,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<OpenRouterImagesResponse> {
  const response = await ctx.fetchImpl(`${ctx.baseURL}/images`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ctx.apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    throw new Error(
      `生图请求失败（${response.status}）：${await readErrorDetail(response)}`,
    );
  }
  return (await response.json()) as OpenRouterImagesResponse;
}

export const openRouterImagesAdapter: ImageGenAdapter = {
  async generate(ctx, req, signal, onProgress) {
    onProgress?.('正在经 OpenRouter 请求文生图…');
    const merged = withTimeout(REQUEST_TIMEOUT_MS, signal);
    const body: Record<string, unknown> = {
      model: ctx.model,
      prompt: req.prompt,
      n: clampImageCount(req.n, ctx.maxN),
    };
    // OpenRouter 的 size 接受显式像素（如 1024x1024），由上游按能力裁剪
    if (ctx.supportsSize && req.size) body.size = req.size;
    const payload = await requestImages(ctx, body, merged);
    onProgress?.('正在解析生成结果…');
    return normalizeResponse(payload);
  },
  async edit(ctx, req, signal, onProgress) {
    onProgress?.('正在经 OpenRouter 请求图生图…');
    const merged = withTimeout(REQUEST_TIMEOUT_MS, signal);
    const body: Record<string, unknown> = {
      model: ctx.model,
      prompt: req.prompt,
      n: clampImageCount(req.n, ctx.maxN),
      input_references: req.referenceImages.map((bytes, i) => {
        const mime = req.referenceMimes[i] ?? 'image/png';
        return {
          type: 'image_url',
          image_url: { url: `data:${mime};base64,${bytesToBase64(bytes)}` },
        };
      }),
    };
    if (ctx.supportsSize && req.size) body.size = req.size;
    const payload = await requestImages(ctx, body, merged);
    onProgress?.('正在解析编辑结果…');
    return normalizeResponse(payload);
  },
};
