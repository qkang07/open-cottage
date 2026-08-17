/** 适配器共享工具：b64 解码、超时合并、结果 URL 下载归一 */

import type { GeneratedImage } from './types';

export const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

/** bytes 编码为 base64（分块避免超大数组展开溢出调用栈） */
export const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
};

/** 合并请求超时与外部中断信号 */
export const withTimeout = (
  timeoutMs: number,
  signal?: AbortSignal,
): AbortSignal => {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
};

const mimeFromContentType = (contentType: string | null): string => {
  const value = contentType?.split(';')[0]?.trim().toLowerCase();
  return value?.startsWith('image/') ? value : 'image/png';
};

export interface UrlDownloadResult {
  images: GeneratedImage[];
  warnings: string[];
  fallbackUrls: string[];
}

/**
 * 下载结果图片 URL 并归一为 bytes。
 * 单个 URL 失败（常见为浏览器直连被 CORS 拦截）不中断整体，
 * 降级为 warning + 原始链接回传。
 * 传入的 fetchImpl 若经 Cottage Service 代理，可绕过 CORS。
 */
export async function downloadImageUrls(
  urls: readonly string[],
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<UrlDownloadResult> {
  const warnings: string[] = [];
  const fallbackUrls: string[] = [];
  const downloaded: GeneratedImage[] = [];
  for (const url of urls) {
    try {
      const response = await fetchImpl(url, { signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const buffer = await response.arrayBuffer();
      downloaded.push({
        bytes: new Uint8Array(buffer),
        mime: mimeFromContentType(response.headers.get('content-type')),
      });
    } catch (error) {
      fallbackUrls.push(url);
      warnings.push(
        `结果图片下载失败（${error instanceof Error ? error.message : String(error)}），` +
          '已附原始链接（通常短期有效）。建议连接 Cottage Service 并开启 HTTP 代理后重试，或改用返回 b64 的生图模型。',
      );
    }
  }
  return {
    images: downloaded,
    warnings,
    fallbackUrls,
  };
}

/** 读取响应错误详情（截断） */
export async function readErrorDetail(response: Response): Promise<string> {
  const detail = await response.text().catch(() => '');
  return detail.slice(0, 300);
}

/** 将工具请求张数钳到模型上限 */
export const clampImageCount = (
  n: number | undefined,
  maxN: number,
): number => {
  const raw = n ?? 1;
  if (!Number.isFinite(raw)) return 1;
  return Math.min(Math.max(1, Math.floor(raw)), Math.max(1, maxN));
};
