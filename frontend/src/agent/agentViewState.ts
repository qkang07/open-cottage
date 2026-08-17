import { reactive, shallowReactive } from 'vue';
import type { CottageMessage } from './messages';
import type { ContextUsage } from './tokenCounter';

/**
 * Agent 当前阶段，供 UI 常驻状态条展示，解决"不反应"问题。
 * 原定义在 CottageAgent.ts，移至本文件以避免响应式状态层反向依赖 Agent 实现。
 */
export type AgentStatus =
  | { phase: 'idle' }
  | { phase: 'thinking' }
  | { phase: 'streaming' }
  | { phase: 'tool_args'; toolName: string }
  | { phase: 'tool_call'; toolName: string }
  | { phase: 'approval'; toolName: string };

/**
 * UI 可见的 Agent 运行时状态。
 *
 * 这是 UI 刷新的真相来源：CottageAgent 内部写入本对象，
 * Vue 响应式系统自动追踪变化，UI 直接绑定即可，无需 emit('update') 拉模型。
 *
 * - `messages` 用 shallowReactive：数组结构变化（push/splice/length）触发响应式，
 *   但 section 内部字段（streaming text 累积等）不追踪，由 Event Bus 的
 *   ToolStreaming 事件 + MessageView 的 version prop 驱动局部刷新。
 * - 其余字段为 primitive，reactive 自动追踪。
 */
export interface AgentViewState {
  messages: CottageMessage[];
  busy: boolean;
  status: AgentStatus;
  contextTokens: number;
  contextTokensCalibrated: boolean;
  contextWindow: number;
  contextTokensPercent: number;
  /** UI 派生：当前会话修改过的文件列表 */
  modifiedFiles: string[];
  /**
   * section 级刷新计数器。
   * shallowReactive(messages) 只追踪数组结构变化，不追踪 section 内字段
   * （streaming text 累积、tool result 变化等）。每次 section 内字段变更时
   * 自增此计数器，UI（ChatMessageList）watch 它触发 MessageView 重读 section。
   * Event Bus 接入后仍保留，作为 section 级刷新的统一信号源。
   */
  sectionVersion: number;
}

export const createAgentViewState = (): AgentViewState =>
  reactive({
    messages: shallowReactive<CottageMessage[]>([]),
    busy: false,
    status: { phase: 'idle' } as AgentStatus,
    contextTokens: 0,
    contextTokensCalibrated: false,
    contextWindow: 0,
    contextTokensPercent: 0,
    modifiedFiles: shallowReactive<string[]>([]),
    sectionVersion: 0,
  });

/**
 * 用新的 contextUsage 同步 viewState 中的上下文派生字段。
 * 由 CottageAgent 在 recordUsageFromMessage / maybeCompact 等处调用。
 */
export const syncContextUsageToViewState = (
  viewState: AgentViewState,
  usage: ContextUsage | null,
  estimateTokens: number,
  contextWindow: number,
): void => {
  viewState.contextTokens = usage?.totalTokens ?? estimateTokens;
  viewState.contextTokensCalibrated = usage !== null;
  viewState.contextWindow = contextWindow;
  if (contextWindow <= 0) {
    viewState.contextTokensPercent = 0;
    return;
  }
  viewState.contextTokensPercent = Math.min(
    100,
    Math.round((viewState.contextTokens / contextWindow) * 100),
  );
};
