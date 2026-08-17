import { getDiffWorkerStatus } from '../../agent/diffWorkerHost';
import { getAstWorkerStatus } from '../../domains/coding/ast/astWorkerHost';
import {
  getIncrementalIndexDetail,
  isIncrementalIndexing,
  isMainThreadFullIndexing,
  subscribeIndexActivity,
} from '../../rag/indexer';
import { getBackgroundIndexState, subscribeBackgroundIndex } from '../../rag/indexBackground';
import {
  getIndexWorkerActiveRequestKind,
  getIndexWorkerStatus,
} from '../../rag/indexWorkerHost';
import type { IndexProgress } from '../../rag/types';
import { getSymbolWorkerStatus, subscribeSymbolWorker } from '../../domains/coding/symbolWorkerHost';
import { getCrawlerWorkerStatus } from '../../workspace/crawlerHost';
import { getDirChildrenCacheStats } from '../../workspace/dirChildrenCache';
import { getSnapshotWalkerStatus } from '../../workspace/snapshotWalkerHost';
import {
  getWasmModuleStatuses,
  subscribeWasmModules,
  type WasmModuleStatus,
} from './wasmStatus';
// 副作用引入：确保两个 WASM kernel 在面板初次采集前完成 registerWasmModule，
// 从而即使尚未使用也能在监控里看到“未加载”态。
import '../../rag/wasm/cosineKernel';
import '../../domains/coding/parsers/treeSitter';

export type WorkerKind = 'singleton' | 'ephemeral';

export type IndexJobKind =
  | 'idle'
  | 'full-worker'
  | 'full-main'
  | 'incremental-worker'
  | 'incremental-main';

export interface WorkerStatusEntry {
  id: string;
  label: string;
  description: string;
  kind: WorkerKind;
  alive: boolean;
  pendingRequests: number;
  busy: boolean;
  detail?: string;
}

export interface IndexJobStatus {
  active: boolean;
  kind: IndexJobKind;
  progress: IndexProgress | null;
  detail: string | null;
  workerAlive: boolean;
  workerInitializing: boolean;
  workerPending: number;
}

export interface MemoryStats {
  supported: boolean;
  usedMb?: number;
  totalMb?: number;
  limitMb?: number;
}

export interface SystemResourceSnapshot {
  hardwareConcurrency: number;
  deviceMemoryGb?: number;
  memory: MemoryStats;
  dirCache: { directoryCount: number; entryCount: number };
}

export interface WorkerMonitorSnapshot {
  workers: WorkerStatusEntry[];
  indexJob: IndexJobStatus;
  wasmModules: WasmModuleStatus[];
  resources: SystemResourceSnapshot;
  collectedAt: number;
}

let cachedDirStats: { directoryCount: number; entryCount: number } | null = null;
let cachedDirStatsAt = 0;
const DIR_STATS_TTL_MS = 10_000;

function readDirCacheStats(): { directoryCount: number; entryCount: number } {
  const now = Date.now();
  if (cachedDirStats && now - cachedDirStatsAt < DIR_STATS_TTL_MS) {
    return cachedDirStats;
  }
  cachedDirStats = getDirChildrenCacheStats();
  cachedDirStatsAt = now;
  return cachedDirStats;
}

function readMemoryStats(): MemoryStats {
  const perf = performance as Performance & {
    memory?: {
      usedJSHeapSize: number;
      totalJSHeapSize: number;
      jsHeapSizeLimit: number;
    };
  };
  const mem = perf.memory;
  if (!mem) {
    return { supported: false };
  }
  const toMb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;
  return {
    supported: true,
    usedMb: toMb(mem.usedJSHeapSize),
    totalMb: toMb(mem.totalJSHeapSize),
    limitMb: toMb(mem.jsHeapSizeLimit),
  };
}

function resolveIndexJobStatus(): IndexJobStatus {
  const bg = getBackgroundIndexState();
  const worker = getIndexWorkerStatus();
  const workerKind = getIndexWorkerActiveRequestKind();
  const incremental = isIncrementalIndexing();
  const mainFull = isMainThreadFullIndexing();

  let kind: IndexJobKind = 'idle';
  let progress: IndexProgress | null = null;
  let detail: string | null = null;

  if (workerKind === 'incrementalIndex' || (incremental && worker.busy)) {
    kind = 'incremental-worker';
    progress = worker.lastProgress;
    detail =
      worker.lastProgress?.detail
      ?? getIncrementalIndexDetail()
      ?? progress?.phase
      ?? null;
  } else if (incremental) {
    kind = 'incremental-main';
    detail = getIncrementalIndexDetail();
  } else if (worker.busy && workerKind === 'buildIndex') {
    kind = 'full-worker';
    progress = worker.lastProgress ?? bg.progress;
    detail = progress?.detail ?? progress?.phase ?? null;
  } else if (mainFull || bg.running) {
    kind = 'full-main';
    progress = bg.progress;
    detail = progress?.detail ?? progress?.phase ?? null;
  }

  const active = kind !== 'idle';

  return {
    active,
    kind,
    progress,
    detail,
    workerAlive: worker.alive,
    workerInitializing: worker.initializing,
    workerPending: worker.pendingRequests,
  };
}

export function collectWorkerMonitorSnapshot(): WorkerMonitorSnapshot {
  const crawler = getCrawlerWorkerStatus();
  const walker = getSnapshotWalkerStatus();
  const diff = getDiffWorkerStatus();
  const ast = getAstWorkerStatus();
  const index = getIndexWorkerStatus();
  const symbol = getSymbolWorkerStatus();
  const indexJob = resolveIndexJobStatus();

  const workers: WorkerStatusEntry[] = [
    {
      id: 'crawler',
      label: 'Crawler',
      description: '后台全量遍历工作区，预填充目录缓存',
      kind: 'singleton',
      alive: crawler.alive,
      pendingRequests: 0,
      busy: crawler.crawling,
      detail: crawler.crawling
        ? '遍历中'
        : crawler.initialized
          ? '已完成'
          : crawler.alive
            ? '初始化中'
            : undefined,
    },
    {
      id: 'snapshot-walker',
      label: 'Snapshot Walker',
      description: '工作区快照遍历与单层目录列举',
      kind: 'singleton',
      alive: walker.alive,
      pendingRequests: walker.pendingRequests,
      busy: walker.pendingRequests > 0,
    },
    {
      id: 'diff',
      label: 'Diff',
      description: '大文件 unified diff 计算',
      kind: 'singleton',
      alive: diff.alive,
      pendingRequests: diff.pendingRequests,
      busy: diff.pendingRequests > 0,
    },
    {
      id: 'ast',
      label: 'AST',
      description: 'AST 解析与 patch apply',
      kind: 'singleton',
      alive: ast.alive,
      pendingRequests: ast.pendingRequests,
      busy: ast.pendingRequests > 0,
    },
    {
      id: 'rag-index',
      label: 'RAG Index',
      description: '语义索引全量建库与增量更新（默认 Worker）',
      kind: 'singleton',
      alive: index.alive,
      pendingRequests: index.pendingRequests,
      busy: indexJob.active,
      detail: indexJob.active
        ? indexJob.kind === 'incremental-worker'
          ? `Worker 增量 · ${indexJob.detail ?? '处理中'}`
          : indexJob.kind === 'incremental-main'
            ? `主线程增量 · ${indexJob.detail ?? '处理中'}`
            : indexJob.kind === 'full-worker'
              ? `Worker 全量 · ${indexJob.detail ?? '建库中'}`
              : `主线程 · ${indexJob.detail ?? '建库中'}`
        : index.initializing
          ? 'Worker 初始化中'
          : undefined,
    },
    {
      id: 'symbol-index',
      label: 'Symbol Index',
      description: '代码符号索引建库 / 增量 / 查询（searchSymbol、findReferences、analyzeImpact）',
      kind: 'singleton',
      alive: symbol.alive,
      pendingRequests: symbol.pendingRequests,
      busy: symbol.busy,
      detail: symbol.busy
        ? symbol.activeKind === 'buildIndex'
          ? `全量建库 · ${symbol.lastProgress?.detail ?? '处理中'}`
          : symbol.activeKind === 'incrementalIndex'
            ? `增量更新 · ${symbol.lastProgress?.detail ?? '处理中'}`
            : symbol.activeKind === 'searchSymbol'
              ? '查询符号'
              : symbol.activeKind === 'findReferences'
                ? '查询引用'
                : symbol.activeKind === 'analyzeImpact'
                  ? '影响分析'
                  : '忙碌'
        : symbol.initializing
          ? 'Worker 初始化中'
          : undefined,
    },
    {
      id: 'script',
      label: 'Script',
      description: 'runScript 工具：每次调用按需创建隔离 Worker',
      kind: 'ephemeral',
      alive: false,
      pendingRequests: 0,
      busy: false,
      detail: '按需创建',
    },
    {
      id: 'pyodide',
      label: 'Pyodide',
      description: 'runPython 工具：每次调用按需创建 Pyodide Worker',
      kind: 'ephemeral',
      alive: false,
      pendingRequests: 0,
      busy: false,
      detail: '按需创建',
    },
  ];

  const nav = navigator as Navigator & { deviceMemory?: number };

  return {
    workers,
    indexJob,
    wasmModules: getWasmModuleStatuses(),
    resources: {
      hardwareConcurrency: navigator.hardwareConcurrency ?? 0,
      deviceMemoryGb: nav.deviceMemory,
      memory: readMemoryStats(),
      dirCache: readDirCacheStats(),
    },
    collectedAt: Date.now(),
  };
}

function snapshotSignature(snapshot: WorkerMonitorSnapshot): string {
  const index = snapshot.indexJob;
  const workerSig = snapshot.workers
    .map(
      (w) =>
        `${w.id}:${w.alive}:${w.busy}:${w.pendingRequests}:${w.detail ?? ''}`,
    )
    .join('|');
  const progressSig = index.progress
    ? `${index.progress.phase}:${index.progress.current}:${index.progress.total}`
    : '';
  const mem = snapshot.resources.memory;
  const wasmSig = snapshot.wasmModules
    .map((m) => `${m.id}:${m.state}:${m.detail ?? ''}:${m.metrics.join(',')}`)
    .join('|');
  return [
    workerSig,
    index.active,
    index.kind,
    index.detail ?? '',
    progressSig,
    wasmSig,
    mem.supported ? `${mem.usedMb}` : '',
  ].join(';');
}

/** 事件驱动 + 低频心跳；仅在状态变化或心跳时回调，避免无效重绘 */
export function subscribeWorkerMonitor(
  listener: (snapshot: WorkerMonitorSnapshot) => void,
  options?: { heartbeatMs?: number },
): () => void {
  const heartbeatMs = options?.heartbeatMs ?? 8000;
  let lastSignature = '';
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  const emitIfChanged = () => {
    const snapshot = collectWorkerMonitorSnapshot();
    const signature = snapshotSignature(snapshot);
    if (signature !== lastSignature) {
      lastSignature = signature;
      listener(snapshot);
    }
  };

  const unsubBg = subscribeBackgroundIndex(() => emitIfChanged());
  const unsubIndex = subscribeIndexActivity(() => emitIfChanged());
  const unsubSymbol = subscribeSymbolWorker(() => emitIfChanged());
  const unsubWasm = subscribeWasmModules(() => emitIfChanged());

  emitIfChanged();
  heartbeatTimer = setInterval(emitIfChanged, heartbeatMs);

  return () => {
    unsubBg();
    unsubIndex();
    unsubSymbol();
    unsubWasm();
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  };
}
