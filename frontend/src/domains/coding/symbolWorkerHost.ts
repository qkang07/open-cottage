/**
 * Symbol Index Worker 主机：建库 / 增量 / 查询均转发到 Worker。
 */

import { workspace } from '../../workspace/FileSystemWorkspace';
import type { SymbolIndexProgress } from './indexCore';
import type { TreeSitterConfig } from './parsers/treeSitter';
import type {
  ImpactAnalysisResult,
  SearchSymbolResult,
  SymbolReferencesResult,
} from './queryCore';

type BuildResult = { totalFiles: number; totalSymbols: number };
type IncrementalResult = { touchedFiles: number };

type SymbolWorkerRequest =
  | { type: 'buildIndex'; ignoreGlobs: string[]; parserConfig?: TreeSitterConfig }
  | {
      type: 'incrementalIndex';
      paths: string[];
      ignoreGlobs: string[];
      parserConfig?: TreeSitterConfig;
    }
  | { type: 'searchSymbol'; query: string }
  | { type: 'findReferences'; symbolName: string }
  | { type: 'analyzeImpact'; symbolName: string };

type SymbolWorkerRequestKind = SymbolWorkerRequest['type'];

interface PendingRequest<T = unknown> {
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
  onProgress?: (progress: SymbolIndexProgress) => void;
  kind?: SymbolWorkerRequestKind;
}

let worker: Worker | null = null;
let initPromise: Promise<Worker | null> | null = null;
let initResolve: ((value: Worker | null) => void) | null = null;
let initReject: ((reason: Error) => void) | null = null;
let requestId = 0;
const pending = new Map<number, PendingRequest>();
let lastProgress: SymbolIndexProgress | null = null;
let activeRequestKind: SymbolWorkerRequestKind | null = null;

type SymbolWorkerListener = () => void;
const activityListeners = new Set<SymbolWorkerListener>();

function notifySymbolWorkerActivity(): void {
  for (const listener of activityListeners) {
    listener();
  }
}

export function subscribeSymbolWorker(listener: SymbolWorkerListener): () => void {
  activityListeners.add(listener);
  return () => activityListeners.delete(listener);
}

export function getSymbolWorkerActiveRequestKind(): SymbolWorkerRequestKind | null {
  return activeRequestKind;
}

export function getSymbolWorkerLastProgress(): SymbolIndexProgress | null {
  return lastProgress;
}

export function isSymbolWorkerRunning(): boolean {
  return pending.size > 0;
}

export async function ensureSymbolWorker(): Promise<Worker | null> {
  if (worker) return worker;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const rootHandle = workspace.rootHandle;
    if (!rootHandle) return null;

    const nextWorker = new Worker(
      new URL('./symbol.worker.ts', import.meta.url),
      { type: 'module' },
    );

    const initResponsePromise = new Promise<Worker | null>((resolve, reject) => {
      initResolve = resolve;
      initReject = reject;
    });

    nextWorker.onmessage = (event: MessageEvent<unknown>) => {
      handleWorkerMessage(event.data);
    };

    nextWorker.onerror = (event) => {
      console.error('[SymbolWorker] error:', event);
      terminateSymbolWorker();
    };

    nextWorker.postMessage({ type: 'init', rootHandle });
    worker = nextWorker;
    return await initResponsePromise;
  })();

  return initPromise;
}

export function getSymbolWorkerStatus(): {
  alive: boolean;
  initializing: boolean;
  pendingRequests: number;
  busy: boolean;
  lastProgress: SymbolIndexProgress | null;
  activeKind: SymbolWorkerRequestKind | null;
} {
  return {
    alive: worker !== null,
    initializing: initPromise !== null && initResolve !== null,
    pendingRequests: pending.size,
    busy: pending.size > 0,
    lastProgress,
    activeKind: activeRequestKind,
  };
}

export function terminateSymbolWorker(): void {
  worker?.terminate();
  worker = null;
  initPromise = null;
  initResolve = null;
  initReject = null;
  for (const req of pending.values()) {
    req.reject(new Error('Symbol Worker 已终止'));
  }
  pending.clear();
  lastProgress = null;
  activeRequestKind = null;
  notifySymbolWorkerActivity();
}

export function abortSymbolWorker(): void {
  worker?.postMessage({ kind: 'abort' });
}

function postRequest<T>(
  request: SymbolWorkerRequest,
  onProgress?: (progress: SymbolIndexProgress) => void,
): Promise<T> {
  return (async () => {
    const w = await ensureSymbolWorker();
    if (!w) {
      throw new Error('Symbol Worker 初始化失败：工作区未打开');
    }

    return new Promise<T>((resolve, reject) => {
      const id = ++requestId;
      pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        onProgress,
        kind: request.type,
      });
      activeRequestKind = request.type;
      notifySymbolWorkerActivity();
      w.postMessage({ kind: 'request', id, request });
    });
  })();
}

export async function buildSymbolIndexInWorker(
  ignoreGlobs: string[],
  parserConfig: TreeSitterConfig | undefined,
  onProgress?: (progress: SymbolIndexProgress) => void,
): Promise<BuildResult> {
  return postRequest<BuildResult>(
    { type: 'buildIndex', ignoreGlobs, parserConfig },
    onProgress,
  );
}

export async function incrementalSymbolIndexInWorker(
  paths: readonly string[],
  ignoreGlobs: string[],
  parserConfig: TreeSitterConfig | undefined,
  onProgress?: (progress: SymbolIndexProgress) => void,
): Promise<IncrementalResult> {
  return postRequest<IncrementalResult>(
    { type: 'incrementalIndex', paths: [...paths], ignoreGlobs, parserConfig },
    onProgress,
  );
}

export async function searchSymbolInWorker(query: string): Promise<SearchSymbolResult> {
  return postRequest<SearchSymbolResult>({ type: 'searchSymbol', query });
}

export async function findReferencesInWorker(
  symbolName: string,
): Promise<SymbolReferencesResult> {
  return postRequest<SymbolReferencesResult>({ type: 'findReferences', symbolName });
}

export async function analyzeImpactInWorker(
  symbolName: string,
): Promise<ImpactAnalysisResult> {
  return postRequest<ImpactAnalysisResult>({ type: 'analyzeImpact', symbolName });
}

function handleWorkerMessage(message: unknown): void {
  if (!message || typeof message !== 'object') return;
  const msg = message as {
    kind?: string;
    id?: number;
    result?: unknown;
    error?: string;
    init?: 'done' | 'error';
    progress?: SymbolIndexProgress;
  };

  if (msg.kind === 'init') {
    if (msg.init === 'done') {
      initResolve?.(worker);
    } else {
      initReject?.(new Error(msg.error ?? 'Symbol Worker 初始化失败'));
      terminateSymbolWorker();
    }
    initResolve = null;
    initReject = null;
    return;
  }

  if (msg.kind === 'progress' && msg.id !== undefined && msg.progress) {
    lastProgress = msg.progress;
    pending.get(msg.id)?.onProgress?.(msg.progress);
    notifySymbolWorkerActivity();
    return;
  }

  if (msg.kind !== 'response') return;

  const req = pending.get(msg.id ?? -1);
  if (!req) return;
  pending.delete(msg.id ?? -1);
  lastProgress = null;
  if (pending.size === 0) {
    activeRequestKind = null;
  } else {
    const next = pending.values().next().value;
    activeRequestKind = next?.kind ?? null;
  }
  notifySymbolWorkerActivity();

  if (msg.error) {
    req.reject(new Error(msg.error));
  } else {
    req.resolve(msg.result);
  }
}
