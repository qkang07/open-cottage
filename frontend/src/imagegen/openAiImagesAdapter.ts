/**
 * 通用 OpenAI 兼容生图适配器：
 * POST {base}/images/generations（JSON）与 POST {base}/images/edits（multipart）。
 * 覆盖 OpenAI / 智谱 / 硅基流动 / 豆包方舟等兼容厂商。
 * multipart 经 Cottage Service 代理时由前端 base64 编码，服务端解码转发。
 */

import type {
  GeneratedImage,
  ImageEditRequest,
  ImageGenAdapter,
  ImageGenRequest,
  ImageGenResult,
  ResolvedImageGenContext,
} from './types';
import {
  base64ToBytes,
  clampImageCount,
  downloadImageUrls,
  readErrorDetail,
  withTimeout,
} from './shared';

const REQUEST_TIMEOUT_MS = 180_000;

interface OpenAiImageItem {
  b64_json?: string;
  url?: string;
  revised_prompt?: string;
}

interface OpenAiImagesResponse {
  data?: OpenAiImageItem[];
  /** 部分厂商（如硅基流动）使用 images 字段 */
  images?: OpenAiImageItem[];
}

async function normalizeResponse(
  payload: OpenAiImagesResponse,
  ctx: ResolvedImageGenContext,
  signal: AbortSignal,
): Promise<ImageGenResult> {
  const items = payload.data ?? payload.images ?? [];
  if (!items.length) {
    throw new Error('生图接口返回为空（无 data/images 字段）');
  }
  const images: GeneratedImage[] = [];
  const pendingUrls: string[] = [];
  let revisedPrompt: string | undefined;
  for (const item of items) {
    revisedPrompt = revisedPrompt ?? item.revised_prompt;
    if (item.b64_json) {
      images.push({ bytes: base64ToBytes(item.b64_json), mime: 'image/png' });
    } else if (item.url) {
      pendingUrls.push(item.url);
    }
  }
  if (!pendingUrls.length) {
    return { images, revisedPrompt };
  }
  const downloaded = await downloadImageUrls(pendingUrls, ctx.fetchImpl, signal);
  return {
    images: [...images, ...downloaded.images],
    revisedPrompt,
    warnings: downloaded.warnings.length ? downloaded.warnings : undefined,
    fallbackUrls: downloaded.fallbackUrls.length
      ? downloaded.fallbackUrls
      : undefined,
  };
}

async function requestGenerations(
  ctx: ResolvedImageGenContext,
  req: ImageGenRequest,
  signal: AbortSignal,
): Promise<OpenAiImagesResponse> {
  const body: Record<string, unknown> = {
    model: ctx.model,
    prompt: req.prompt,
    n: clampImageCount(req.n, ctx.maxN),
  };
  if (ctx.supportsSize && req.size) body.size = req.size;
  if (ctx.supportsNegativePrompt && req.negativePrompt) {
    body.negative_prompt = req.negativePrompt;
  }
  // 优先要 b64，避免浏览器直连结果 URL 被 CORS 拦住
  if (!ctx.omitResponseFormat) body.response_format = 'b64_json';

  const response = await ctx.fetchImpl(`${ctx.baseURL}/images/generations`, {
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
  return (await response.json()) as OpenAiImagesResponse;
}

async function requestEdits(
  ctx: ResolvedImageGenContext,
  req: ImageEditRequest,
  signal: AbortSignal,
): Promise<OpenAiImagesResponse> {
  const form = new FormData();
  form.set('model', ctx.model);
  form.set('prompt', req.prompt);
  form.set('n', String(clampImageCount(req.n, ctx.maxN)));
  if (ctx.supportsSize && req.size) form.set('size', req.size);
  if (!ctx.omitResponseFormat) form.set('response_format', 'b64_json');
  const imageField = req.referenceImages.length > 1 ? 'image[]' : 'image';
  req.referenceImages.forEach((bytes, i) => {
    const mime = req.referenceMimes[i] ?? 'image/png';
    const ext = mime.split('/')[1] ?? 'png';
    form.append(
      imageField,
      new Blob([bytes as BlobPart], { type: mime }),
      `reference-${i}.${ext}`,
    );
  });
  if (req.mask) {
    form.set(
      'mask',
      new Blob([req.mask as BlobPart], { type: req.maskMime ?? 'image/png' }),
      'mask.png',
    );
  }

  const response = await ctx.fetchImpl(`${ctx.baseURL}/images/edits`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ctx.apiKey}` },
    body: form,
    signal,
  });
  if (!response.ok) {
    throw new Error(
      `图片编辑请求失败（${response.status}）：${await readErrorDetail(response)}`,
    );
  }
  return (await response.json()) as OpenAiImagesResponse;
}

export const openAiImagesAdapter: ImageGenAdapter = {
  async generate(ctx, req, signal, onProgress) {
    onProgress?.('正在请求文生图…');
    const merged = withTimeout(REQUEST_TIMEOUT_MS, signal);
    const payload = await requestGenerations(ctx, req, merged);
    onProgress?.('正在解析生成结果…');
    return normalizeResponse(payload, ctx, merged);
  },
  async edit(ctx, req, signal, onProgress) {
    onProgress?.('正在请求图生图/编辑…');
    const merged = withTimeout(REQUEST_TIMEOUT_MS, signal);
    const payload = await requestEdits(ctx, req, merged);
    onProgress?.('正在解析编辑结果…');
    return normalizeResponse(payload, ctx, merged);
  },
};
