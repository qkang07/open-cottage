import { computed, ref, watch, type ComputedRef, type Ref } from 'vue';

export interface TailWindowOptions {
  /** 初始 / 每次追加加载的条数 */
  pageSize?: number;
  /** 贴底时可见窗口上限（超过则丢掉更早的已渲染项） */
  maxWhenPinned?: number;
}

type ItemsSource<T> =
  | Ref<readonly T[]>
  | ComputedRef<readonly T[]>
  | (() => readonly T[]);

/**
 * 长列表尾部窗口：默认只渲染末尾若干项，向上加载更早内容。
 * 适合聊天 / 时间线等不定高列表（不做虚拟高度估算）。
 */
export function useTailWindow<T>(
  items: ItemsSource<T>,
  options?: TailWindowOptions,
) {
  const pageSize = options?.pageSize ?? 40;
  const maxWhenPinned = options?.maxWhenPinned ?? pageSize * 2;
  const startIndex = ref(0);

  const all = computed(() =>
    typeof items === 'function' ? items() : items.value,
  );

  const visibleItems = computed(() => all.value.slice(startIndex.value));
  const hasOlder = computed(() => startIndex.value > 0);
  const hiddenOlderCount = computed(() => startIndex.value);

  function resetToTail() {
    startIndex.value = Math.max(0, all.value.length - pageSize);
  }

  /** @returns 本次新露出的条数 */
  function loadOlder(): number {
    if (startIndex.value <= 0) return 0;
    const prev = startIndex.value;
    startIndex.value = Math.max(0, prev - pageSize);
    return prev - startIndex.value;
  }

  /** 贴底跟随时限制窗口，避免长会话把可见列表撑爆 */
  function pinTailIfNeeded(stickToBottom: boolean) {
    if (!stickToBottom) return;
    const len = all.value.length;
    if (len - startIndex.value > maxWhenPinned) {
      startIndex.value = Math.max(0, len - pageSize);
    }
  }

  watch(
    () => all.value.length,
    (len, prevLen) => {
      if (prevLen === undefined || len < (prevLen ?? 0) || startIndex.value >= len) {
        resetToTail();
      }
    },
    { immediate: true },
  );

  return {
    startIndex,
    visibleItems,
    hasOlder,
    hiddenOlderCount,
    pageSize,
    resetToTail,
    loadOlder,
    pinTailIfNeeded,
  };
}

/** 在滚动容器顶部附近加载更早项，并保持视口锚点不跳动 */
export async function loadOlderPreservingScroll(
  container: HTMLElement | null | undefined,
  loadOlder: () => number,
  nextTickFn: () => Promise<unknown>,
  thresholdPx = 96,
): Promise<boolean> {
  if (!container || container.scrollTop > thresholdPx) return false;
  const prevHeight = container.scrollHeight;
  const prevTop = container.scrollTop;
  const added = loadOlder();
  if (added <= 0) return false;
  await nextTickFn();
  container.scrollTop = prevTop + (container.scrollHeight - prevHeight);
  return true;
}
