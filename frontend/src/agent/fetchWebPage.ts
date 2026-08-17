import type { CottageServiceClient } from '../cottageService/client';
import { fetchHtmlDocument, openUrlInNewTab } from './browserFetch';
import { htmlToText } from './htmlToText';

const DEFAULT_MAX_LENGTH = 80_000;
const STREAM_TEXT_CHUNK = 4096;

type FetchStreamChunk =
  | { type: 'delta'; text: string }
  | { type: 'done'; value: unknown };

export const normalizeHttpUrl = (raw: string): string => {
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error('url 必须是 http 或 https 链接');
  }
  return new URL(trimmed).toString();
};

const truncate = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n\n[内容已截断，原文共 ${text.length} 字符]`;
};

const bodyToText = (body: string, contentType: string): string => {
  if (/html|xml/i.test(contentType)) {
    return htmlToText(body);
  }
  return body;
};

export interface FetchWebPageOptions {
  maxLength?: number;
}

export interface FetchWebPageResult {
  url: string;
  content: string;
  via?: 'direct' | 'cors-proxy' | 'cottage-service' | 'fallback' | 'browser';
  status?: number;
  warning?: string;
}

const checkAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw new DOMException('抓取已取消', 'AbortError');
  }
};

const delta = (text: string): FetchStreamChunk => ({ type: 'delta', text });

async function* yieldTextChunks(text: string): AsyncGenerator<FetchStreamChunk> {
  for (let i = 0; i < text.length; i += STREAM_TEXT_CHUNK) {
    yield delta(text.slice(i, i + STREAM_TEXT_CHUNK));
  }
}

export const fetchWebPageContent = async (
  rawUrl: string,
  options?: FetchWebPageOptions,
): Promise<FetchWebPageResult> => {
  const url = normalizeHttpUrl(rawUrl);
  const maxLength = options?.maxLength ?? DEFAULT_MAX_LENGTH;

  try {
    const { html, via } = await fetchHtmlDocument(url);
    const text = bodyToText(html, 'text/html');
    if (!text.trim()) {
      throw new Error('页面未解析到可读文本');
    }
    return {
      url,
      content: truncate(text, maxLength),
      via,
    };
  } catch (error) {
    openUrlInNewTab(url);
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `无法在本页抓取该 URL：${detail}。已在新标签页打开页面；因浏览器跨域限制，无法自动读取新标签中的内容。请换用可直连的链接，或让用户复制正文。`,
    );
  }
};

export interface StreamFetchWebPageOptions extends FetchWebPageOptions {
  cottageService?: CottageServiceClient;
  useCottageFetch?: boolean;
}

export async function* streamFetchWebPageContent(
  rawUrl: string,
  options?: StreamFetchWebPageOptions,
  signal?: AbortSignal,
): AsyncGenerator<FetchStreamChunk> {
  const url = normalizeHttpUrl(rawUrl);
  const maxLength = options?.maxLength ?? DEFAULT_MAX_LENGTH;

  yield delta(`抓取 ${url}\n`);
  checkAborted(signal);

  if (options?.useCottageFetch && options.cottageService) {
    try {
      yield delta('经 Cottage Service 抓取…\n');
      const res = await options.cottageService.fetchPage(url);
      checkAborted(signal);
      if (!res.content.trim()) {
        throw new Error('页面未解析到可读文本');
      }
      yield delta(`已获取 ${res.content.length} 字符，流式输出…\n`);
      yield* yieldTextChunks(res.content);
      yield {
        type: 'done',
        value: {
          url: res.url,
          content: truncate(res.content, maxLength),
          via: 'cottage-service',
          status: res.status,
        },
      };
      return;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      yield delta(`Cottage Service 失败（${detail}），回退浏览器…\n`);
    }
  }

  try {
    yield delta('浏览器内抓取…\n');
    const { html, via } = await fetchHtmlDocument(url);
    checkAborted(signal);
    yield delta(`已下载 ${html.length} 字节，解析 HTML…\n`);
    const text = bodyToText(html, 'text/html');
    if (!text.trim()) {
      throw new Error('页面未解析到可读文本');
    }
    yield delta(`正文 ${text.length} 字符，流式输出…\n`);
    yield* yieldTextChunks(text);
    yield {
      type: 'done',
      value: {
        url,
        content: truncate(text, maxLength),
        via,
      },
    };
  } catch (error) {
    openUrlInNewTab(url);
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `无法在本页抓取该 URL：${detail}。已在新标签页打开页面；因浏览器跨域限制，无法自动读取新标签中的内容。请换用可直连的链接，或让用户复制正文。`,
    );
  }
}
