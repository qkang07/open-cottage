/**
 * Cottage Service 客户端与自动探测。
 *
 * 网页侧通过此模块连接伴随服务（可部署在本地或远端），
 * 获得联网搜索、跨域抓取、HTTP 代理等能力。
 */

export type CottageServiceSearchEngine = 'duckduckgo' | 'bing' | 'baidu' | 'google';

export const COTTAGE_SERVICE_SEARCH_ENGINES: readonly CottageServiceSearchEngine[] = [
  'duckduckgo',
  'bing',
  'baidu',
  'google',
];

export const isCottageServiceSearchProvider = (
  provider: string,
): provider is CottageServiceSearchEngine =>
  (COTTAGE_SERVICE_SEARCH_ENGINES as readonly string[]).includes(provider);

export interface CottageServiceProfile {
  profiles: string[];
  engines: CottageServiceSearchEngine[];
  capabilities?: string[];
}

export interface CottageServiceSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface CottageServiceSearchResponse {
  query: string;
  engine: CottageServiceSearchEngine;
  results: CottageServiceSearchResult[];
  note?: string;
  /** headless = 无头浏览器；http = 纯 HTTP 模拟 */
  mode?: 'headless' | 'http';
}

export interface CottageServiceFetchResult {
  url: string;
  status: number;
  profile: string;
  redirects: string[];
  contentType: string;
  content: string;
}

export interface CottageServiceScreenshotResult {
  url: string;
  title: string;
  format: 'png' | 'jpeg' | 'webp';
  viewport?: { width: number; height: number };
  image: string;
  size?: number;
}

export interface CottageServicePdfResult {
  url: string;
  title: string;
  format: 'pdf';
  pdf: string;
  size?: number;
}

export interface CottageServiceExtractResult {
  url: string;
  title: string;
  description?: string;
  author?: string;
  publishDate?: string;
  language?: string;
  content: string;
  textContent?: string;
  headings?: { level: number; text: string }[];
  links?: { text: string; href: string }[];
  images?: { src: string; alt: string }[];
  wordCount?: number;
  mode?: string;
  note?: string;
}

export interface CottageServiceBrowserSession {
  sessionId: string;
  url: string;
  title: string;
}

export interface CottageServiceBrowserActResult {
  ok: boolean;
  url: string;
  title: string;
  note?: string;
}

export interface DiscoveredCottageService {
  baseUrl: string;
  ok: boolean;
  certError?: boolean;
  capabilities: string[];
  engines?: CottageServiceSearchEngine[];
  profiles?: string[];
  latencyMs?: number;
  error?: string;
}

const DEFAULT_TIMEOUT = 4000;
const DEFAULT_CANDIDATE_PORTS = [8787, 8789, 9876];

interface BuildCandidatesOptions {
  autoScan?: boolean;
}

const buildCandidates = (
  extra: string[] = [],
  { autoScan = true }: BuildCandidatesOptions = {},
): string[] => {
  const set = new Set<string>();
  for (const url of extra) {
    const u = url.trim();
    if (u) set.add(u);
  }
  if (autoScan) {
    for (const port of DEFAULT_CANDIDATE_PORTS) {
      set.add(`https://127.0.0.1:${port}`);
      set.add(`http://127.0.0.1:${port}`);
      set.add(`https://localhost:${port}`);
      set.add(`http://localhost:${port}`);
    }
  }
  return Array.from(set);
};

const portGroupKey = (baseUrl: string): string => {
  try {
    const u = new URL(baseUrl);
    return u.port || (u.protocol === 'https:' ? '443' : '80');
  } catch {
    return baseUrl;
  }
};

const pickBetter = (
  prev: DiscoveredCottageService,
  cur: DiscoveredCottageService,
  manualSet: Set<string>,
): DiscoveredCottageService => {
  const prevManual = manualSet.has(prev.baseUrl);
  const curManual = manualSet.has(cur.baseUrl);
  if (curManual !== prevManual) return curManual ? cur : prev;
  if (cur.ok !== prev.ok) return cur.ok ? cur : prev;
  return (cur.latencyMs ?? 9999) < (prev.latencyMs ?? 9999) ? cur : prev;
};

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });

const isLikelyCertError = (error: unknown): boolean => {
  if (!(error instanceof TypeError)) return false;
  const msg = error.message.toLowerCase();
  return msg.includes('cert') || msg.includes('ssl') || msg.includes('tls');
};

const fetchJson = async <T>(url: string, ms = DEFAULT_TIMEOUT): Promise<T> => {
  const res = await withTimeout(fetch(url), ms);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
};

interface HealthResponse {
  ok?: boolean;
  ts?: string;
  llmProxy?: boolean;
  capabilities?: string[];
}

interface ProfilesResponse {
  profiles?: string[];
  engines?: CottageServiceSearchEngine[];
  capabilities?: string[];
}

export const probeCottageServiceUrl = async (
  baseUrl: string,
  ms = DEFAULT_TIMEOUT,
): Promise<DiscoveredCottageService> => {
  const trimmed = baseUrl.replace(/\/+$/, '');
  const start = performance.now();
  try {
    const health = await fetchJson<HealthResponse>(`${trimmed}/health`, ms);
    if (!health?.ok) {
      return {
        baseUrl: trimmed,
        ok: false,
        capabilities: [],
        error: '健康检查返回非 ok',
      };
    }

    const latencyMs = Math.round(performance.now() - start);
    let capabilities: string[] = ['search', 'fetch', 'proxy'];
    let engines: CottageServiceSearchEngine[] | undefined;
    let profiles: string[] | undefined;
    try {
      const prof = await fetchJson<ProfilesResponse>(`${trimmed}/profiles`, ms);
      engines = prof.engines;
      profiles = prof.profiles;
      if (prof.capabilities?.length) {
        capabilities = prof.capabilities;
      } else {
        capabilities = ['search', 'fetch', 'proxy'];
      }
    } catch {
      // 旧版本可能没有 /profiles
    }
    return {
      baseUrl: trimmed,
      ok: true,
      capabilities,
      engines,
      profiles,
      latencyMs,
    };
  } catch (error) {
    return {
      baseUrl: trimmed,
      ok: false,
      certError: isLikelyCertError(error),
      capabilities: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export const discoverCottageServices = async (
  extra: string[] = [],
  ms = DEFAULT_TIMEOUT,
  opts: { autoScan?: boolean } = {},
): Promise<DiscoveredCottageService[]> => {
  const { autoScan = true } = opts;
  const candidates = buildCandidates(extra, { autoScan });
  const manualSet = new Set(
    extra.map((u) => u.trim().replace(/\/+$/, '')).filter(Boolean),
  );
  const results = await Promise.all(
    candidates.map((url) => probeCottageServiceUrl(url, ms)),
  );
  const visible = results.filter((r) => r.ok || r.certError);
  const byPort = new Map<string, DiscoveredCottageService>();
  for (const r of visible) {
    const key = portGroupKey(r.baseUrl);
    const prev = byPort.get(key);
    byPort.set(key, prev ? pickBetter(prev, r, manualSet) : r);
  }
  return Array.from(byPort.values()).sort((a, b) => {
    if (a.ok !== b.ok) return a.ok ? -1 : 1;
    return (a.latencyMs ?? 9999) - (b.latencyMs ?? 9999);
  });
};

export interface CottageServiceClient {
  readonly baseUrl: string;
  health(): Promise<boolean>;
  profiles(): Promise<CottageServiceProfile>;
  search(
    query: string,
    opts?: { engine?: CottageServiceSearchEngine; limit?: number },
  ): Promise<CottageServiceSearchResponse>;
  fetchPage(
    url: string,
    opts?: { maxLength?: number; profile?: string; referer?: string },
  ): Promise<CottageServiceFetchResult>;
  screenshot(
    url: string,
    opts?: { fullPage?: boolean; format?: 'png' | 'jpeg' | 'webp'; quality?: number },
  ): Promise<CottageServiceScreenshotResult>;
  /** HTML 或 URL 打印为 PDF（需服务端 pdf 能力） */
  printPdf(opts: {
    html?: string;
    url?: string;
    landscape?: boolean;
    preferCSSPageSize?: boolean;
  }): Promise<CottageServicePdfResult>;
  extract(url: string): Promise<CottageServiceExtractResult>;
  browserOpen(
    url: string,
    opts?: { viewportWidth?: number; viewportHeight?: number; referer?: string },
  ): Promise<CottageServiceBrowserSession>;
  browserNavigate(sessionId: string, url: string): Promise<CottageServiceBrowserSession>;
  browserClick(
    sessionId: string,
    selector: string,
    text?: string,
  ): Promise<CottageServiceBrowserActResult>;
  browserType(
    sessionId: string,
    selector: string,
    value: string,
    text?: string,
  ): Promise<CottageServiceBrowserActResult>;
  browserSelect(
    sessionId: string,
    selector: string,
    value: string,
  ): Promise<CottageServiceBrowserActResult>;
  browserScreenshot(
    sessionId: string,
    opts?: { fullPage?: boolean; format?: 'png' | 'jpeg' | 'webp'; quality?: number },
  ): Promise<CottageServiceScreenshotResult>;
  browserExtract(sessionId: string): Promise<CottageServiceExtractResult>;
  browserClose(sessionId: string): Promise<{ ok: boolean }>;
}

export const createCottageServiceClient = (
  baseUrl: string,
): CottageServiceClient => {
  const base = baseUrl.replace(/\/+$/, '');
  const call = async <T>(
    path: string,
    init?: RequestInit,
    ms = 20_000,
  ): Promise<T> => {
    const res = await withTimeout(fetch(`${base}${path}`, init), ms);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `cottage-service ${path} HTTP ${res.status}${text ? `: ${text}` : ''}`,
      );
    }
    return (await res.json()) as T;
  };

  return {
    baseUrl: base,

    async health() {
      try {
        const h = await call<HealthResponse>('/health', undefined, 4000);
        return Boolean(h?.ok);
      } catch {
        return false;
      }
    },

    async profiles() {
      const p = await call<ProfilesResponse>('/profiles', undefined, 4000);
      return {
        profiles: p.profiles ?? [],
        engines: p.engines ?? [],
        capabilities: p.capabilities,
      };
    },

    async search(query, opts) {
      const params = new URLSearchParams({ q: query });
      if (opts?.engine) params.set('engine', opts.engine);
      if (opts?.limit) params.set('limit', String(opts.limit));
      return call<CottageServiceSearchResponse>(`/search?${params.toString()}`);
    },

    async fetchPage(url, opts) {
      const params = new URLSearchParams({ url });
      if (opts?.maxLength) params.set('maxLength', String(opts.maxLength));
      if (opts?.profile) params.set('profile', opts.profile);
      if (opts?.referer) params.set('referer', opts.referer);
      return call<CottageServiceFetchResult>(`/fetch?${params.toString()}`);
    },

    async screenshot(url, opts) {
      return call<CottageServiceScreenshotResult>(
        '/screenshot',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url,
            fullPage: opts?.fullPage ?? true,
            format: opts?.format ?? 'png',
            quality: opts?.quality,
          }),
        },
        40_000,
      );
    },

    async printPdf(opts) {
      return call<CottageServicePdfResult>(
        '/pdf',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            html: opts.html,
            url: opts.url,
            landscape: opts.landscape ?? false,
            printBackground: true,
            preferCSSPageSize: opts.preferCSSPageSize ?? true,
            waitForRender: true,
          }),
        },
        90_000,
      );
    },

    async extract(url) {
      return call<CottageServiceExtractResult>(
        '/extract',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        },
        40_000,
      );
    },

    async browserOpen(url, opts) {
      return call<CottageServiceBrowserSession>(
        '/browser/open',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url,
            viewportWidth: opts?.viewportWidth,
            viewportHeight: opts?.viewportHeight,
            referer: opts?.referer,
          }),
        },
        45_000,
      );
    },

    async browserNavigate(sessionId, url) {
      return call<CottageServiceBrowserSession>(
        '/browser/navigate',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, url }),
        },
        45_000,
      );
    },

    async browserClick(sessionId, selector, text) {
      return call<CottageServiceBrowserActResult>('/browser/click', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, selector, text }),
      });
    },

    async browserType(sessionId, selector, value, text) {
      return call<CottageServiceBrowserActResult>('/browser/type', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, selector, value, text }),
      });
    },

    async browserSelect(sessionId, selector, value) {
      return call<CottageServiceBrowserActResult>('/browser/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, selector, value }),
      });
    },

    async browserScreenshot(sessionId, opts) {
      return call<CottageServiceScreenshotResult>(
        '/browser/screenshot',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            fullPage: opts?.fullPage ?? false,
            format: opts?.format ?? 'png',
            quality: opts?.quality,
          }),
        },
        40_000,
      );
    },

    async browserExtract(sessionId) {
      return call<CottageServiceExtractResult>(
        '/browser/extract',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        },
        40_000,
      );
    },

    async browserClose(sessionId) {
      return call<{ ok: boolean }>('/browser/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
    },
  };
};

/** 在新标签页打开此 URL，引导用户信任自签名 HTTPS 证书 */
export const cottageServiceTrustUrl = (baseUrl: string): string =>
  `${baseUrl.replace(/\/+$/, '')}/health`;

export const mapProviderToCottageServiceEngine = (
  provider: CottageServiceSearchEngine,
): CottageServiceSearchEngine => provider;
