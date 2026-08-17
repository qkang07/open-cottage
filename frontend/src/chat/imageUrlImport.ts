import { fileToAttachment, type ChatAttachment } from './attachments';
import { getCottageConfig } from '../config/store';
import {
  createCottageServiceProxiedFetch,
  CottageServicePrivateNetworkBlockedError,
} from '../config/cottageServiceProxy';

/**
 * 图片链接下载导入：直接 fetch 下载，CORS/网络失败时回退 Cottage Service /proxy，
 * 校验 MIME 与体积后复用 fileToAttachment 的降采样链路生成附件。
 */

export type ImageUrlImportReason =
  | 'invalid_url'
  | 'not_image'
  | 'too_large'
  | 'cors_no_service'
  | 'private_blocked'
  | 'network';

export class ImageUrlImportError extends Error {
  constructor(
    readonly reason: ImageUrlImportReason,
    message: string,
  ) {
    super(message);
    this.name = 'ImageUrlImportError';
  }
}

export interface ImportImageOptions {
  /** Cottage Service base URL（在线时用于 CORS 回退；null/缺省表示不可用） */
  serviceBaseUrl?: string | null;
  /** 测试注入 */
  fetchFn?: typeof fetch;
}

/** 校验图片链接（仅 http/https），返回规范化 URL */
export const validateImageUrl = (raw: string): URL => {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ImageUrlImportError('invalid_url', `无效的图片链接：${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ImageUrlImportError(
      'invalid_url',
      `仅支持 http/https 图片链接：${raw}`,
    );
  }
  return url;
};

/** 常见图片格式魔数嗅探（Content-Type 不可信时兜底） */
export const sniffImageMime = (bytes: Uint8Array): string | null => {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return 'image/gif';
  }
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return 'image/bmp';
  }
  return null;
};

/** 从 URL 末段提取文件名（无扩展名时按 MIME 补） */
const filenameFromUrl = (url: URL, mimeType: string): string => {
  const seg = url.pathname.split('/').filter(Boolean).pop() ?? '';
  const name = decodeURIComponent(seg) || 'image';
  if (/\.[a-z0-9]{2,5}$/i.test(name)) return name;
  const ext = mimeType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png';
  return `${name}.${ext}`;
};

/**
 * 下载图片为 Blob：先直接 fetch；CORS/网络失败回退 Cottage Service 代理。
 */
export const downloadImageBlob = async (
  url: URL,
  options?: ImportImageOptions,
): Promise<{ blob: Blob; mimeType: string }> => {
  const baseFetch = options?.fetchFn ?? globalThis.fetch.bind(globalThis);

  let res: Response | null = null;
  try {
    res = await baseFetch(url.href);
  } catch {
    // CORS 或网络失败：浏览器侧无法区分，统一走代理回退
    res = null;
  }

  if (!res || !res.ok) {
    const serviceBaseUrl = options?.serviceBaseUrl?.trim();
    if (!serviceBaseUrl) {
      if (res) {
        throw new ImageUrlImportError('network', `下载失败：HTTP ${res.status}`);
      }
      throw new ImageUrlImportError(
        'cors_no_service',
        '下载被浏览器 CORS 拦截或网络失败，且 Cottage Service 未连接',
      );
    }
    const proxiedFetch = createCottageServiceProxiedFetch(serviceBaseUrl, baseFetch);
    try {
      res = await proxiedFetch(url.href);
    } catch (error) {
      if (error instanceof CottageServicePrivateNetworkBlockedError) {
        throw new ImageUrlImportError('private_blocked', error.message);
      }
      throw new ImageUrlImportError(
        'network',
        error instanceof Error ? error.message : String(error),
      );
    }
    if (!res.ok) {
      throw new ImageUrlImportError('network', `代理下载失败：HTTP ${res.status}`);
    }
  }

  const blob = await res.blob();
  const headerType = res.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
  let mimeType = headerType || blob.type || '';
  if (!mimeType.startsWith('image/')) {
    const sniffed = sniffImageMime(
      new Uint8Array(await blob.slice(0, 16).arrayBuffer()),
    );
    if (!sniffed) {
      throw new ImageUrlImportError(
        'not_image',
        `链接内容不是图片（Content-Type: ${mimeType || '未知'}）`,
      );
    }
    mimeType = sniffed;
  }

  const maxBytes = getCottageConfig().vision?.maxImageBytes ?? 4_000_000;
  // 降采样可再压缩，下载硬上限放宽到配置值的 8 倍
  if (blob.size > maxBytes * 8) {
    throw new ImageUrlImportError(
      'too_large',
      `图片过大（${(blob.size / 1024 / 1024).toFixed(1)}MB），超出下载上限`,
    );
  }

  return { blob, mimeType };
};

/** 下载图片链接并转为聊天附件（含降采样） */
export const importImageFromUrl = async (
  raw: string,
  options?: ImportImageOptions,
): Promise<ChatAttachment> => {
  const url = validateImageUrl(raw);
  const { blob, mimeType } = await downloadImageBlob(url, options);
  const file = new File([blob], filenameFromUrl(url, mimeType), {
    type: mimeType,
  });
  return fileToAttachment(file);
};
