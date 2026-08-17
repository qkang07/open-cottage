import { jsxAstAdapter } from './adapters/jsxAdapter';
import { tsAstAdapter } from './adapters/tsAdapter';
import { vueAstAdapter } from './adapters/vueAdapter';
import type { AstOps } from './types';

const adapterLoaders: Record<string, () => Promise<AstOps>> = {
  [tsAstAdapter.id]: () => tsAstAdapter.load(),
  [jsxAstAdapter.id]: () => jsxAstAdapter.load(),
  [vueAstAdapter.id]: () => vueAstAdapter.load(),
};

const opsCache = new Map<string, AstOps>();

export const loadAstOpsByAdapterId = async (adapterId: string): Promise<AstOps> => {
  const cached = opsCache.get(adapterId);
  if (cached) return cached;
  const loader = adapterLoaders[adapterId];
  if (!loader) throw new Error(`未知 AST adapter: ${adapterId}`);
  const ops = await loader();
  opsCache.set(adapterId, ops);
  return ops;
};
