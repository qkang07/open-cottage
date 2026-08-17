/**
 * Crawler Host：管理后台预加载 Worker。
 * 工作区激活时启动；Worker 批量回传目录子节点写入 dirChildrenCache。
 * 切换/关闭时终止 Worker 并清空缓存。
 */

import { setDirChildren } from './dirChildrenCache';
import type { WorkspaceFileNode } from './types';

let worker: Worker | null = null;
let initResolve: ((value: Worker) => void) | null = null;
let initPromise: Promise<Worker> | null = null;
let boundHandle: FileSystemDirectoryHandle | null = null;
let crawling = false;

function applyDirBatch(
  dirs: Array<{ path: string; children: WorkspaceFileNode[] }>,
): void {
  for (const item of dirs) {
    setDirChildren(item.path, item.children);
  }
}

export function startCrawler(rootHandle: FileSystemDirectoryHandle): void {
  if (worker && boundHandle === rootHandle) return;
  stopCrawler();

  initPromise = new Promise<Worker>((resolve) => {
    initResolve = resolve;
  });

  try {
    const nextWorker = new Worker(
      new URL('./crawler.worker.ts', import.meta.url),
      { type: 'module' },
    );

    nextWorker.onmessage = (event: MessageEvent<unknown>) => {
      const msg = event.data as {
        kind?: string;
        init?: 'done';
        dirs?: Array<{ path: string; children: WorkspaceFileNode[] }>;
        path?: string;
        children?: WorkspaceFileNode[];
        error?: string;
      };
      if (msg.kind === 'init' && msg.init === 'done') {
        initResolve?.(nextWorker);
        initResolve = null;
        return;
      }
      if (msg.kind === 'dirsLoaded' && msg.dirs?.length) {
        applyDirBatch(msg.dirs);
        return;
      }
      // 兼容旧单条协议（若有遗留）
      if (msg.kind === 'dirLoaded' && msg.path !== undefined && msg.children) {
        setDirChildren(msg.path, msg.children);
        return;
      }
      if (msg.kind === 'crawlDone') {
        crawling = false;
        if (msg.error) console.warn('[Crawler] 完成但有错误:', msg.error);
        return;
      }
    };

    nextWorker.onerror = (event) => {
      console.error('[Crawler] error:', event);
      stopCrawler();
    };

    boundHandle = rootHandle;
    // FileSystemHandle 可 structured clone，但不能放进 transfer list（会 DataCloneError）
    nextWorker.postMessage({ type: 'init', rootHandle });
    worker = nextWorker;

    // init 完成后发送 start
    void initPromise.then((w) => {
      crawling = true;
      w.postMessage({ kind: 'start' });
    });
  } catch (error) {
    console.warn('[Crawler] Worker 不可用，跳过预加载:', error);
    worker = null;
    boundHandle = null;
    initPromise = null;
    initResolve = null;
  }
}

export function stopCrawler(): void {
  worker?.terminate();
  worker = null;
  initPromise = null;
  initResolve = null;
  boundHandle = null;
  crawling = false;
}

export function getCrawlerWorkerStatus(): {
  alive: boolean;
  initialized: boolean;
  crawling: boolean;
} {
  return {
    alive: worker !== null,
    initialized: initPromise !== null && initResolve === null,
    crawling,
  };
}
