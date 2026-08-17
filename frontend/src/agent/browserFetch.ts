const DEFAULT_TIMEOUT_MS = 20_000;

const BROWSER_HEADERS: HeadersInit = {
  Accept: 'text/html,application/xhtml+xml,text/plain,*/*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

export type FetchHtmlResult = {
  html: string;
  via: 'direct' | 'cors-proxy';
};

const isAbortError = (error: unknown) =>
  error instanceof Error && error.name === 'AbortError';

const isLikelyCorsOrOpaque = (error: unknown): boolean => {
  if (!(error instanceof TypeError)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('cors') ||
    msg.includes('load failed')
  );
};

const fetchDirect = async (
  url: string,
  timeoutMs: number,
): Promise<string> => {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: BROWSER_HEADERS,
      redirect: 'follow',
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`抓取超时（${timeoutMs}ms）`);
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
};

const fetchViaCorsProxy = async (
  url: string,
  timeoutMs: number,
): Promise<string> => {
  const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(proxyUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`CORS 代理 HTTP ${response.status}`);
    }
    return await response.text();
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`CORS 代理超时（${timeoutMs}ms）`);
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
};

/** 在新标签页打开 URL（无法跨域读取页面内容时的兜底） */
export const openUrlInNewTab = (url: string): void => {
  window.open(url, '_blank', 'noopener,noreferrer');
};

/**
 * 浏览器内抓取 HTML：先直连 fetch，失败再经公共 CORS 代理。
 */
export const fetchHtmlDocument = async (
  url: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<FetchHtmlResult> => {
  try {
    const html = await fetchDirect(url, timeoutMs);
    return { html, via: 'direct' };
  } catch (directError) {
    if (!isLikelyCorsOrOpaque(directError)) {
      throw directError instanceof Error
        ? directError
        : new Error(String(directError));
    }
    try {
      const html = await fetchViaCorsProxy(url, timeoutMs);
      return { html, via: 'cors-proxy' };
    } catch (proxyError) {
      const directMsg =
        directError instanceof Error ? directError.message : String(directError);
      const proxyMsg =
        proxyError instanceof Error ? proxyError.message : String(proxyError);
      throw new Error(`直连失败（${directMsg}）；代理失败（${proxyMsg}）`);
    }
  }
};
