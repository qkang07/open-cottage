/**
 * WASM 模块运行状态登记表。
 *
 * 与 Worker 不同，WASM kernel 跑在主线程且是懒加载的，没有 host/消息机制。
 * 本模块提供一个轻量登记表：各 kernel（cosine、tree-sitter）在加载 / 使用时
 * 上报状态，调试面板（workerMonitor + WorkerMonitorTab）统一读取与订阅，
 * 与现有 Worker 监控保持一致的呈现方式。
 *
 * 刻意不依赖任何 domain 模块，避免把重依赖带进 kernel 所在的包。
 */

export type WasmModuleState =
  | 'idle' // 尚未加载
  | 'loading' // 加载中
  | 'ready' // 已就绪
  | 'unsupported' // 环境不支持（如无 SIMD）
  | 'disabled' // 被配置关闭
  | 'error'; // 加载 / 运行失败

export interface WasmModuleStatus {
  id: string;
  label: string;
  description: string;
  state: WasmModuleState;
  /** 一行简述当前情况 */
  detail?: string;
  /** 额外指标，逐条展示（如“已加速 N 次检索”“语法包：typescript, tsx”） */
  metrics: string[];
  /** 最近一次错误信息 */
  lastError?: string;
  /** 最近一次被使用的时间戳 */
  lastUsedAt: number | null;
}

const registry = new Map<string, WasmModuleStatus>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** 注册一个 WASM 模块的元信息（幂等，保留已有运行态） */
export function registerWasmModule(init: {
  id: string;
  label: string;
  description: string;
  state?: WasmModuleState;
}): void {
  const existing = registry.get(init.id);
  registry.set(init.id, {
    id: init.id,
    label: init.label,
    description: init.description,
    state: init.state ?? existing?.state ?? 'idle',
    detail: existing?.detail,
    metrics: existing?.metrics ?? [],
    lastError: existing?.lastError,
    lastUsedAt: existing?.lastUsedAt ?? null,
  });
  notify();
}

/** 上报状态变更（局部合并）；未注册的 id 会被忽略 */
export function reportWasmStatus(
  id: string,
  patch: Partial<Omit<WasmModuleStatus, 'id' | 'label' | 'description'>>,
): void {
  const current = registry.get(id);
  if (!current) return;
  registry.set(id, { ...current, ...patch });
  notify();
}

/** 读取全部 WASM 模块状态快照 */
export function getWasmModuleStatuses(): WasmModuleStatus[] {
  return [...registry.values()];
}

/** 订阅状态变化（用于调试面板刷新） */
export function subscribeWasmModules(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
