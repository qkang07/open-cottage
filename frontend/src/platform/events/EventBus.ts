import type { CottageEvent } from './types';

type EventHandler = (event: CottageEvent) => void;

/**
 * 进程内事件总线。
 *
 * CottageAgent 发出结构化事件，多个订阅者各自处理：
 * - TraceRecorder：过滤 trace 事件落盘
 * - UI 组件：细粒度动画（状态条、工具进度）
 * - ConversationCheckpoint：监听 turn_end / pre_risky 自动建点
 *
 * 单个 handler 抛错不影响其他订阅者。
 */
export class EventBus {
  private readonly globalHandlers = new Set<EventHandler>();
  private readonly typedHandlers = new Map<string, Set<EventHandler>>();

  emit(event: CottageEvent): void {
    for (const handler of this.globalHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('[EventBus] handler error:', error);
      }
    }
    const typed = this.typedHandlers.get(event.type);
    if (typed) {
      for (const handler of typed) {
        try {
          handler(event);
        } catch (error) {
          console.error('[EventBus] typed handler error:', error);
        }
      }
    }
  }

  /** 订阅全量事件，返回取消订阅函数 */
  subscribe(handler: EventHandler): () => void {
    this.globalHandlers.add(handler);
    return () => {
      this.globalHandlers.delete(handler);
    };
  }

  /** 按事件类型订阅，返回取消订阅函数 */
  subscribeType<T extends CottageEvent>(
    type: T['type'],
    handler: (event: T) => void,
  ): () => void {
    let set = this.typedHandlers.get(type);
    if (!set) {
      set = new Set();
      this.typedHandlers.set(type, set);
    }
    const wrapper = handler as EventHandler;
    set.add(wrapper);
    return () => {
      set?.delete(wrapper);
    };
  }
}
