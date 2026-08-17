import type { AstCapabilitiesInfo, AstEditAdapter } from './types';

const adapters: AstEditAdapter[] = [];
const loadedOps = new Map<string, Awaited<ReturnType<AstEditAdapter['load']>>>();

/** 注册一个 AST 编辑适配器（按 id upsert）。在能力包启用时调用。 */
export const registerAstEditAdapter = (adapter: AstEditAdapter): void => {
  const idx = adapters.findIndex((a) => a.id === adapter.id);
  if (idx >= 0) adapters[idx] = adapter;
  else adapters.push(adapter);
};

export const listAstEditAdapters = (): AstEditAdapter[] => [...adapters];

export const resolveAstAdapter = (path: string): AstEditAdapter | undefined =>
  adapters.find((a) => a.supports(path));

/** 首次调用时 lazy import 解析器并缓存；后续直接返回。 */
export const loadAstOps = async (
  adapter: AstEditAdapter,
): Promise<ReturnType<AstEditAdapter['load']>> => {
  const cached = loadedOps.get(adapter.id);
  if (cached) return cached;
  const ops = await adapter.load();
  loadedOps.set(adapter.id, ops);
  return ops;
};

/** 供 astCapabilities 工具读取：零加载，仅读 declaredOps。 */
export const astCapabilitiesForPath = (path: string): AstCapabilitiesInfo | null => {
  const adapter = resolveAstAdapter(path);
  if (!adapter) return null;
  return {
    adapterId: adapter.id,
    ops: adapter.declaredOps,
    loaded: loadedOps.has(adapter.id),
  };
};
