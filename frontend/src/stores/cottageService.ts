import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import type { CottageServiceConfig } from '../config/constants';
import { setCottageServiceHttpProxy } from '../config/cottageServiceProxy';
import { getCottageConfig, mergeCottageConfig } from '../config/store';
import { saveLayeredCottageConfig } from '../config/cottageStorage';
import { workspace } from '../workspace/FileSystemWorkspace';
import {
  createCottageServiceClient,
  discoverCottageServices,
  probeCottageServiceUrl,
  type CottageServiceClient,
  type DiscoveredCottageService,
} from '../cottageService/client';

/** Cottage Service 连接状态 */
export type CottageServiceStatus =
  | 'idle'
  | 'probing'
  | 'discovered'
  | 'connecting'
  | 'connected'
  | 'error';

/** 获取当前可写入的配置层级（工作空间打开时为 folder，否则为 domain） */
const writableLevel = (): 'folder' | 'domain' =>
  workspace.isOpen ? 'folder' : 'domain';

/** 读取 Cottage Service 配置（兼容旧版 localAgent 字段） */
const readServiceConfig = (): CottageServiceConfig | undefined => {
  const cfg = getCottageConfig();
  return cfg.cottageService ?? cfg.localAgent;
};

/** 同步 HTTP 代理配置 */
const syncHttpProxy = (baseUrl: string | null, useLlm: boolean): void => {
  setCottageServiceHttpProxy(useLlm, baseUrl ?? undefined);
};

/** 解析服务路由标志（LLM/搜索/抓取） */
const resolveRoutingFlags = (
  cfg: CottageServiceConfig | undefined,
  serverCaps: string[],
): Pick<CottageServiceConfig, 'useLlm' | 'useSearch' | 'useFetch'> => {
  const legacy = cfg?.enabledCapabilities;
  // useLlm 默认关（敏感）；search/fetch 在未显式配置时随服务端能力默认开
  return {
    useLlm:
      cfg?.useLlm ??
      Boolean(legacy?.includes('llm') || legacy?.includes('proxy')),
    useSearch:
      cfg?.useSearch ??
      Boolean(legacy?.includes('search') || serverCaps.includes('search')),
    useFetch:
      cfg?.useFetch ??
      Boolean(legacy?.includes('fetch') || serverCaps.includes('fetch')),
  };
};

/**
 * Cottage Service 连接状态管理。
 * 控制与 Cottage Service 的连接、能力发现、路由配置及持久化。
 */
export const useCottageServiceStore = defineStore('cottageService', () => {
  const status = ref<CottageServiceStatus>('idle');
  const error = ref<string | null>(null);
  const candidates = ref<DiscoveredCottageService[]>([]);
  const client = shallowRef<CottageServiceClient | null>(null);
  const connectedBaseUrl = ref<string | null>(null);
  const capabilities = ref<string[]>([]);
  const useLlm = ref(false);
  const useSearch = ref(false);
  const useFetch = ref(false);

  const routingCapabilities = computed(() => {
    const caps: string[] = [];
    if (useSearch.value) caps.push('search');
    if (useFetch.value) caps.push('fetch');
    if (useLlm.value) caps.push('proxy');
    return caps;
  });

  /** 应用路由配置到状态并同步 HTTP 代理 */
  function applyRouting(
    baseUrl: string | null,
    serverCaps: string[],
    routing: Pick<CottageServiceConfig, 'useLlm' | 'useSearch' | 'useFetch'>,
  ) {
    const allowed = new Set(serverCaps);
    useLlm.value = Boolean(routing.useLlm && allowed.has('proxy'));
    useSearch.value = Boolean(routing.useSearch && allowed.has('search'));
    useFetch.value = Boolean(routing.useFetch && allowed.has('fetch'));
    syncHttpProxy(baseUrl, useLlm.value);
  }

  /** 恢复上次的连接状态（应用启动时调用） */
  async function restore(): Promise<boolean> {
    const cfg = readServiceConfig();
    if (!cfg?.enabled || !cfg?.baseUrl) {
      status.value = 'idle';
      syncHttpProxy(null, false);
      return false;
    }

    try {
      const info = await probeCottageServiceUrl(cfg.baseUrl);
      if (!info.ok) {
        status.value = 'error';
        error.value = 'Cottage Service 不可达，请在设置中重新连接';
        syncHttpProxy(null, false);
        return false;
      }

      const resolvedUrl = info.baseUrl;
      const c = createCottageServiceClient(resolvedUrl);
      client.value = c;
      connectedBaseUrl.value = resolvedUrl;
      capabilities.value = info.capabilities;
      const routing = resolveRoutingFlags(cfg, info.capabilities);
      // 兼容旧落盘：已连接但 search/fetch 路由均为关（DEFAULT 写成 false），按服务能力补开
      if (
        !routing.useSearch &&
        !routing.useFetch &&
        !routing.useLlm &&
        (info.capabilities.includes('search') || info.capabilities.includes('fetch'))
      ) {
        if (info.capabilities.includes('search')) routing.useSearch = true;
        if (info.capabilities.includes('fetch')) routing.useFetch = true;
      }
      applyRouting(resolvedUrl, info.capabilities, routing);
      status.value = 'connected';

      const savedUrl = cfg.baseUrl.replace(/\/+$/, '');
      if (resolvedUrl !== savedUrl || routing.useSearch !== cfg.useSearch || routing.useFetch !== cfg.useFetch) {
        await saveLayeredCottageConfig(
          {
            cottageService: {
              baseUrl: resolvedUrl,
              useSearch: useSearch.value,
              useFetch: useFetch.value,
            },
          },
          { level: writableLevel() },
        );
        mergeCottageConfig({
          cottageService: {
            baseUrl: resolvedUrl,
            useSearch: useSearch.value,
            useFetch: useFetch.value,
          },
        });
      }
      return true;
    } catch (e) {
      status.value = 'error';
      error.value = e instanceof Error ? e.message : String(e);
      syncHttpProxy(null, false);
      return false;
    }
  }

  /** 发现可用的 Cottage Service 实例 */
  async function discover(extra?: string[]) {
    status.value = 'probing';
    error.value = null;
    try {
      const cfg = readServiceConfig();
      const extraUrls = extra ?? (cfg?.baseUrl ? [cfg.baseUrl] : []);
      const autoScan = cfg?.autoDiscover ?? true;
      const found = await discoverCottageServices(extraUrls, undefined, { autoScan });
      candidates.value = found;
      status.value = found.some((c) => c.ok) ? 'discovered' : 'error';
      if (status.value === 'error') {
        error.value = found.some((c) => c.certError)
          ? '探测到服务但 HTTPS 证书未信任，请在新窗口打开服务地址信任证书后重试'
          : '未探测到 Cottage Service，请确认服务已启动或手动填写地址';
      }
    } catch (e) {
      status.value = 'error';
      error.value = e instanceof Error ? e.message : String(e);
    }
  }

  /** 探测单个服务地址 */
  async function probeOne(baseUrl: string) {
    return probeCottageServiceUrl(baseUrl);
  }

  /** 连接到指定地址的 Cottage Service */
  async function connect(baseUrl: string) {
    status.value = 'connecting';
    error.value = null;
    try {
      const info = await probeCottageServiceUrl(baseUrl);
      if (!info.ok) {
        status.value = 'error';
        error.value = info.certError
          ? 'HTTPS 证书未信任，请在新窗口打开服务地址并按浏览器提示信任证书后重试'
          : `无法连接：${info.error ?? '未知错误'}`;
        return false;
      }

      const resolvedUrl = info.baseUrl;
      const c = createCottageServiceClient(resolvedUrl);
      client.value = c;
      connectedBaseUrl.value = resolvedUrl;
      capabilities.value = info.capabilities;

      const prev = readServiceConfig();
      const routing = resolveRoutingFlags(prev, info.capabilities);
      // 主动连接：按服务端能力默认打开搜索/抓取（LLM 代理仍尊重配置，默认关）
      if (info.capabilities.includes('search')) routing.useSearch = true;
      if (info.capabilities.includes('fetch')) routing.useFetch = true;
      applyRouting(resolvedUrl, info.capabilities, routing);
      status.value = 'connected';

      const patch: CottageServiceConfig = {
        enabled: true,
        connected: true,
        baseUrl: resolvedUrl,
        autoDiscover: prev?.autoDiscover ?? true,
        lastHealthAt: Date.now(),
        capabilities: info.capabilities,
        useLlm: useLlm.value,
        useSearch: useSearch.value,
        useFetch: useFetch.value,
      };

      await saveLayeredCottageConfig(
        { cottageService: patch },
        { level: writableLevel() },
      );
      mergeCottageConfig({ cottageService: patch, localAgent: undefined });
      return true;
    } catch (e) {
      status.value = 'error';
      error.value = e instanceof Error ? e.message : String(e);
      return false;
    }
  }

  /** 断开当前连接 */
  async function disconnect() {
    client.value = null;
    connectedBaseUrl.value = null;
    capabilities.value = [];
    useLlm.value = false;
    useSearch.value = false;
    useFetch.value = false;
    syncHttpProxy(null, false);
    status.value = 'idle';
    error.value = null;

    await saveLayeredCottageConfig(
      { cottageService: { enabled: false, connected: false } },
      { level: writableLevel() },
    );
    mergeCottageConfig({
      cottageService: { enabled: false, connected: false },
      localAgent: undefined,
    });
  }

  /** 持久化当前路由配置 */
  async function persistRouting() {
    const patch = {
      useLlm: useLlm.value,
      useSearch: useSearch.value,
      useFetch: useFetch.value,
    };
    await saveLayeredCottageConfig(
      { cottageService: patch },
      { level: writableLevel() },
    );
    mergeCottageConfig({ cottageService: patch });
    syncHttpProxy(connectedBaseUrl.value, useLlm.value);
  }

  /** 设置是否使用 LLM 代理 */
  async function setUseLlm(enabled: boolean) {
    if (!capabilities.value.includes('proxy')) return;
    useLlm.value = enabled;
    await persistRouting();
  }

  /** 设置是否使用搜索代理 */
  async function setUseSearch(enabled: boolean) {
    if (!capabilities.value.includes('search')) return;
    useSearch.value = enabled;
    await persistRouting();
  }

  /** 设置是否使用抓取代理 */
  async function setUseFetch(enabled: boolean) {
    if (!capabilities.value.includes('fetch')) return;
    useFetch.value = enabled;
    await persistRouting();
  }

  /** 检查服务是否具备指定能力 */
  function hasCapability(cap: string): boolean {
    return capabilities.value.includes(cap);
  }

  /** 检查指定路由是否已启用 */
  function isRoutingEnabled(cap: 'proxy' | 'search' | 'fetch'): boolean {
    if (!isConnected()) return false;
    if (cap === 'proxy') return useLlm.value;
    if (cap === 'search') return useSearch.value;
    return useFetch.value;
  }

  /** 获取当前服务客户端实例 */
  function getClient(): CottageServiceClient | null {
    return client.value;
  }

  /** 检查服务是否已连接 */
  function isConnected(): boolean {
    return status.value === 'connected' && client.value !== null;
  }

  return {
    status,
    error,
    candidates,
    connectedBaseUrl,
    capabilities,
    useLlm,
    useSearch,
    useFetch,
    routingCapabilities,
    restore,
    discover,
    probeOne,
    connect,
    disconnect,
    setUseLlm,
    setUseSearch,
    setUseFetch,
    hasCapability,
    isRoutingEnabled,
    getClient,
    isConnected,
  };
});
