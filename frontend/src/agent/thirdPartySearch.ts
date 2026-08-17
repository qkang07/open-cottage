import type { ThirdPartySearchProviderId } from '../config/constants';
import { resolveSearchProxyUrl } from '../config/aiProxy';

/** 单条搜索结果 */
interface SearchResultItem {
  title?: string;
  url?: string;
  snippet?: string;
}

/** 供 UI 渲染的第三方搜索 provider 列表 */
export const THIRD_PARTY_SEARCH_PROVIDERS: ThirdPartySearchProviderId[] = [
  'tavily',
  'bing',
  'brave',
  'serper',
  'exa',
];

/** 第三方搜索 provider 的展示名 */
export const thirdPartySearchProviderLabel = (
  id: ThirdPartySearchProviderId,
): string => {
  switch (id) {
    case 'tavily':
      return 'Tavily';
    case 'bing':
      return 'Bing Search';
    case 'brave':
      return 'Brave Search';
    case 'serper':
      return 'Serper';
    case 'exa':
      return 'Exa';
    default:
      return id;
  }
};

/** 统一格式化搜索结果为文本（title/url/snippet + 可选 answer 摘要） */
const formatResultLines = (
  items: SearchResultItem[],
  summary?: string,
): string => {
  const parts: string[] = [];
  if (summary?.trim()) parts.push(summary.trim());
  for (const item of items) {
    parts.push(
      `- ${item.title ?? '(无标题)'}\n  ${item.url ?? ''}\n  ${item.snippet ?? ''}`,
    );
  }
  return parts.join('\n\n') || '未找到结果';
};

const ensureOk = async (
  response: Response,
  label: string,
): Promise<void> => {
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${label} 搜索失败: ${response.status} ${text}`);
  }
};

/** Tavily：POST /search，body 携带 api_key */
const searchWithTavily = async (
  query: string,
  apiKey: string,
): Promise<string> => {
  const response = await fetch(resolveSearchProxyUrl('tavily', '/search'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: 8,
      include_answer: true,
    }),
  });
  await ensureOk(response, 'Tavily');
  const data = (await response.json()) as {
    answer?: string;
    results?: { title?: string; url?: string; content?: string }[];
  };
  return formatResultLines(
    (data.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
    })),
    data.answer,
  );
};

/** Bing Web Search v7：GET /v7.0/search，header Ocp-Apim-Subscription-Key */
const searchWithBing = async (
  query: string,
  apiKey: string,
): Promise<string> => {
  const url = resolveSearchProxyUrl(
    'bing',
    `/v7.0/search?q=${encodeURIComponent(query)}&count=8`,
  );
  const response = await fetch(url, {
    headers: { 'Ocp-Apim-Subscription-Key': apiKey },
  });
  await ensureOk(response, 'Bing');
  const data = (await response.json()) as {
    webPages?: { value?: { name?: string; url?: string; snippet?: string }[] };
  };
  return formatResultLines(
    (data.webPages?.value ?? []).map((r) => ({
      title: r.name,
      url: r.url,
      snippet: r.snippet,
    })),
  );
};

/** Brave Search：GET /res/v1/web/search，header X-Subscription-Token */
const searchWithBrave = async (
  query: string,
  apiKey: string,
): Promise<string> => {
  const url = resolveSearchProxyUrl(
    'brave',
    `/res/v1/web/search?q=${encodeURIComponent(query)}&count=8`,
  );
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': apiKey,
    },
  });
  await ensureOk(response, 'Brave');
  const data = (await response.json()) as {
    web?: { results?: { title?: string; url?: string; description?: string }[] };
  };
  return formatResultLines(
    (data.web?.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.description,
    })),
  );
};

/** Serper（google.serper.dev）：POST /search，header X-API-KEY */
const searchWithSerper = async (
  query: string,
  apiKey: string,
): Promise<string> => {
  const response = await fetch(resolveSearchProxyUrl('serper', '/search'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': apiKey,
    },
    body: JSON.stringify({ q: query, num: 8 }),
  });
  await ensureOk(response, 'Serper');
  const data = (await response.json()) as {
    answerBox?: { answer?: string; snippet?: string };
    organic?: { title?: string; link?: string; snippet?: string }[];
  };
  const answer = data.answerBox?.answer ?? data.answerBox?.snippet;
  return formatResultLines(
    (data.organic ?? []).map((r) => ({
      title: r.title,
      url: r.link,
      snippet: r.snippet,
    })),
    answer,
  );
};

/** Exa：POST /search，header x-api-key，返回正文片段 */
const searchWithExa = async (
  query: string,
  apiKey: string,
): Promise<string> => {
  const response = await fetch(resolveSearchProxyUrl('exa', '/search'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      query,
      numResults: 8,
      contents: { text: { maxCharacters: 500 } },
    }),
  });
  await ensureOk(response, 'Exa');
  const data = (await response.json()) as {
    results?: { title?: string; url?: string; text?: string }[];
  };
  return formatResultLines(
    (data.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.text,
    })),
  );
};

/** 统一入口：按 provider 调用对应第三方搜索 API */
export const runThirdPartySearch = async (
  provider: ThirdPartySearchProviderId,
  query: string,
  apiKey: string,
): Promise<string> => {
  const keyword = query.trim();
  if (!keyword) throw new Error('query 不能为空');
  const key = apiKey.trim();
  if (!key) {
    throw new Error(
      `请先在设置中配置 ${thirdPartySearchProviderLabel(provider)} 的 API Key`,
    );
  }
  switch (provider) {
    case 'tavily':
      return searchWithTavily(keyword, key);
    case 'bing':
      return searchWithBing(keyword, key);
    case 'brave':
      return searchWithBrave(keyword, key);
    case 'serper':
      return searchWithSerper(keyword, key);
    case 'exa':
      return searchWithExa(keyword, key);
    default:
      throw new Error(`未知的第三方搜索来源: ${provider}`);
  }
};
