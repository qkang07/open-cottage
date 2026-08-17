/**
 * 协作式让出主线程工具集。
 * 避免长时间同步操作阻塞 UI，支持 Scheduler API 和 requestAnimationFrame 回退。
 */

/** 让出主线程控制权（优先使用 Scheduler API，回退到 rAF + setTimeout） */
export function yieldToMain(): Promise<void> {
  const sched = (globalThis as typeof globalThis & {
    scheduler?: { yield?: () => Promise<void> };
  }).scheduler;
  if (sched?.yield) {
    return sched.yield();
  }
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0);
    });
  });
}

/** 检查是否已中止，若已中止则抛出 AbortError */
export function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
}

/** 每指定次数迭代让出一次主线程（默认 64 次） */
export async function maybeYield(iteration: number, interval = 64): Promise<void> {
  if (iteration > 0 && iteration % interval === 0) {
    await yieldToMain();
  }
}
