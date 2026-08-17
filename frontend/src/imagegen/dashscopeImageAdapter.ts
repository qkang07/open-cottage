/**
 * DashScope（通义万相）原生生图适配器：异步任务模式。
 * 建任务（X-DashScope-Async: enable）→ 轮询 /tasks/{id} → 下载结果 URL。
 * 接口与模型参数以阿里云百炼文档为准。
 */

import type {
  ImageEditRequest,
  ImageGenAdapter,
  ImageGenProgressFn,
  ImageGenRequest,
  ImageGenResult,
  ResolvedImageGenContext,
} from './types';
import {
  clampImageCount,
  downloadImageUrls,
  readErrorDetail,
  withTimeout,
} from './shared';

const CREATE_TIMEOUT_MS = 60_000;
const POLL_INITIAL_INTERVAL_MS = 3_000;
const POLL_MAX_INTERVAL_MS = 10_000;

interface DashScopeTaskResponse {
  request_id?: string;
  output?: {
    task_id?: string;
    task_status?: string;
    message?: string;
    results?: { url?: string; code?: string; message?: string }[];
  };
  message?: string;
  code?: string;
}

/** '1024x1024' → '1024*1024'（DashScope 尺寸分隔符） */
const toDashScopeSize = (size: string): string => size.replace(/[xX×]/g, '*');

const bytesToDataUrl = (bytes: Uint8Array, mime: string): string => {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
};

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason instanceof Error ? signal.reason : new Error('已中断'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });

async function createTask(
  ctx: ResolvedImageGenContext,
  path: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<string> {
  const response = await ctx.fetchImpl(`${ctx.baseURL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ctx.apiKey}`,
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify(body),
    signal: withTimeout(CREATE_TIMEOUT_MS, signal),
  });
  if (!response.ok) {
    throw new Error(
      `通义万相任务创建失败（${response.status}）：${await readErrorDetail(response)}`,
    );
  }
  const payload = (await response.json()) as DashScopeTaskResponse;
  const taskId = payload.output?.task_id;
  if (!taskId) {
    throw new Error(
      `通义万相未返回任务 ID：${payload.message ?? payload.code ?? JSON.stringify(payload).slice(0, 200)}`,
    );
  }
  return taskId;
}

async function pollTask(
  ctx: ResolvedImageGenContext,
  taskId: string,
  signal: AbortSignal,
  onProgress?: ImageGenProgressFn,
): Promise<string[]> {
  const deadline = Date.now() + ctx.pollTimeoutMs;
  let interval = POLL_INITIAL_INTERVAL_MS;
  let attempt = 0;
  for (;;) {
    await sleep(interval, signal);
    interval = Math.min(interval * 1.5, POLL_MAX_INTERVAL_MS);
    attempt += 1;
    onProgress?.(
      `通义万相任务处理中（第 ${attempt} 次查询，任务 ${taskId.slice(0, 8)}…）`,
    );
    const response = await ctx.fetchImpl(`${ctx.baseURL}/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
      signal: withTimeout(CREATE_TIMEOUT_MS, signal),
    });
    if (!response.ok) {
      throw new Error(
        `通义万相任务查询失败（${response.status}）：${await readErrorDetail(response)}`,
      );
    }
    const payload = (await response.json()) as DashScopeTaskResponse;
    const status = payload.output?.task_status;
    if (status === 'SUCCEEDED') {
      const urls = (payload.output?.results ?? [])
        .map((r) => r.url)
        .filter((u): u is string => Boolean(u));
      if (!urls.length) {
        const firstError = payload.output?.results?.find((r) => r.message);
        throw new Error(
          `通义万相任务成功但无结果图片${firstError ? `：${firstError.message}` : ''}`,
        );
      }
      return urls;
    }
    if (status === 'FAILED' || status === 'CANCELED' || status === 'UNKNOWN') {
      throw new Error(
        `通义万相任务失败（${status}）：${payload.output?.message ?? payload.message ?? '无详细信息'}`,
      );
    }
    if (Date.now() > deadline) {
      throw new Error(
        `通义万相任务轮询超时（${Math.round(ctx.pollTimeoutMs / 1000)}s），任务 ID：${taskId}`,
      );
    }
  }
}

async function runTask(
  ctx: ResolvedImageGenContext,
  path: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
  onProgress?: ImageGenProgressFn,
): Promise<ImageGenResult> {
  const outer = withTimeout(ctx.pollTimeoutMs + CREATE_TIMEOUT_MS, signal);
  onProgress?.('正在创建通义万相异步任务…');
  const taskId = await createTask(ctx, path, body, outer);
  onProgress?.(`任务已创建（${taskId.slice(0, 8)}…），等待生成完成…`);
  const urls = await pollTask(ctx, taskId, outer, onProgress);
  onProgress?.(`任务完成，正在下载 ${urls.length} 张结果图…`);
  const downloaded = await downloadImageUrls(urls, ctx.fetchImpl, outer);
  return {
    images: downloaded.images,
    warnings: downloaded.warnings.length ? downloaded.warnings : undefined,
    fallbackUrls: downloaded.fallbackUrls.length
      ? downloaded.fallbackUrls
      : undefined,
  };
}

export const dashscopeImageAdapter: ImageGenAdapter = {
  generate(ctx, req: ImageGenRequest, signal, onProgress) {
    const input: Record<string, unknown> = { prompt: req.prompt };
    if (ctx.supportsNegativePrompt && req.negativePrompt) {
      input.negative_prompt = req.negativePrompt;
    }
    return runTask(
      ctx,
      '/services/aigc/text2image/image-synthesis',
      {
        model: ctx.model,
        input,
        parameters: {
          n: clampImageCount(req.n, ctx.maxN),
          ...(ctx.supportsSize && req.size
            ? { size: toDashScopeSize(req.size) }
            : {}),
        },
      },
      signal,
      onProgress,
    );
  },
  edit(ctx, req: ImageEditRequest, signal, onProgress) {
    const [image] = req.referenceImages;
    if (!image) {
      throw new Error('图片编辑需要至少一张参考图');
    }
    // wanx 图像编辑：description_edit + data URL；多参考图时仅用首张
    const input: Record<string, unknown> = {
      function: 'description_edit',
      prompt: req.prompt,
      base_image_url: bytesToDataUrl(
        image,
        req.referenceMimes[0] ?? 'image/png',
      ),
    };
    if (req.referenceImages.length > 1) {
      // 部分编辑模型支持额外参考；暂保留首张，其余忽略并在 warning 中说明由工具层处理
    }
    return runTask(
      ctx,
      '/services/aigc/image2image/image-synthesis',
      {
        model: ctx.model,
        input,
        parameters: {
          n: clampImageCount(req.n, ctx.maxN),
          ...(ctx.supportsSize && req.size
            ? { size: toDashScopeSize(req.size) }
            : {}),
        },
      },
      signal,
      onProgress,
    );
  },
};
