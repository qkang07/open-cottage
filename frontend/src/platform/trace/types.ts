import type { StoredMessage } from '../../agent/messages';
import type {
  CottageModelRuntimeIdentity,
  CottageModelUsage,
} from '../../agent/runtime/model';
import type { PlanBudget } from '../plan';

/**
 * 全链路 trace 事件模型。
 *
 * 设计原则：只记录对"回放与诊断"有价值的节点（模型请求、工具调用、计划、验收、轮次、错误），
 * 不记录每个 token chunk（体积过大且对流式 UI 无意义）。
 * 落盘格式为 JSONL，每行一个事件，便于增量追加与流式读取。
 */

export type TraceToolStatus =
  | 'ok'
  | 'blocked_policy'
  | 'blocked_plan'
  | 'duplicate'
  | 'error'
  | 'aborted'
  | 'doom_loop'
  | 'unknown_tool';

export interface TraceToolCallEvent {
  type: 'tool_call';
  at: number;
  id: string;
  round: number;
  name: string;
  args: unknown;
  status: TraceToolStatus;
  /** 结果文本片段（截断） */
  resultSnippet?: string;
  /** 文件写入前后内容（截断），用于回放 diff */
  before?: string;
  after?: string;
  created?: boolean;
  /** Worker 预计算的 unified diff（截断） */
  diffSnippet?: string;
  durationMs?: number;
  error?: string;
  /** 工具结果是否经流式 delta 输出 */
  streamed?: boolean;
  chunkCount?: number;
  /** 调用来源：agent 工具循环 / 脚本内 cottage.* / DebugPanel 手工调用 */
  source?: 'agent' | 'script' | 'manual';
  /** script 来源：宿主 runScript 的 callId */
  parentCallId?: string;
}

export interface TracePlanEvent {
  type: 'plan';
  at: number;
  goal: string;
  itemCount: number;
  budget?: PlanBudget;
  approved?: boolean;
}

export interface TraceVerifyEvent {
  type: 'verify';
  at: number;
  verdict: 'pass' | 'fail' | 'unverified';
  checkCount: number;
  uncovered: string[];
  manifestPathCount: number;
}

export interface TraceTurnStartEvent {
  type: 'turn_start';
  at: number;
  mode: 'chat' | 'task' | 'plan' | 'spec';
  promptChars: number;
}

export interface TraceTurnEndEvent {
  type: 'turn_end';
  at: number;
  endReason:
    | 'complete'
    | 'aborted'
    | 'error'
    | 'stopped'
    | 'stalled'
    | 'content_filter'
    | 'empty';
  error?: string;
}

export interface TraceModelCallEvent {
  type: 'model_call';
  at: number;
  operation: 'stream' | 'generate' | 'generateObject';
  identity: CottageModelRuntimeIdentity;
  requestId: string;
  durationMs: number;
  firstTokenMs?: number;
  usage?: CottageModelUsage;
  finishReason?: string;
  error?: string;
}

export interface TraceHandoffEvent {
  type: 'handoff';
  at: number;
  summary: string;
  remainingCount: number;
  nextStepCount: number;
}

export interface TraceCompactionEvent {
  type: 'compaction';
  at: number;
  droppedCount: number;
  keptCount: number;
  beforeTokens: number;
  afterTokensEstimate: number;
  /** 写入 LLM 投影的摘要消息（不进入展示 transcript） */
  summaryMessage?: StoredMessage;
  /** 被本次压缩覆盖的 transcript 消息 id */
  coveredMessageIds?: string[];
}

export type TraceEvent =
  | TraceToolCallEvent
  | TracePlanEvent
  | TraceVerifyEvent
  | TraceTurnStartEvent
  | TraceTurnEndEvent
  | TraceModelCallEvent
  | TraceHandoffEvent
  | TraceCompactionEvent;
