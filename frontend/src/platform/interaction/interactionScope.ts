import { ref } from 'vue';

/**
 * 交互闸门作用域（InteractionHub 基础设施）。
 *
 * 背景：审批 / 计划审批 / askUser / 方案审批四类交互闸门原为模块级单例，
 * 在多后台会话并行运行时，后台会话的待处理项会覆盖并劫持当前活跃会话的 UI，
 * 且用户在活跃 UI 的回应会被错误地投递给后台会话。
 *
 * 方案：各闸门改为按 sessionId 存储待处理项（Map<sessionId, pending>），
 * getter 默认只返回「当前 UI 聚焦会话」的待处理项，resolve/cancel 也作用于该会话。
 * 本模块提供共享的「活跃会话」与统一修订号，避免闸门与本模块之间产生循环依赖。
 */

/** 缺省键：调用方未提供 sessionId 时（如子任务、无会话上下文）落入该键 */
export const DEFAULT_INTERACTION_KEY = '__default__';

/** 当前 UI 聚焦的会话 ID；决定各交互闸门 getter/resolve 默认作用于哪个会话 */
export const activeInteractionSessionId = ref<string | null>(null);

/** 统一交互修订号：任何 pending 变化或活跃会话切换都 +1，供 UI 计算属性建立依赖 */
export const interactionRevision = ref(0);

/** 递增统一交互修订号 */
export function bumpInteractionRevision(): void {
  interactionRevision.value += 1;
}

/** 设置当前活跃交互会话（切换会话时调用），变化时刷新修订号 */
export function setActiveInteractionSession(sessionId: string | null): void {
  if (activeInteractionSessionId.value === sessionId) return;
  activeInteractionSessionId.value = sessionId;
  bumpInteractionRevision();
}

/** 写入用 key：优先使用显式 sessionId，否则回退到缺省键 */
export function writeInteractionKey(sessionId?: string | null): string {
  return sessionId ?? DEFAULT_INTERACTION_KEY;
}

/** 读取用 key：优先活跃会话，否则回退到缺省键 */
export function activeInteractionKey(): string {
  return activeInteractionSessionId.value ?? DEFAULT_INTERACTION_KEY;
}
