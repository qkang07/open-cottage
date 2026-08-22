import type { CottageTool } from '@/agent/runtime/tool';
import {
  assertModelRuntimeIdentity,
  assistantResponseMessage,
  toolResultMessage,
  type CottageAssistantResponse,
  type CottageModelDriver,
  type CottageModelRuntimeIdentity,
  type CottageModelMessage,
  type CottageToolCall,
} from './runtime/model';
import type { ComposedUserMessage } from '../chat/userMessageFormat';
import type { ChatAttachment } from '../chat/attachments';
import {
  mimeFromPath,
  persistAttachments,
  resolveAttachmentDataUrl,
} from '../chat/attachmentStorage';
import {
  isPendingInteraction,
  type ToolCallInteraction,
} from '../chat/toolCallInteraction';
import {
  waitForCallInteraction,
  resolveCallInteraction,
  type CallInteractionDecision,
} from '../chat/callInteractionGate';
import {
  appendAssistantText,
  beginAssistantThinkStreaming,
  createAssistantMessage,
  createUserMessage,
  finalizeAssistantStreaming,
  sealAssistantTextStreaming,
  newMessageId,
  normalizeLegacyCumulativeAssistantDeltas,
  pushContentWithCottageThinking,
  setAssistantThink,
  type CottageMessage,
  type CottageSection,
  type StoredMessage,
  type StoredToolCall,
} from './messages';
import { extractThinkingFromContent } from './cottageThinking';
import { CHAT_PLAN_MODE_TOOL_NAMES } from '../plan/planTools';
import type { PlanToolGuard } from '../plan/scopeGate';
import {
  clearMoonshotAssistantReasoningPatch,
  MOONSHOT_PLACEHOLDER_REASONING,
  setMoonshotAssistantReasoningPatch,
  supportsMoonshotThinking,
} from '../config/moonshotThinking';
import {
  storedToRuntime,
  extractSystemPrompt,
  hydrateAttachmentsForLlm,
  repairToolCallHistory,
  pendingInteractionCallIds,
  toolImagesNoteText,
} from './historyAdapter';
import { isAskUserTool, normalizeToolName } from './toolNames';
import { toolLocaleAlias } from './toolDescriptions';
import type { LlmModelConfig } from '../config/constants';
import { stripCottageImages, stripWriteSnapshot } from './cottageTools';
import { computeDiffInWorker } from './diffWorkerHost';
import {
  supportsToolStream,
  type ToolStreamContext,
} from './toolStream';
import {
  applyToolCallProgress,
  mergeToolCallChunks,
} from './toolCallStreamProgress';
import {
  classifyLlmError,
  friendlyErrorMessage,
  withLlmRetry,
  type LlmRetryOptions,
} from './llmErrorHandler';
import {
  finishReasonUserMessage,
  normalizeFinishReason,
  type FinishReasonKind,
} from './finishReason';
import {
  estimateContextTokens,
  normalizeUsage,
  resolveContextWindow,
  type ContextUsage,
} from './tokenCounter';
import {
  ensureModelsDevCatalog,
  getCachedProviderModels,
  resolveCatalogContextWindow,
} from '../config/modelCatalog';
import { normalizeProviderId } from '../config/llmProviders';
import {
  resolveCottageModelCapabilities,
  supportsVisionInput,
} from '../config/modelCapabilities';
import {
  compactHistory,
  COMPACTION_KEEP_RECENT_TURNS,
  COMPACTION_THRESHOLD,
  estimateCompactionBenefit,
} from './compaction';
import {
  buildDoomLoopSoftWarnMessage,
  createDoomLoopDetector,
  DOOM_LOOP_SOFT_WARN_LIMIT,
  DOOM_LOOP_TOOL_NAME,
  type DoomLoopDetector,
} from './doomLoop';
import {
  createAgentViewState,
  syncContextUsageToViewState,
  type AgentStatus,
  type AgentViewState,
} from './agentViewState';
import { getCottageConfig } from '../config/store';
import type { EventBus, CottageEvent } from '../platform/events';
import type { ConversationSnapshot, PlanStateSnapshot } from './conversationCheckpoint';
import { createConversationCheckpoint } from './conversationCheckpoint';
import { createManualCheckpoint } from '../history/historyService';
import { flushCheckpoint } from '../history/autoCheckpoint';
import type { PolicyGate } from '../platform/policy';
import type { PlanGate } from '../platform/plan';
import { cancelPendingPlanApproval, recordPlanToolOutcome } from '../platform/plan';
import type { PlanSession } from '../platform/plan';
import type { UnifiedToolExecutor } from './toolInvocation';
import type { StagingStore } from '../platform/staging';
import type { StagingWorkspace } from '../platform/staging';
import {
  cancelPendingStagedApproval,
  clearSessionStaging,
  hasPendingStagedApprovalFor,
  loadSessionStaging,
  requestStagedChangesApproval,
  saveSessionStaging,
} from '../platform/staging';
import { cancelPendingAsk } from './askUserTool';
import { normalizeAskUserOptions } from '../chat/askUserOptions';
import type {
  TraceRecorder,
  TraceToolStatus,
  TraceTurnEndEvent,
} from '../platform/trace';

type CallSection = Extract<CottageSection, { type: 'call' }>;

export type { AgentStatus } from './agentViewState';
export type CottageAgentEvent = 'assistantComplete' | 'rewind' | 'stalled';

/** 相同工具 + 相同参数最多执行次数，超出后阻止并返回提示 */
const MAX_IDENTICAL_TOOL_CALLS = 2;

export interface CreateCottageAgentOptions {
  systemPrompt: string;
  model: CottageModelDriver;
  tools: CottageTool[];
  history?: StoredMessage[];
  /** 发给模型的上下文；缺省与 history 相同（无 compaction 时） */
  llmHistory?: StoredMessage[];
  welcomeMessage?: string;
  /** 为 Kimi thinking 回传历史 reasoning_content */
  moonshotThinking?: boolean;
  /** 当前模型配置，用于计算上下文窗口百分比 */
  modelConfig?: LlmModelConfig;
  /** 发送前解析界面当前选择，防止旧 Agent 向过期模型发送请求 */
  resolveExpectedModelConfig?: () => LlmModelConfig | null;
  /** 工具执行前的策略闸门（放行 / 阻止 / 弹确认） */
  policyGate?: PolicyGate;
  /** 工具执行前的计划闸门 */
  planGate?: PlanGate;
  planSession?: PlanSession;
  /** 统一 Plan Mode 的路径范围、预算与步骤检查点闸门。 */
  planToolGuard?: PlanToolGuard;
  /** 统一工具执行器（script / manual 来源的治理管线），由 createCottageAgent 注入 */
  toolExecutor?: UnifiedToolExecutor;
  /** 本回合写工具的暂存区；回合末批量审批后合并落盘 */
  stagingStore?: StagingStore;
  stagingWorkspace?: StagingWorkspace;
  /** 应用层重试参数，缺省使用 DEFAULT_LLM_RETRY_OPTIONS */
  retryOptions?: Pick<
    LlmRetryOptions,
    'maxRetries' | 'baseDelayMs' | 'maxDelayMs'
  >;
  /** 会话级 trace 记录器；为 null 时不记录 */
  traceRecorder?: TraceRecorder | null;
  /** chat / task / plan 模式，用于 trace 事件 */
  mode?: 'chat' | 'task' | 'plan' | 'spec';
  /** 流式工具执行上下文（Cottage Service 路由等） */
  toolStreamContext?: ToolStreamContext;
  /** UI 响应式状态层，由 createCottageAgent 注入 */
  viewState?: AgentViewState;
  /** 结构化事件总线，供 UI 细粒度动画和 checkpoint 自动建点 */
  eventBus?: EventBus;
  /** 当前会话 ID，用于 conversation checkpoint 和 trace */
  sessionId?: string;
  /** 回合进行中视图更新回调（供节流中途落盘） */
  onInFlightUpdate?: () => void;
}

export class CottageAgent {
  private readonly agentViewState: AgentViewState;
  private readonly eventBus: EventBus | null;
  private readonly sessionId: string | null;
  private _busy = false;

  private systemPrompt: string;
  private model: CottageModelDriver;
  /** 当前绑定给模型的工具列表（可通过 activateTools 在回合内扩展） */
  private tools: CottageTool[];
  private readonly toolMap: Map<string, CottageTool>;
  private moonshotThinking: boolean;
  private modelConfig: LlmModelConfig | undefined;
  private resolveExpectedModelConfig: (() => LlmModelConfig | null) | undefined;
  private policyGate: PolicyGate | undefined;
  private readonly planGate: PlanGate | undefined;
  private readonly planSession: PlanSession | undefined;
  private planToolGuard: PlanToolGuard | undefined;
  private readonly toolExecutor: UnifiedToolExecutor | undefined;
  private readonly stagingStore: StagingStore | undefined;
  private readonly stagingWorkspace: StagingWorkspace | undefined;
  private readonly retryOptions: Pick<
    LlmRetryOptions,
    'maxRetries' | 'baseDelayMs' | 'maxDelayMs'
  >;
  private readonly traceRecorder: TraceRecorder | null;
  private agentMode: 'chat' | 'task' | 'plan' | 'spec';
  private readonly toolStreamContext: ToolStreamContext | undefined;
  /**
   * 完整展示 transcript：只追加，compaction 不删除。
   * 聊天面板与 Debug 以此为准。
   */
  private storedHistory: StoredMessage[] = [];
  /**
   * 发给模型的上下文投影：可被 compaction 替换为摘要 + 近轮消息。
   */
  private llmHistory: StoredMessage[] = [];
  private abortController: AbortController | null = null;
  /** 当前回合是否进行中（用于中断检测：进程被刷新/关闭杀死时磁盘会留存 true） */
  private turnInFlight = false;
  /** 当前回合开始时间戳 */
  private turnStartedAt: number | null = null;
  /** 当前在途的 assistant 视图消息，用于拼接尚未落盘的流式草稿 */
  private inFlightAssistantMsg: CottageMessage | null = null;
  private readonly listeners = new Map<CottageAgentEvent, Set<() => void>>();
  private contextUsage: ContextUsage | null = null;
  private lastUserText: string | null = null;
  private readonly doomLoopDetector: DoomLoopDetector = createDoomLoopDetector();
  /** 本回合已命中 doom loop 的次数（前几次软提醒，之后用户闸门） */
  private doomLoopHitCount = 0;
  private readonly onInFlightUpdate: (() => void) | undefined;
  /** 当前 tool round 已建过 pre_risky 检查点则跳过（并行多工具只建一次） */
  private preRiskyCheckpointRound: number | null = null;

  constructor(options: CreateCottageAgentOptions) {
    this.agentViewState = options.viewState ?? createAgentViewState();
    this.eventBus = options.eventBus ?? null;
    this.sessionId = options.sessionId ?? null;
    this.systemPrompt = options.systemPrompt;
    this.model = options.model;
    this.tools = options.tools;
    this.toolMap = new Map();
    for (const tool of options.tools) {
      this.toolMap.set(tool.name, tool);
      const normalized = normalizeToolName(tool.name);
      if (normalized !== tool.name) {
        this.toolMap.set(normalized, tool);
      }
    }
    this.moonshotThinking = options.moonshotThinking ?? false;
    this.modelConfig = options.modelConfig;
    this.resolveExpectedModelConfig = options.resolveExpectedModelConfig;
    this.assertRuntimeCurrent();
    // 提前预热 models.dev 目录，使上下文窗口能尽早用上真实值
    ensureModelsDevCatalog();
    this.policyGate = options.policyGate;
    this.planGate = options.planGate;
    this.planSession = options.planSession;
    this.planToolGuard = options.planToolGuard;
    this.toolExecutor = options.toolExecutor;
    this.stagingStore = options.stagingStore;
    this.stagingWorkspace = options.stagingWorkspace;
    this.retryOptions = options.retryOptions ?? {};
    this.traceRecorder = options.traceRecorder ?? null;
    this.agentMode = options.mode ?? 'chat';
    this.toolStreamContext = options.toolStreamContext;
    this.onInFlightUpdate = options.onInFlightUpdate;

    // 暂存变更同步写入 sessions/{id}/staging.json，刷新后可恢复批准面板
    this.stagingStore?.setOnChange(() => {
      void this.persistStagingState();
    });

    this.syncContextUsage();

    if (options.history?.length) {
      this.loadHistory(options.history, options.llmHistory);
    } else if (options.welcomeMessage) {
      const welcome = createAssistantMessage();
      welcome.sections.push({ type: 'content', text: options.welcomeMessage });
      this.messages.push(welcome);
    }
  }

  /** 追加到 transcript + LLM 投影，并写入事件日志 */
  private appendHistoryMessage(
    message: StoredMessage,
    options?: { transcriptOnly?: boolean },
  ): StoredMessage {
    const withId = message.id
      ? message
      : { ...message, id: newMessageId() };
    this.storedHistory.push(withId);
    // transcriptOnly：仅展示用（如错误横幅），不进入后续 LLM 上下文
    if (!options?.transcriptOnly) {
      this.llmHistory.push(withId);
    }
    this.traceRecorder?.append({
      type: 'message',
      at: Date.now(),
      message: withId,
    });
    return withId;
  }

  /**
   * 将回合错误写入 UI + transcript，确保刷新后仍能还原错误横幅与已生成正文。
   * 空错误标记默认不进入 llmHistory，避免污染后续请求。
   */
  private recordTurnError(
    assistantMsg: CottageMessage,
    errorText: string,
  ): void {
    assistantMsg.error = errorText;
    const completedAt = Date.now();
    assistantMsg.completedAt = completedAt;

    let content = '';
    let reasoning = '';
    for (const section of assistantMsg.sections) {
      if (section.type === 'content') content += section.text;
      else if (section.type === 'think') reasoning += section.text;
    }
    content = content.trimEnd();
    reasoning = reasoning.trim();

    const last = this.storedHistory[this.storedHistory.length - 1];
    const lastIsFinalAssistant =
      last?.role === 'assistant' && !last.toolCalls?.length;
    const contentAlreadyStored =
      lastIsFinalAssistant &&
      last.content === content &&
      (last.reasoningContent ?? '') === reasoning;

    if (contentAlreadyStored) {
      if (last.error === errorText) return;
      this.appendHistoryMessage(
        {
          role: 'assistant',
          content: '',
          error: errorText,
          interrupted: true,
          completedAt,
        },
        { transcriptOnly: true },
      );
      return;
    }

    const hasBody = Boolean(content || reasoning);
    this.appendHistoryMessage(
      {
        role: 'assistant',
        content,
        reasoningContent: reasoning || undefined,
        error: errorText,
        interrupted: true,
        completedAt,
      },
      hasBody ? undefined : { transcriptOnly: true },
    );
  }

  get messages(): CottageMessage[] {
    return this.agentViewState.messages;
  }

  get busy(): boolean {
    return this._busy;
  }

  set busy(value: boolean) {
    this._busy = value;
    this.agentViewState.busy = value;
  }

  get status(): AgentStatus {
    return this.agentViewState.status;
  }

  get viewState(): AgentViewState {
    return this.agentViewState;
  }

  get lastMessage(): CottageMessage | undefined {
    return this.messages[this.messages.length - 1];
  }

  get contextTokens(): number {
    return this.agentViewState.contextTokens;
  }

  get contextTokensCalibrated(): boolean {
    return this.agentViewState.contextTokensCalibrated;
  }

  get contextWindow(): number {
    return this.agentViewState.contextWindow;
  }

  getModel(): CottageModelDriver {
    return this.model;
  }

  getModelConfig(): LlmModelConfig | undefined {
    return this.modelConfig;
  }

  getModelRuntimeIdentity(): CottageModelRuntimeIdentity {
    return this.model.getRuntimeIdentity();
  }

  private assertRuntimeCurrent(): void {
    const expected = this.resolveExpectedModelConfig?.() ?? this.modelConfig;
    if (!expected) return;
    assertModelRuntimeIdentity(this.model.getRuntimeIdentity(), expected);
  }

  getStagingStore(): StagingStore | undefined {
    return this.stagingStore;
  }

  getStagingWorkspace(): StagingWorkspace | undefined {
    return this.stagingWorkspace;
  }

  get contextTokensPercent(): number {
    return this.agentViewState.contextTokensPercent;
  }

  watch(event: CottageAgentEvent, listener: () => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
  }

  unwatch(event: CottageAgentEvent, listener: () => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  private emit(event: CottageAgentEvent): void {
    this.listeners.get(event)?.forEach((listener) => listener());
  }

  private setStatus(status: AgentStatus): void {
    this.agentViewState.status = status;
    this.emitStatusEvent(status);
  }

  /** 通知 UI section 内部字段已变化（streaming text、tool result 等），shallowReactive 不追踪这些 */
  private bumpSectionVersion(): void {
    this.agentViewState.sectionVersion += 1;
    if (this.turnInFlight) this.onInFlightUpdate?.();
  }

  private emitEvent(event: CottageEvent): void {
    this.eventBus?.emit(event);
  }

  private emitStatusEvent(status: AgentStatus): void {
    if (!this.eventBus) return;
    switch (status.phase) {
      case 'tool_args':
      case 'tool_call':
        this.emitEvent({
          type: 'tool_calling',
          at: Date.now(),
          toolName: status.toolName,
          callId: '',
          round: 0,
        });
        break;
      case 'approval':
        this.emitEvent({
          type: 'need_confirmation',
          at: Date.now(),
          toolName: status.toolName,
          callId: '',
        });
        break;
    }
  }

  getEventBus(): EventBus | null {
    return this.eventBus;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  /** 版本历史开启时才绑定工作区 v2 版本 ID。 */
  private async resolveWorkspaceVersionId(
    label: string,
    mode: 'manual' | 'flush',
  ): Promise<string | null> {
    if (!getCottageConfig().history?.enabled) return null;
    try {
      if (mode === 'flush') {
        return await flushCheckpoint(label);
      }
      return await createManualCheckpoint(label);
    } catch (error) {
      console.error('[CottageAgent] 工作区检查点失败:', error);
      return null;
    }
  }

  /**
   * 创建对话检查点。无 sessionId 时跳过。
   * workspaceVersionId 由调用方提供（仅 history.enabled 时非 null）。
   */
  private async createCheckpoint(
    trigger: 'pre_turn' | 'post_turn' | 'pre_risky_tool' | 'pre_compaction' | 'manual',
    label: string,
    workspaceVersionId: string | null,
  ): Promise<void> {
    if (!this.sessionId) return;
    try {
      const entry = await createConversationCheckpoint({
        sessionId: this.sessionId,
        trigger,
        label,
        history: [...this.storedHistory],
        contextUsage: this.contextUsage,
        planState: this.getPlanStateSnapshot(),
        workspaceVersionId,
      });
      this.emitEvent({
        type: 'checkpoint_created',
        at: entry.at,
        checkpointId: entry.id,
        trigger: entry.trigger,
        label: entry.label,
      });
    } catch (error) {
      console.error('[CottageAgent] 建点失败:', error);
    }
  }

  /** pre_turn：在新用户消息加入前建点 */
  private async createPreTurnCheckpoint(userText: string): Promise<void> {
    if (!this.sessionId) return;
    this.preRiskyCheckpointRound = null;
    try {
      const versionId = await this.resolveWorkspaceVersionId(
        `pre_turn: ${userText.slice(0, 60)}`,
        'manual',
      );
      await this.createCheckpoint(
        'pre_turn',
        `回合一开始：${userText.slice(0, 40)}`,
        versionId,
      );
    } catch (error) {
      console.error('[CottageAgent] pre_turn 建点失败:', error);
    }
  }

  /** post_turn：回合结束后建点 */
  private async createPostTurnCheckpoint(): Promise<void> {
    if (!this.sessionId) return;
    try {
      const versionId = await this.resolveWorkspaceVersionId(
        this.lastUserText ?? '回合结束',
        'flush',
      );
      await this.createCheckpoint(
        'post_turn',
        `回合结束：${(this.lastUserText ?? '').slice(0, 40)}`,
        versionId,
      );
    } catch (error) {
      console.error('[CottageAgent] post_turn 建点失败:', error);
    }
  }

  /**
   * pre_risky_tool：在执行需审批的工具前建点。
   * 同一 tool round 内只建一次，避免并行多工具重复全量落盘。
   */
  private async createPreRiskyCheckpoint(
    toolName: string,
    toolRound: number,
  ): Promise<void> {
    if (!this.sessionId) return;
    if (this.preRiskyCheckpointRound === toolRound) return;
    this.preRiskyCheckpointRound = toolRound;
    try {
      const versionId = await this.resolveWorkspaceVersionId(
        `pre_risky: ${toolName}`,
        'manual',
      );
      await this.createCheckpoint(
        'pre_risky_tool',
        `执行风险工具前：${toolName}`,
        versionId,
      );
    } catch (error) {
      console.error('[CottageAgent] pre_risky 建点失败:', error);
    }
  }

  /** pre_compaction：在压缩历史前建点（不绑定工作区） */
  private async createPreCompactionCheckpoint(): Promise<void> {
    if (!this.sessionId) return;
    await this.createCheckpoint(
      'pre_compaction',
      '压缩历史前',
      null,
    );
  }

  getTraceRecorder(): TraceRecorder | null {
    return this.traceRecorder;
  }

  /** 将 runtime / 在途 draft 追加到事件日志并 flush（会话唯一持久化入口） */
  async persistEventLogArtifacts(
    runtime: import('../config/constants').ChatSessionRuntimeMeta,
  ): Promise<void> {
    if (!this.traceRecorder) return;
    const draft = this.buildInFlightAssistantDraft();
    if (draft) {
      this.traceRecorder.append({
        type: 'draft',
        at: Date.now(),
        message: draft.id ? draft : { ...draft, id: newMessageId() },
      });
    }
    this.traceRecorder.append({
      type: 'runtime',
      at: Date.now(),
      runtime,
    });
    await this.traceRecorder.flush();
  }

  getPlanSession(): PlanSession | undefined {
    return this.planSession;
  }

  getPolicyGate(): PolicyGate | undefined {
    return this.policyGate;
  }

  getPlanGate(): PlanGate | undefined {
    return this.planGate;
  }

  getPlanToolGuard(): PlanToolGuard | undefined {
    return this.planToolGuard;
  }

  getDoomLoopDetector(): DoomLoopDetector {
    return this.doomLoopDetector;
  }

  getToolExecutor(): UnifiedToolExecutor | undefined {
    return this.toolExecutor;
  }

  /** 兼容旧调用：viewState 接管刷新后，section 内字段变化通过 sectionVersion 通知 UI */
  forceUpdate(): void {
    this.bumpSectionVersion();
  }

  getChatHistory(): StoredMessage[] {
    return [...this.storedHistory];
  }

  /** 当前发给模型的上下文投影（含 compaction 摘要） */
  getLlmHistory(): StoredMessage[] {
    return [...this.llmHistory];
  }

  /** 当前回合是否进行中 */
  isInFlight(): boolean {
    return this.turnInFlight;
  }

  /** 当前回合开始时间戳（无进行中回合时为 null） */
  getTurnStartedAt(): number | null {
    return this.turnStartedAt;
  }

  /**
   * 用于中途落盘的持久化快照：在 storedHistory 之上追加一条由在途流式文本合成的
   * 临时 assistant 草稿（不污染 storedHistory 本体，避免影响后续 LLM 请求）。
   */
  getPersistableSnapshot(): {
    history: StoredMessage[];
    inFlight: boolean;
    lastTurnStartedAt: number | null;
  } {
    const history = [...this.storedHistory];
    const draft = this.buildInFlightAssistantDraft();
    if (draft) history.push(draft);
    return {
      history,
      inFlight:
        this.turnInFlight ||
        pendingInteractionCallIds(this.storedHistory).size > 0,
      lastTurnStartedAt: this.turnStartedAt,
    };
  }

  /**
   * 把当前在途 assistantMsg 的流式 content/think 合成为一条临时 assistant 消息。
   * 仅当本回合的 assistant 节点尚未写入 storedHistory（即末条仍为 user）时才补草稿，
   * 避免与已 push 的 assistant(toolCalls) / 终态 assistant 重复。
   */
  private buildInFlightAssistantDraft(): StoredMessage | null {
    const msg = this.inFlightAssistantMsg;
    if (!msg) return null;
    const last = this.storedHistory[this.storedHistory.length - 1];
    if (!last || last.role !== 'user') return null;
    let content = '';
    let reasoning = '';
    for (const section of msg.sections) {
      if (section.type === 'content') content += section.text;
      else if (section.type === 'think') reasoning += section.text;
    }
    if (!content.trim() && !reasoning.trim()) return null;
    return {
      role: 'assistant',
      content,
      reasoningContent: reasoning.trim() ? reasoning : undefined,
      interrupted: true,
    };
  }

  getDebugInfo() {
    return {
      systemPrompt: this.systemPrompt,
      history: this.getChatHistory(),
      tools: this.tools.map((t) => ({
        name: t.name,
        description: t.description,
      })),
    };
  }

  /** 当前已挂载工具名（含回合内 loadTools 激活的） */
  getActiveToolNames(): Set<string> {
    return new Set(this.tools.map((t) => t.name));
  }

  /** 当前已挂载工具实例（含回合内 loadTools 激活的；供手工调用目录枚举） */
  getMountedTools(): CottageTool[] {
    return [...this.tools];
  }

  /** 按名称查找当前已挂载工具（支持规范化别名） */
  getToolByName(name: string): CottageTool | undefined {
    return this.toolMap.get(name) ?? this.toolMap.get(normalizeToolName(name));
  }

  /**
   * 回合内激活延后工具（供 loadTools 调用）。
   * 已存在的同名工具会被跳过。返回新激活的工具名。
   */
  activateTools(tools: readonly CottageTool[]): string[] {
    const activated: string[] = [];
    for (const tool of tools) {
      if (this.toolMap.has(tool.name)) continue;
      this.tools.push(tool);
      this.toolMap.set(tool.name, tool);
      const normalized = normalizeToolName(tool.name);
      if (normalized !== tool.name) {
        this.toolMap.set(normalized, tool);
      }
      activated.push(tool.name);
    }
    return activated;
  }

  getAgentMode(): 'chat' | 'task' | 'plan' | 'spec' {
    return this.agentMode;
  }

  /**
   * 热切换 chat / plan：只更新后续回合的模式、系统提示词与模式工具。
   * 不触碰历史 transcript / UI 消息。task 模式不可切换。
   */
  applyMode(options: {
    mode: 'chat' | 'plan' | 'spec';
    systemPrompt: string;
    modeTools: readonly CottageTool[];
    planToolGuard?: PlanToolGuard;
  }): void {
    if (this.agentMode === 'task') {
      throw new Error('任务模式下不可切换对话/计划模式');
    }
    if (this._busy) {
      throw new Error('对话进行中，请先停止再切换模式');
    }
    this.agentMode = options.mode;
    this.systemPrompt = options.systemPrompt;
    this.planToolGuard = options.planToolGuard;

    const removeNames = new Set<string>(CHAT_PLAN_MODE_TOOL_NAMES);
    this.tools = this.tools.filter((tool) => !removeNames.has(tool.name));
    this.rebuildToolMap();
    for (const tool of options.modeTools) {
      if (this.toolMap.has(tool.name)) continue;
      this.tools.push(tool);
      this.toolMap.set(tool.name, tool);
      const normalized = normalizeToolName(tool.name);
      if (normalized !== tool.name) {
        this.toolMap.set(normalized, tool);
      }
    }
    this.syncContextUsage();
  }

  /**
   * 热切换模型 / 能力包 / 搜索来源等运行时配置：只影响后续回合。
   * 不触碰历史 transcript / UI 消息；运行时快照由调用方写入事件时间线。
   */
  applyRuntime(options: {
    mode?: 'chat' | 'task' | 'plan' | 'spec';
    systemPrompt: string;
    model: CottageModelDriver;
    modelConfig?: LlmModelConfig;
    resolveExpectedModelConfig?: () => LlmModelConfig | null;
    tools: readonly CottageTool[];
    moonshotThinking?: boolean;
    planToolGuard?: PlanToolGuard;
    policyGate?: PolicyGate;
  }): void {
    if (this._busy) {
      throw new Error('对话进行中，请先停止再切换配置');
    }
    if (options.mode) this.agentMode = options.mode;
    const expected = options.resolveExpectedModelConfig?.() ?? options.modelConfig;
    if (expected) {
      assertModelRuntimeIdentity(options.model.getRuntimeIdentity(), expected);
    }
    this.systemPrompt = options.systemPrompt;
    this.model = options.model;
    this.modelConfig = options.modelConfig;
    this.resolveExpectedModelConfig = options.resolveExpectedModelConfig;
    this.planToolGuard = options.planToolGuard;
    this.policyGate = options.policyGate;
    this.moonshotThinking = options.moonshotThinking ?? false;
    this.tools = [...options.tools];
    this.rebuildToolMap();
    this.syncContextUsage();
  }

  /** 按当前 tools 重建 toolMap（含规范化别名） */
  private rebuildToolMap(): void {
    this.toolMap.clear();
    for (const tool of this.tools) {
      this.toolMap.set(tool.name, tool);
      const normalized = normalizeToolName(tool.name);
      if (normalized !== tool.name) {
        this.toolMap.set(normalized, tool);
      }
    }
  }

  /** 获取当前 PlanSession 状态快照 */
  getPlanStateSnapshot(): PlanStateSnapshot | null {
    if (!this.planSession) return null;
    return {
      plan: this.planSession.plan,
      lastBlockedReason: this.planSession.lastBlockedReason,
      counters: { ...this.planSession.counters },
    };
  }

  /** 获取当前完整运行时状态快照，用于 ConversationCheckpoint 持久化 */
  snapshot(): ConversationSnapshot {
    return {
      history: [...this.storedHistory],
      contextUsage: this.contextUsage,
      planState: this.getPlanStateSnapshot(),
    };
  }

  /** 从快照恢复运行时状态（rewind / session resume 用） */
  restore(snapshot: ConversationSnapshot): void {
    this.storedHistory = snapshot.history.map((message) =>
      message.id ? message : { ...message, id: newMessageId() },
    );
    this.llmHistory = [...this.storedHistory];
    this.contextUsage = snapshot.contextUsage ?? null;
    if (this.planSession && snapshot.planState) {
      this.planSession.plan = snapshot.planState.plan;
      this.planSession.lastBlockedReason = snapshot.planState.lastBlockedReason;
      this.planSession.counters.files = snapshot.planState.counters.files;
      this.planSession.counters.apiCalls = snapshot.planState.counters.apiCalls;
      this.planSession.counters.turns = snapshot.planState.counters.turns;
    } else if (this.planSession) {
      this.planSession.reset();
    }
    this.doomLoopDetector.reset();
    this.doomLoopHitCount = 0;
    this.rebuildUiMessages();
    this.syncContextUsage();
    this.bumpSectionVersion();
    // rewind 到检查点时，检查点边界暂存恒为空；丢弃任何残留暂存，避免跨回合串改
    this.stagingStore?.clear();
  }

  /** 将当前暂存区写入 sessions/{id}/staging.json；空则清除 */
  private async persistStagingState(): Promise<void> {
    if (!this.sessionId || !this.stagingStore) return;
    try {
      if (this.stagingStore.isEmpty()) {
        await clearSessionStaging(this.sessionId);
      } else {
        await saveSessionStaging(this.sessionId, this.stagingStore);
      }
    } catch (error) {
      console.warn('[CottageAgent] 暂存落盘失败:', error);
    }
  }

  /**
   * 刷新/重挂后：若 staging.json 仍有待批准条目，恢复内存暂存并重新挂起批准闸门。
   */
  async restoreStagedReviewIfNeeded(): Promise<void> {
    if (!this.sessionId || !this.stagingStore || !this.stagingWorkspace) return;
    if (hasPendingStagedApprovalFor(this.sessionId)) return;

    if (this.stagingStore.isEmpty()) {
      const state = await loadSessionStaging(this.sessionId);
      if (!state) return;
      this.stagingStore.hydrate(state.entries);
      if (this.stagingStore.isEmpty()) {
        await clearSessionStaging(this.sessionId);
        return;
      }
    }

    // 挂起闸门（不阻塞调用方太久）；先让 Promise 进入 requestStagedChangesApproval 同步注册段
    const review = this.reviewAndCommitStaged(new AbortController().signal);
    await Promise.resolve();
    void review.catch((error) => {
      console.warn('[CottageAgent] 恢复暂存审批失败:', error);
    });
  }

  /**
   * 回合末暂存改动审批：阻塞等待用户在 UI 面板批准/丢弃。
   * 批准 → stagingWorkspace.commit() 逐文件写真实磁盘并发 patch_applied；
   * 丢弃/取消 → discard()，不触磁盘。
   */
  private async reviewAndCommitStaged(signal: AbortSignal): Promise<void> {
    if (!this.stagingStore || !this.stagingWorkspace) return;
    if (this.stagingStore.isEmpty()) return;
    // 同会话已有闸门（例如 restore 与回合末竞态）时等待其结束，避免覆盖 Promise
    if (this.sessionId && hasPendingStagedApprovalFor(this.sessionId)) {
      while (hasPendingStagedApprovalFor(this.sessionId) && !signal.aborted) {
        await new Promise((r) => setTimeout(r, 50));
      }
      return;
    }
    const fileCount = this.stagingStore.size();
    // 先挂闸门再落盘，避免 await 间隙导致刷新恢复读不到 pending
    this.setStatus({ phase: 'approval', toolName: 'stagedChanges' });
    this.emitEvent({
      type: 'need_staged_review',
      at: Date.now(),
      fileCount,
    });
    let decision: 'approved' | 'discarded';
    try {
      const approval = requestStagedChangesApproval({
        store: this.stagingStore,
        signal,
        sessionId: this.sessionId,
        onPending: () => this.bumpSectionVersion(),
      });
      void this.persistStagingState();
      decision = await approval;
    } catch {
      // 取消/中断：丢弃暂存
      this.stagingWorkspace.discard();
      await this.persistStagingState();
      this.emitEvent({
        type: 'staged_discarded',
        at: Date.now(),
        fileCount,
      });
      this.setStatus({ phase: 'idle' });
      this.bumpSectionVersion();
      return;
    }
    if (decision === 'approved') {
      const committed = await this.stagingWorkspace.commit();
      await this.persistStagingState();
      for (const entry of committed) {
        this.emitEvent({
          type: 'patch_applied',
          at: Date.now(),
          toolName: 'stagedChanges',
          path: entry.path,
          created: entry.created && !entry.deleted,
        });
      }
      this.emitEvent({
        type: 'staged_committed',
        at: Date.now(),
        fileCount: committed.length,
      });
    } else {
      this.stagingWorkspace.discard();
      await this.persistStagingState();
      this.emitEvent({
        type: 'staged_discarded',
        at: Date.now(),
        fileCount,
      });
    }
    this.setStatus({ phase: 'idle' });
    this.bumpSectionVersion();
  }

  /** 注入合成用户消息（如后台子任务回投），不进 UI 原文展示时可设简短 userText */
  appendSyntheticUserMessage(content: string, userText = '系统消息'): void {
    this.appendHistoryMessage({
      role: 'user',
      content,
      userText,
      synthetic: true,
    });
    this.messages.push(
      createUserMessage({
        llmContent: content,
        userText,
      }),
    );
    this.bumpSectionVersion();
  }

  getPendingInteractionCalls(): {
    callId: string;
    interaction: ToolCallInteraction;
    name: string;
    args: Record<string, unknown>;
  }[] {
    const pendingIds = pendingInteractionCallIds(this.storedHistory);
    const out: {
      callId: string;
      interaction: ToolCallInteraction;
      name: string;
      args: Record<string, unknown>;
    }[] = [];
    for (const msg of this.storedHistory) {
      if (msg.role !== 'assistant' || !msg.toolCalls) continue;
      for (const call of msg.toolCalls) {
        if (!pendingIds.has(call.id) || !call.interaction) continue;
        if (!isPendingInteraction(call.interaction)) continue;
        out.push({
          callId: call.id,
          interaction: call.interaction,
          name: call.name,
          args: call.args,
        });
      }
    }
    return out;
  }

  /**
   * 用户处理工具调用上的交互（批准 / 回答）。
   * 若本进程仍有等待中的 Promise → 唤醒之；否则按落盘 interaction 恢复执行/拒绝。
   */
  async resolveInteraction(
    callId: string,
    decision: CallInteractionDecision,
  ): Promise<void> {
    const stored = this.findStoredToolCall(callId);
    if (!stored?.interaction || !isPendingInteraction(stored.interaction)) {
      return;
    }

    if (decision.kind === 'tool_approval') {
      if (stored.interaction.kind !== 'tool_approval') return;
      this.setCallInteraction(callId, {
        ...stored.interaction,
        status: decision.approved ? 'resolved' : 'cancelled',
        decision: { approved: decision.approved },
      });
    } else {
      const trimmed = decision.chosen.trim();
      if (!trimmed) return;
      if (stored.interaction.kind !== 'ask_user') return;
      this.setCallInteraction(callId, {
        ...stored.interaction,
        status: 'resolved',
        decision: { chosen: trimmed },
      });
      decision = { kind: 'ask_user', chosen: trimmed };
    }

    if (resolveCallInteraction(callId, decision, this.sessionId)) {
      return;
    }

    await this.resumeOrphanedInteraction(callId, decision);
  }

  private setCallInteraction(
    callId: string,
    interaction: ToolCallInteraction,
  ): void {
    const section = this.findCallSection(callId);
    if (section) {
      section.interaction = interaction;
      section.running = isPendingInteraction(interaction);
    }
    const stored = this.findStoredToolCall(callId);
    if (stored) {
      stored.interaction = interaction;
    }
    this.traceRecorder?.append({
      type: 'tool_interaction',
      at: Date.now(),
      callId,
      interaction,
    });
    // 审批态必须尽快落盘，否则刷新会丢卡片
    void this.traceRecorder?.flush();
    this.bumpSectionVersion();
  }

  private findCallSection(callId: string): CallSection | null {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i];
      for (const section of msg.sections) {
        if (section.type === 'call' && section.id === callId) {
          return section;
        }
      }
    }
    return null;
  }

  private findStoredToolCall(callId: string): StoredToolCall | null {
    for (let i = this.storedHistory.length - 1; i >= 0; i--) {
      const msg = this.storedHistory[i];
      if (msg.role !== 'assistant' || !msg.toolCalls) continue;
      const call = msg.toolCalls.find((c) => c.id === callId);
      if (call) return call;
    }
    return null;
  }

  /** 刷新后无活 Promise：按 interaction 决策补写 tool 结果并继续 */
  private async resumeOrphanedInteraction(
    callId: string,
    decision: CallInteractionDecision,
  ): Promise<void> {
    if (this.busy) return;

    const stored = this.findStoredToolCall(callId);
    if (!stored) return;

    const already = this.storedHistory.some(
      (m) => m.role === 'tool' && m.toolCallId === callId,
    );
    if (!already) {
      let resultText: string;
      let toolAttachments: ChatAttachment[] | undefined;
      let toolName = stored.name;

      if (decision.kind === 'tool_approval') {
        if (!decision.approved) {
          resultText = '⛔ 用户拒绝了该操作。';
        } else {
          try {
            if (!this.toolExecutor) {
              throw new Error('统一工具执行器不可用，已拒绝恢复执行');
            }
            const outcome = await this.toolExecutor.invoke({
              toolName,
              args: stored.args,
              source: 'agent',
              callId,
              approvalAlreadyGranted: true,
            });
            const output = outcome.rawOutput ?? outcome.resultText;
            const { output: outputSansImages, imagePaths } =
              stripCottageImages(output);
            if (imagePaths.length) {
              toolAttachments = this.buildToolAttachments(imagePaths);
            }
            const { resultText: stripped } =
              stripWriteSnapshot(outputSansImages);
            resultText = stripped;
          } catch (error) {
            resultText =
              error instanceof Error ? error.message : String(error);
          }
        }
      } else {
        toolName = 'askUser';
        const question =
          stored.interaction?.kind === 'ask_user'
            ? stored.interaction.question
            : '';
        resultText = JSON.stringify({
          question,
          chosen: decision.chosen,
        });
      }

      this.appendHistoryMessage({
        role: 'tool',
        content: resultText,
        toolCallId: callId,
        name: toolName,
        ...(toolAttachments?.length
          ? { attachments: toolAttachments }
          : {}),
      });
      this.rebuildUiMessages();
    }

    void this.continueAfterInteraction(decision);
  }

  /** 交互在无活回合时被处理完后，直接以已落盘的 tool 结果续跑 Agent。 */
  private async continueAfterInteraction(
    decision: CallInteractionDecision,
  ): Promise<void> {
    try {
      if (this.busy) return;
      this.assertRuntimeCurrent();
      // askUser 的选择已写入对应 tool result；它就是本轮的真实输入。
      // 无需再伪造一条用户“（继续）”消息，避免历史和界面出现无意义气泡。
      const interactionText =
        decision.kind === 'ask_user'
          ? decision.chosen
          : decision.approved
            ? '已允许执行'
            : '已拒绝执行';
      this.beginTurn(interactionText, interactionText.length);
      await this.runAssistantTurn();
    } catch (error) {
      console.warn('[CottageAgent] 恢复交互后继续失败:', error);
    }
  }

  loadHistory(
    history: readonly StoredMessage[],
    llmHistory?: readonly StoredMessage[],
  ): void {
    const { system, rest } = extractSystemPrompt(history);
    const repaired = repairToolCallHistory(rest).map((message) =>
      message.id ? message : { ...message, id: newMessageId() },
    );
    if (system) {
      const systemMsg: StoredMessage = {
        role: 'system',
        content: system,
        id: newMessageId(),
      };
      this.storedHistory = [systemMsg, ...repaired];
    } else {
      this.storedHistory = [...repaired];
    }
    if (llmHistory?.length) {
      this.llmHistory = llmHistory.map((message) =>
        message.id ? message : { ...message, id: newMessageId() },
      );
    } else {
      this.llmHistory = [...this.storedHistory];
    }
    this.rebuildUiMessages();
    this.bumpSectionVersion();
    this.syncContextUsage();
  }

  private rebuildUiMessages(): void {
    this.messages.length = 0;
    // 恢复时把「同一回合内（两个 user 消息之间）的多轮 assistant/tool」合并进同一条
    // UI assistant 消息，与实时流式时的结构保持一致：否则多轮工具调用会被拆到不同消息里，
    // 分组（探索/编辑折叠组）只能在单轮内生效，导致重开会话时操作被平铺展开。
    //
    // 落盘已是每轮增量；旧会话若仍是累计快照，先规范成增量再直接 append。
    const history = normalizeLegacyCumulativeAssistantDeltas(this.storedHistory);
    let currentAssistant: ReturnType<typeof createAssistantMessage> | null = null;
    for (const stored of history) {
      if (stored.role === 'system') continue;
      if (stored.role === 'user') {
        currentAssistant = null;
        this.messages.push(
          (() => {
            const userMsg = createUserMessage({
              llmContent: stored.content,
              userText: stored.userText ?? '',
              fileReferences: stored.fileReferences,
              activeFilePath: stored.activeFilePath,
              attachments: stored.attachments,
            });
            if (stored.id) userMsg.id = stored.id;
            return userMsg;
          })(),
        );
        continue;
      }
      if (stored.role === 'assistant') {
        if (!currentAssistant) {
          currentAssistant = createAssistantMessage();
          this.messages.push(currentAssistant);
        }
        const msg = currentAssistant;
        const hasReasoning =
          Boolean(stored.reasoningContent) &&
          Boolean(stored.reasoningContent?.trim()) &&
          stored.reasoningContent !== MOONSHOT_PLACEHOLDER_REASONING;
        if (hasReasoning) {
          msg.sections.push({ type: 'think', text: stored.reasoningContent! });
        }
        if (stored.content) {
          pushContentWithCottageThinking(msg, stored.content, {
            preferExistingThink: hasReasoning,
          });
        }
        for (const call of stored.toolCalls ?? []) {
          msg.sections.push({
            type: 'call',
            id: call.id,
            name: call.name,
            arguments: JSON.stringify(call.args, null, 2),
            result: undefined,
            interaction: call.interaction,
            running: isPendingInteraction(call.interaction),
          });
        }
        if (stored.error) {
          msg.error = stored.error;
        }
        if (stored.completedAt) {
          msg.completedAt = stored.completedAt;
        }
        continue;
      }
      if (stored.role === 'tool') {
        const callSections = this.messages.flatMap((message) =>
          message.sections.filter((s): s is CallSection => s.type === 'call'),
        );
        // 先按 tool_call_id 精确匹配，匹配不到再回退到首个未填结果的调用，
        // 避免合并后多个调用共存时把结果挂到错误的 section 上。
        const callSection =
          callSections.find((s) => s.id === stored.toolCallId) ??
          callSections.find((s) => !s.result);
        if (callSection) {
          callSection.result = stored.content;
          callSection.running = false;
          if (stored.writePreview) {
            callSection.before = stored.writePreview.before;
            callSection.after = stored.writePreview.after;
            callSection.created = stored.writePreview.created;
          }

          // 已完成的问询独立成消息节点。这样恢复会话或后续继续执行时，
          // 选中的询问不会被合并到先前的长回复中而丢失渲染位置。
          if (isAskUserTool(callSection.name)) {
            const sourceIndex = this.messages.findIndex((message) =>
              message.sections.includes(callSection),
            );
            if (sourceIndex >= 0) {
              const source = this.messages[sourceIndex]!;
              const sectionIndex = source.sections.indexOf(callSection);
              if (sectionIndex >= 0) source.sections.splice(sectionIndex, 1);

              const askMessage = createAssistantMessage();
              askMessage.sections.push(callSection);
              const insertAt = source.sections.length > 0 ? sourceIndex + 1 : sourceIndex;
              if (source.sections.length === 0 && !source.error) {
                this.messages.splice(sourceIndex, 1, askMessage);
              } else {
                this.messages.splice(insertAt, 0, askMessage);
              }
              currentAssistant = askMessage;
            }
          }
        }
      }
    }
  }

  abort(): void {
    this.abortController?.abort();
  }

  /**
   * 从指定用户消息重试：截断该消息之后的上下文，再重新请求模型。
   * 传入 edited 时先用编辑后的内容替换该条用户消息，再重试。
   * UI 消息 id 与 storedHistory 用户消息 id 对齐（新会话）；旧数据按序号回退匹配。
   */
  async retryFromUserMessage(
    messageId: string,
    edited?: ComposedUserMessage,
  ): Promise<void> {
    if (this.busy) {
      throw new Error('Agent 正在回复中');
    }
    this.assertRuntimeCurrent();

    const uiIndex = this.messages.findIndex((m) => m.id === messageId);
    if (uiIndex < 0) {
      throw new Error('消息不存在');
    }
    const uiMsg = this.messages[uiIndex];
    if (uiMsg.role !== 'user') {
      throw new Error('只能从用户消息重试');
    }

    const storedIndex = this.findStoredUserIndexForUiMessage(uiIndex, messageId);
    if (storedIndex < 0) {
      throw new Error('找不到对应历史消息');
    }
    const storedUser = this.storedHistory[storedIndex];

    if (edited) {
      const hasUserContent =
        edited.userText.trim() ||
        edited.references.length ||
        edited.activeFilePath ||
        Boolean(storedUser.attachments?.length);
      if (!hasUserContent) return;

      uiMsg.userText = edited.userText;
      uiMsg.fileReferences = edited.references.length
        ? [...edited.references]
        : undefined;
      uiMsg.activeFilePath = edited.activeFilePath;
      uiMsg.sections = [{ type: 'content', text: edited.llmContent }];

      storedUser.content = edited.llmContent;
      storedUser.userText = edited.userText;
      storedUser.fileReferences = edited.references.length
        ? [...edited.references]
        : undefined;
      storedUser.activeFilePath = edited.activeFilePath;

      const llmIdx = storedUser.id
        ? this.llmHistory.findIndex((m) => m.id === storedUser.id)
        : -1;
      if (llmIdx >= 0) {
        const llmMsg = this.llmHistory[llmIdx];
        llmMsg.content = edited.llmContent;
        llmMsg.userText = edited.userText;
        llmMsg.fileReferences = storedUser.fileReferences
          ? [...storedUser.fileReferences]
          : undefined;
        llmMsg.activeFilePath = edited.activeFilePath;
      }
    }

    const llmContent = storedUser.content.trim();
    if (!llmContent && !storedUser.attachments?.length) return;

    cancelPendingAsk('已从此消息重试', this.sessionId);
    cancelPendingPlanApproval('已从此消息重试', this.sessionId);
    cancelPendingStagedApproval('已从此消息重试', this.sessionId);

    this.storedHistory = this.storedHistory.slice(0, storedIndex + 1);
    const llmCut = storedUser.id
      ? this.llmHistory.findIndex((m) => m.id === storedUser.id)
      : -1;
    this.llmHistory =
      llmCut >= 0
        ? this.llmHistory.slice(0, llmCut + 1)
        : [...this.storedHistory];
    this.messages.splice(uiIndex + 1);
    this.contextUsage = null;
    this.syncContextUsage();
    this.bumpSectionVersion();

    const userText = storedUser.userText ?? uiMsg.userText ?? '';
    this.beginTurn(userText, llmContent.length);
    await this.runAssistantTurn();
  }

  async next(input: string | ComposedUserMessage): Promise<void> {
    if (this.busy) {
      throw new Error('Agent 正在回复中');
    }
    this.assertRuntimeCurrent();

    const payload =
      typeof input === 'string'
        ? {
            llmContent: input.trim(),
            userText: input.trim(),
            references: [] as const,
            attachments: undefined,
          }
        : input;
    const llmContent = payload.llmContent.trim();
    const attachments = payload.attachments ?? [];
    if (!llmContent && !attachments.length) return;

    // 如果用户没有输入任何实质内容（空文本、无引用、无附件），不加入历史记录
    const hasUserContent =
      payload.userText.trim() ||
      payload.references?.length ||
      attachments.length;
    if (!hasUserContent) return;

    this.beginTurn(payload.userText, llmContent.length);

    // workspace-file 模式：附件先落盘到工作区，历史只存相对路径
    const storedAttachments = attachments.length
      ? await persistAttachments(attachments)
      : undefined;

    const userMsg = createUserMessage({
      llmContent,
      userText: payload.userText,
      fileReferences: payload.references,
      activeFilePath: payload.activeFilePath,
      attachments: storedAttachments,
    });
    this.messages.push(userMsg);
    this.appendHistoryMessage({
      id: userMsg.id,
      role: 'user',
      content: llmContent,
      userText: payload.userText,
      fileReferences: payload.references.length
        ? [...payload.references]
        : undefined,
      activeFilePath: payload.activeFilePath,
      attachments: storedAttachments?.length ? storedAttachments : undefined,
    });
    this.bumpSectionVersion();

    await this.runAssistantTurn();
  }

  private beginTurn(userText: string, promptChars: number): void {
    this.busy = true;
    this.turnInFlight = true;
    this.turnStartedAt = Date.now();
    this.abortController = new AbortController();
    this.planSession?.reset();
    this.doomLoopDetector.reset();
    this.doomLoopHitCount = 0;
    // 回合边界清空暂存：上一回合未审批/异常残留的暂存改动一律丢弃
    this.stagingStore?.clear();

    // 用户新增消息后，上一次的 usage 不再代表当前上下文，改为重新估算
    this.contextUsage = null;
    this.syncContextUsage();

    this.traceRecorder?.append({
      type: 'turn_start',
      at: Date.now(),
      mode: this.agentMode,
      promptChars,
    });
    this.emitEvent({
      type: 'task_started',
      at: Date.now(),
      mode: this.agentMode,
    });
    this.lastUserText = userText;
    // pre_turn checkpoint：在用户消息加入前建点（非阻塞，避免延迟回合开始）
    void this.createPreTurnCheckpoint(userText);
    this.setStatus({ phase: 'thinking' });
  }

  /** 以当前用户输入或已解决的工具结果为上下文，创建 assistant 气泡并跑工具循环。 */
  private async runAssistantTurn(): Promise<void> {
    const signal = this.abortController!.signal;

    await this.maybeCompact();

    const assistantMsg = createAssistantMessage();
    this.messages.push(assistantMsg);
    this.inFlightAssistantMsg = assistantMsg;
    this.bumpSectionVersion();

    let response: CottageAssistantResponse | undefined;
    let runtimeMessages: CottageModelMessage[] = [];
    try {
      if (this.moonshotThinking) {
        setMoonshotAssistantReasoningPatch(this.moonshotReasoningPatchFromHistory());
      }
      runtimeMessages = await this.buildRuntimeMessages();
      response = await this.streamModel(runtimeMessages, assistantMsg, signal);

      let toolRound = 0;
      const toolCallCounts = new Map<string, number>();
      let loopStopReason: string | null = null;
      /** 已落盘的累计正文/思考，用于切出每轮增量 */
      const persistCursor = { content: '', reasoning: '' };

      while (!signal.aborted && response.toolCalls?.length) {
        // 进入工具轮前收起正文光标（部分厂商不走 tool_call_chunks 流）
        sealAssistantTextStreaming(assistantMsg);
        toolRound += 1;
        if (this.planSession?.plan) {
          this.planSession.counters.turns += 1;
        }

        // 部分厂商/流式返回的 tool_call 可能没有 id；同一轮 assistant message 与后续 tool message
        // 的 tool_call_id 必须完全一致，否则 LLM API 会报 "tool_call_ids did not have response messages"。
        let planTurnBoundaryReached = false;
        for (const call of response.toolCalls) {
          if (!call.id) {
            call.id = crypto.randomUUID();
          }
        }

        const roundDelta = this.takeAssistantHistoryDelta(
          assistantMsg,
          response,
          persistCursor,
        );
        this.appendHistoryMessage({
          role: 'assistant',
          content: roundDelta.content,
          reasoningContent: roundDelta.reasoningContent,
          toolCalls: response.toolCalls.map((call) => ({
            id: call.id ?? crypto.randomUUID(),
            name: call.name,
            args: (call.args ?? {}) as Record<string, unknown>,
          })),
        });

        runtimeMessages.push(assistantResponseMessage(response));

        for (const call of response.toolCalls) {
          if (signal.aborted) {
            this.finalizeInterruptedToolCalls(response.toolCalls, runtimeMessages);
            break;
          }

          const toolName = call.name;
          const toolInstance =
            this.toolMap.get(toolName) ??
            this.toolMap.get(normalizeToolName(toolName));
          const callId = call.id ?? crypto.randomUUID();
          const argsText = JSON.stringify(call.args ?? {}, null, 2);

          const existing = assistantMsg.sections.find(
            (s): s is Extract<typeof s, { type: 'call' }> =>
              s.type === 'call' &&
              (s.id === callId ||
                (s.name === toolName && Boolean(s.running) && s.result === undefined)),
          );
          const callSection: CottageSection = existing ?? {
            type: 'call',
            id: callId,
            name: toolName,
            arguments: argsText,
            running: true,
          };
          if (!existing) {
            assistantMsg.sections.push(callSection);
          } else {
            callSection.id = callId;
            callSection.arguments = argsText;
            callSection.running = true;
          }
          callSection.argsStreaming = false;
          this.bumpSectionVersion();

          let resultText: string;
          let toolAttachments: ChatAttachment[] | undefined;
          const fingerprint = toolCallFingerprint(toolName, call.args);
          const priorCalls = toolCallCounts.get(fingerprint) ?? 0;
          const callAttempt = priorCalls + 1;
          toolCallCounts.set(fingerprint, callAttempt);

          let policyBlockedReason: string | null = null;
          let planBlockedReason: string | null = planTurnBoundaryReached
            ? '前一个计划控制调用已结束当前执行边界，请等待系统注入下一步骤上下文'
            : null;
          let doomLoopBlockedReason: string | null = null;
          let planGuardVerdict: ReturnType<PlanToolGuard['check']> | undefined;

          const doomPattern = this.doomLoopDetector.check({
            name: toolName,
            args: call.args ?? {},
          });
          if (
            doomPattern &&
            callAttempt <= MAX_IDENTICAL_TOOL_CALLS &&
            !planBlockedReason &&
            !this.toolExecutor
          ) {
            this.doomLoopHitCount += 1;
            // 前几次只提醒模型自行换思路；多次仍循环后再提用户闸门
            if (this.doomLoopHitCount <= DOOM_LOOP_SOFT_WARN_LIMIT) {
              doomLoopBlockedReason = buildDoomLoopSoftWarnMessage({
                toolName,
                reason: doomPattern.reason,
                pattern: doomPattern.pattern,
                hitCount: this.doomLoopHitCount,
                softLimit: DOOM_LOOP_SOFT_WARN_LIMIT,
              });
            } else if (this.policyGate) {
              try {
                this.setStatus({ phase: 'approval', toolName: DOOM_LOOP_TOOL_NAME });
                void this.createPreRiskyCheckpoint(DOOM_LOOP_TOOL_NAME, toolRound);
                const doomVerdict = await this.policyGate({
                  toolName: DOOM_LOOP_TOOL_NAME,
                  args: {
                    reason: doomPattern.reason,
                    pattern: doomPattern.pattern,
                    targetTool: toolName,
                  },
                  callId,
                  signal,
                  onAwaitingApproval: ({ message }) => {
                    this.setCallInteraction(callId, {
                      kind: 'tool_approval',
                      status: 'pending',
                      approvalKind: 'doom_loop',
                      title: '检测到工具循环',
                      message:
                        message ||
                        `助手反复调用「${toolName}」（${doomPattern.reason}），软提醒后仍未收敛。\n\n允许：再执行一次。\n拒绝：跳过这次，让助手换做法。`,
                    });
                  },
                });
                const doomInteraction = this.findStoredToolCall(callId)?.interaction;
                if (doomInteraction?.kind === 'tool_approval') {
                  this.setCallInteraction(callId, {
                    ...doomInteraction,
                    status: doomVerdict.allowed ? 'resolved' : 'cancelled',
                    decision: { approved: doomVerdict.allowed },
                  });
                }
                if (!doomVerdict.allowed) {
                  doomLoopBlockedReason =
                    doomVerdict.reason ??
                    `检测到工具调用循环：${doomPattern.reason}`;
                }
              } catch (error) {
                if (signal.aborted) {
                  this.finalizeInterruptedToolCalls(response.toolCalls, runtimeMessages);
                  callSection.running = false;
                  break;
                }
                doomLoopBlockedReason =
                  error instanceof Error ? error.message : String(error);
              }
            } else {
              doomLoopBlockedReason = buildDoomLoopSoftWarnMessage({
                toolName,
                reason: doomPattern.reason,
                pattern: doomPattern.pattern,
                hitCount: this.doomLoopHitCount,
                softLimit: DOOM_LOOP_SOFT_WARN_LIMIT,
              });
            }
          }

          if (
            callAttempt <= MAX_IDENTICAL_TOOL_CALLS &&
            !planBlockedReason &&
            !doomLoopBlockedReason &&
            this.planToolGuard &&
            !this.toolExecutor
          ) {
            planGuardVerdict = this.planToolGuard.check({
              toolName,
              args: call.args ?? {},
              source: 'agent',
            });
            if (!planGuardVerdict.allowed) {
              await this.planToolGuard.block(planGuardVerdict);
              planBlockedReason =
                planGuardVerdict.reason ?? '该操作未被批准计划授权';
            }
          }
          if (
            callAttempt <= MAX_IDENTICAL_TOOL_CALLS &&
            !planBlockedReason &&
            !doomLoopBlockedReason &&
            this.planGate &&
            !this.toolExecutor
          ) {
            const planVerdict = this.planGate({
              toolName,
              toolRound: toolRound,
              args: (call.args as Record<string, unknown> | undefined) ?? {},
            });
            if (!planVerdict.allowed) {
              planBlockedReason =
                planVerdict.reason ?? '该操作被计划闸门阻止';
            }
          }
          if (
            callAttempt <= MAX_IDENTICAL_TOOL_CALLS &&
            !planBlockedReason &&
            !doomLoopBlockedReason &&
            this.policyGate &&
            !this.toolExecutor
          ) {
            try {
              this.setStatus({ phase: 'approval', toolName });
              void this.createPreRiskyCheckpoint(toolName, toolRound);
              const verdict = await this.policyGate({
                toolName,
                args: call.args ?? {},
                callId,
                signal,
                onAwaitingApproval: ({ message }) => {
                  this.setCallInteraction(callId, {
                    kind: 'tool_approval',
                    status: 'pending',
                    approvalKind: 'policy',
                    title: `需要确认：${toolLocaleAlias(toolName)}`,
                    message,
                  });
                },
              });
              const approvalInteraction =
                this.findStoredToolCall(callId)?.interaction;
              if (approvalInteraction?.kind === 'tool_approval') {
                this.setCallInteraction(callId, {
                  ...approvalInteraction,
                  status: verdict.allowed ? 'resolved' : 'cancelled',
                  decision: { approved: verdict.allowed },
                });
              }
              if (!verdict.allowed) {
                policyBlockedReason =
                  verdict.reason ?? '该操作被安全策略阻止';
              }
            } catch (error) {
              if (signal.aborted) {
                this.finalizeInterruptedToolCalls(response.toolCalls, runtimeMessages);
                callSection.running = false;
                break;
              }
              policyBlockedReason =
                error instanceof Error ? error.message : String(error);
            }
          }
          if (signal.aborted) {
            this.finalizeInterruptedToolCalls(response.toolCalls, runtimeMessages);
            callSection.running = false;
            break;
          }

          if (
            !planBlockedReason &&
            !policyBlockedReason &&
            !doomLoopBlockedReason &&
            planGuardVerdict &&
            this.planToolGuard &&
            !this.toolExecutor
          ) {
            try {
              await this.planToolGuard.beforeExecute(planGuardVerdict);
            } catch (error) {
              planBlockedReason =
                error instanceof Error ? error.message : String(error);
            }
          }

          const toolCallStartedAt = Date.now();
          // 供脚本桥将 cottage.* 子调用归属到宿主 runScript（parentCallId / 重复指纹作用域）
          if (this.toolStreamContext) {
            this.toolStreamContext.currentCallId = callId;
          }
          if (!planBlockedReason && !policyBlockedReason) {
            this.setStatus({ phase: 'tool_call', toolName });
          }

          let traceStatus: TraceToolStatus = 'ok';
          let executedByUnifiedExecutor = false;
          let toolStreamed = false;
          let toolChunkCount = 0;
          if (callAttempt > MAX_IDENTICAL_TOOL_CALLS && !this.toolExecutor) {
            traceStatus = 'duplicate';
            resultText =
              `已阻止重复调用：${toolName} 使用相同参数已调用 ${callAttempt} 次。` +
              '请先 readFile 确认文件现状，或向用户说明无法继续，勿再用相同参数重试。';
            this.doomLoopDetector.record({
              name: toolName,
              args: call.args ?? {},
              status: 'blocked',
            });
          } else if (doomLoopBlockedReason) {
            traceStatus = 'doom_loop';
            resultText = `🔁 循环检测：${doomLoopBlockedReason}`;
            this.doomLoopDetector.record({
              name: toolName,
              args: call.args ?? {},
              status: 'blocked',
            });
          } else if (planBlockedReason) {
            traceStatus = 'blocked_plan';
            resultText = `📋 计划闸门：${planBlockedReason}`;
            if (this.planSession) {
              this.planSession.lastBlockedReason = planBlockedReason;
            }
          } else if (policyBlockedReason) {
            traceStatus = 'blocked_policy';
            resultText = `⛔ 操作被安全策略阻止：${policyBlockedReason}。如需继续请向用户说明，或改用低风险方式。`;
          } else {
            try {
              if (!toolInstance) {
                traceStatus = 'unknown_tool';
                throw new Error(
                  `未知工具: ${toolName}。若属于延后工具，请先调用 loadTools({ names: ["${toolName}"] }) 再使用。`,
                );
              }
              if (isAskUserTool(toolName)) {
                const askArgs = call.args as { question?: unknown; options?: unknown };
                const question =
                  typeof askArgs.question === 'string'
                    ? askArgs.question.trim()
                    : '';
                if (!question) {
                  throw new Error('question 不能为空');
                }
                const options = normalizeAskUserOptions(askArgs.options);
                this.setCallInteraction(callId, {
                  kind: 'ask_user',
                  status: 'pending',
                  question,
                  options,
                });
                this.setStatus({ phase: 'approval', toolName });
                const askDecision = await waitForCallInteraction({
                  sessionId: this.sessionId,
                  callId,
                  signal,
                });
                if (signal.aborted) {
                  this.finalizeInterruptedToolCalls(
                    response.toolCalls,
                    runtimeMessages,
                  );
                  callSection.running = false;
                  break;
                }
                if (askDecision.kind !== 'ask_user') {
                  throw new Error('askUser 交互决策类型不匹配');
                }
                const chosen = askDecision.chosen.trim();
                this.setCallInteraction(callId, {
                  kind: 'ask_user',
                  status: 'resolved',
                  question,
                  options,
                  decision: { chosen },
                });
                resultText = JSON.stringify({ question, chosen });
                if (!executedByUnifiedExecutor && this.planSession) {
                  recordPlanToolOutcome(this.planSession, toolName);
                }
                if (!executedByUnifiedExecutor) {
                  this.doomLoopDetector.record({
                    name: toolName,
                    args: call.args ?? {},
                    status: 'ok',
                  });
                }
              } else {
                let output: unknown;
                if (this.toolExecutor) {
                  executedByUnifiedExecutor = true;
                  const outcome = await this.toolExecutor.invoke({
                    toolName,
                    args: call.args ?? {},
                    source: 'agent',
                    callId,
                    signal,
                    round: toolRound,
                    onAwaitingApproval: ({ message }) => {
                      this.setCallInteraction(callId, {
                        kind: 'tool_approval',
                        status: 'pending',
                        approvalKind: 'policy',
                        title: `需要确认：${toolLocaleAlias(toolName)}`,
                        message,
                      });
                    },
                  });
                  traceStatus = outcome.status;
                  const approvalInteraction = this.findStoredToolCall(callId)?.interaction;
                  if (
                    approvalInteraction?.kind === 'tool_approval' &&
                    approvalInteraction.status === 'pending'
                  ) {
                    const approved = outcome.status !== 'blocked_policy';
                    this.setCallInteraction(callId, {
                      ...approvalInteraction,
                      status: approved ? 'resolved' : 'cancelled',
                      decision: { approved },
                    });
                  }
                  output = outcome.rawOutput ?? outcome.resultText;
                  resultText = outcome.resultText;
                  if (outcome.imagePaths.length) {
                    toolAttachments = this.buildToolAttachments(outcome.imagePaths);
                  }
                  if (outcome.snapshot) {
                    callSection.before = outcome.snapshot.before;
                    callSection.after = outcome.snapshot.after;
                    callSection.created = outcome.snapshot.created;
                  }
                } else if (supportsToolStream(toolName)) {
                  throw new Error('统一工具执行器不可用，已拒绝直接执行流式工具');
                } else {
                  throw new Error('统一工具执行器不可用，已拒绝直接执行工具');
                }
                if (signal.aborted) {
                  this.finalizeInterruptedToolCalls(response.toolCalls, runtimeMessages);
                  callSection.running = false;
                  break;
                }
                if (!executedByUnifiedExecutor && planGuardVerdict && this.planToolGuard) {
                  await this.planToolGuard.afterExecute(planGuardVerdict, true);
                }
                const { output: outputSansImages, imagePaths: toolImagePaths } =
                  stripCottageImages(output);
                if (toolImagePaths.length) {
                  toolAttachments = this.buildToolAttachments(toolImagePaths);
                }
                const { resultText: strippedText, snapshot } =
                  stripWriteSnapshot(outputSansImages);
                resultText = strippedText;
                if (snapshot) {
                  callSection.before = snapshot.before;
                  callSection.after = snapshot.after;
                  callSection.created = snapshot.created;
                  if (!snapshot.created && snapshot.before !== snapshot.after) {
                    callSection.diffText = await computeDiffInWorker(
                      snapshot.before,
                      snapshot.after,
                      signal,
                    );
                  }
                  const filePath = parseWriteSnapshotPath(call.args);
                  if (filePath) {
                    this.emitEvent({
                      type: 'patch_applied',
                      at: Date.now(),
                      toolName,
                      path: filePath,
                      created: snapshot.created,
                    });
                  }
                }
                if (!executedByUnifiedExecutor && this.planSession) {
                  recordPlanToolOutcome(this.planSession, toolName);
                }
                if (!executedByUnifiedExecutor) {
                  this.doomLoopDetector.record({
                    name: toolName,
                    args: call.args ?? {},
                    status: 'ok',
                  });
                }
              }
            } catch (error) {
              if (!executedByUnifiedExecutor && planGuardVerdict && this.planToolGuard) {
                await this.planToolGuard
                  .afterExecute(planGuardVerdict, false)
                  .catch(() => undefined);
              }
              if (signal.aborted) {
                this.finalizeInterruptedToolCalls(response.toolCalls, runtimeMessages);
                callSection.running = false;
                if (traceStatus === 'ok') traceStatus = 'aborted';
                break;
              }
              traceStatus = 'error';
              resultText =
                error instanceof Error ? error.message : String(error);
              this.doomLoopDetector.record({
                name: toolName,
                args: call.args ?? {},
                status: 'error',
              });
            }
          }

          callSection.result = resultText;
          callSection.running = false;
          this.bumpSectionVersion();

          this.emitEvent({
            type: 'tool_finished',
            at: Date.now(),
            toolName,
            callId,
            status:
              traceStatus === 'ok'
                ? 'ok'
                : traceStatus === 'error'
                  ? 'error'
                  : 'blocked',
          });

          if (!executedByUnifiedExecutor) this.traceRecorder?.append({
            type: 'tool_call',
            at: toolCallStartedAt,
            id: callId,
            round: toolRound,
            name: toolName,
            args: call.args,
            status: traceStatus,
            resultSnippet: resultText,
            before: callSection.before,
            after: callSection.after,
            created: callSection.created,
            ...(callSection.diffText
              ? { diffSnippet: callSection.diffText.slice(0, 4000) }
              : {}),
            durationMs: Date.now() - toolCallStartedAt,
            ...(toolStreamed
              ? { streamed: true, chunkCount: toolChunkCount }
              : {}),
          });

          // 计划提交单独记录一条 plan 事件
          if (toolName === 'submitExecutionPlan' && traceStatus === 'ok') {
            const planArgs = (call.args ?? {}) as {
              goal?: string;
              items?: unknown[];
              budget?: { maxFiles?: number; maxApiCalls?: number; maxTurns?: number };
            };
            this.traceRecorder?.append({
              type: 'plan',
              at: Date.now(),
              goal: planArgs.goal ?? '',
              itemCount: planArgs.items?.length ?? 0,
              budget: planArgs.budget,
              approved: true,
            });
          }

          runtimeMessages.push(
            toolResultMessage({
              content: resultText,
              toolCallId: callId,
              name: toolName,
              isError: traceStatus === 'error',
            }),
          );
          this.appendHistoryMessage({
            role: 'tool',
            content: resultText,
            toolCallId: callId,
            name: toolName,
            ...(toolAttachments?.length
              ? { attachments: toolAttachments }
              : {}),
            ...(callSection.before !== undefined ||
            callSection.after !== undefined ||
            callSection.created !== undefined
              ? {
                  writePreview: {
                    before: callSection.before,
                    after: callSection.after,
                    created: callSection.created,
                  },
                }
              : {}),
          });
          // 工具图片紧随 tool 消息即时注入本轮上下文，使模型当轮可见
          if (toolAttachments?.length) {
            await this.injectToolImagesIntoTurn(
              toolName,
              toolAttachments,
              runtimeMessages,
            );
          }
          if (
            traceStatus === 'ok' &&
            [
              'suggestPlanMode',
              'submitPlan',
              'completePlanStep',
              'blockPlanStep',
              'requestPlanRevision',
              'completePlanRun',
              'failPlanRun',
            ].includes(toolName)
          ) {
            planTurnBoundaryReached = true;
          }
        }

        if (planTurnBoundaryReached) {
          loopStopReason = '计划状态已提交；下一执行轮将重新注入批准版本、步骤证据、验证能力和剩余预算。';
          break;
        }

        // loadTools 可能刚激活新工具：每轮请求重新读取当前工具数组。
        response = await this.streamModel(runtimeMessages, assistantMsg, signal);
      }

      if (loopStopReason) {
        appendAssistantText(assistantMsg, `\n\n${loopStopReason}`);
      }

      finalizeAssistantStreaming(assistantMsg);

      // 用本轮最终响应里的 usage 校准上下文长度
      this.recordUsageFromMessage(response);

      if (!signal.aborted) {
        const text = response.content;
        if (text && !loopStopReason) {
          const hasStreamedText = assistantMsg.sections.some(
            (s) =>
              (s.type === 'content' || s.type === 'think') && s.text.trim(),
          );
          if (!hasStreamedText) {
            appendAssistantText(assistantMsg, text);
          }
        }
        const roundDelta = this.takeAssistantHistoryDelta(
          assistantMsg,
          response,
          persistCursor,
        );
        const completedAt = Date.now();
        assistantMsg.completedAt = completedAt;
        this.appendHistoryMessage({
          role: 'assistant',
          content: roundDelta.content,
          reasoningContent: roundDelta.reasoningContent,
          completedAt,
        });
      }

      // 回合末：若暂存区有改动，阻塞等待用户审批后再合并落盘（纯文件操作，不再调用 LLM）
      if (
        this.stagingStore &&
        this.stagingWorkspace &&
        !this.stagingStore.isEmpty() &&
        !signal.aborted
      ) {
        await this.reviewAndCommitStaged(signal);
      }

      if (signal.aborted) {
        this.recordTurnError(assistantMsg, '已停止生成');
        this.emit('rewind');
        this.traceRecorder?.append({
          type: 'turn_end',
          at: Date.now(),
          endReason: 'aborted',
        });
      } else {
        const finish = normalizeFinishReason(response);
        const traceEndReason = this.resolveTraceEndReason(finish.kind, loopStopReason);
        if (finish.kind === 'content_filter' || finish.kind === 'refusal') {
          this.recordTurnError(assistantMsg, finishReasonUserMessage(finish.kind));
          this.emit('rewind');
        } else if (finish.kind === 'empty') {
          this.emit('assistantComplete');
          this.emit('stalled');
        } else {
          this.emit('assistantComplete');
        }
        this.traceRecorder?.append({
          type: 'turn_end',
          at: Date.now(),
          endReason: traceEndReason,
        });
      }
    } catch (error) {
      finalizeAssistantStreaming(assistantMsg);
      // 若工具调用循环中抛出未捕获异常，已发出的 assistant tool calls 可能没有对应 tool message，
      // 这会导致下一轮 LLM 请求触发 "tool_call_ids did not have response messages" 错误，
      // 因此在这里统一补齐缺失的 tool response。
      if (response?.toolCalls?.length) {
        this.finalizeInterruptedToolCalls(response.toolCalls, runtimeMessages);
      }
      if (signal.aborted) {
        this.recordTurnError(assistantMsg, '已停止生成');
        this.emit('rewind');
      } else {
        const info = classifyLlmError(error);
        this.recordTurnError(assistantMsg, friendlyErrorMessage(info));
        this.emit('assistantComplete');
      }
      this.traceRecorder?.append({
        type: 'turn_end',
        at: Date.now(),
        endReason: signal.aborted ? 'aborted' : 'error',
        error:
          error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (this.moonshotThinking) {
        clearMoonshotAssistantReasoningPatch();
      }
      this.busy = false;
      this.turnInFlight = false;
      this.turnStartedAt = null;
      this.inFlightAssistantMsg = null;
      this.abortController = null;
      this.setStatus({ phase: 'idle' });
      this.emitEvent({
        type: 'task_finished',
        at: Date.now(),
        endReason: signal.aborted ? 'aborted' : 'complete',
      });
      // 与 assistantComplete → persistSession 共用串行 flush；
      // 这里 await 确保 turn_end / 终态 message 在回合返回前入队写盘。
      await this.traceRecorder?.flush();
      this.bumpSectionVersion();
      // post_turn checkpoint：绑定工作区 oid
      void this.createPostTurnCheckpoint();
    }
  }

  /**
   * 截取到指定 UI 助手消息（含其完整工具轮次）为止的 transcript，用于分叉新对话。
   */
  getHistoryThroughUiMessage(messageId: string): StoredMessage[] {
    const uiIndex = this.messages.findIndex((m) => m.id === messageId);
    if (uiIndex < 0) {
      throw new Error('消息不存在');
    }
    const uiMsg = this.messages[uiIndex];
    if (uiMsg.role !== 'assistant') {
      throw new Error('只能从助手消息分叉');
    }

    let nextUserUiIndex = -1;
    for (let i = uiIndex + 1; i < this.messages.length; i += 1) {
      if (this.messages[i].role === 'user') {
        nextUserUiIndex = i;
        break;
      }
    }

    let endIndex: number;
    if (nextUserUiIndex >= 0) {
      const nextStored = this.findStoredUserIndexForUiMessage(
        nextUserUiIndex,
        this.messages[nextUserUiIndex].id,
      );
      if (nextStored < 0) {
        throw new Error('找不到对应历史消息');
      }
      endIndex = nextStored - 1;
    } else {
      endIndex = this.storedHistory.length - 1;
    }

    if (endIndex < 0) return [];
    return this.storedHistory.slice(0, endIndex + 1).map((message) => ({
      ...message,
      toolCalls: message.toolCalls?.map((call) => ({ ...call })),
      fileReferences: message.fileReferences
        ? [...message.fileReferences]
        : undefined,
      attachments: message.attachments
        ? message.attachments.map((item) => ({ ...item }))
        : undefined,
    }));
  }

  private findStoredUserIndexForUiMessage(
    uiIndex: number,
    messageId: string,
  ): number {
    const byId = this.storedHistory.findIndex(
      (m) => m.role === 'user' && m.id === messageId,
    );
    if (byId >= 0) return byId;

    const userOrdinal =
      this.messages.slice(0, uiIndex + 1).filter((m) => m.role === 'user')
        .length - 1;
    let seen = -1;
    for (let i = 0; i < this.storedHistory.length; i++) {
      if (this.storedHistory[i].role !== 'user') continue;
      seen += 1;
      if (seen === userOrdinal) return i;
    }
    return -1;
  }

  private finalizeInterruptedToolCalls(
    toolCalls: CottageToolCall[],
    runtimeMessages: CottageModelMessage[],
  ): void {
    for (const call of toolCalls) {
      const callId = call.id ?? '';
      if (!callId) continue;
      const already = this.storedHistory.some(
        (message) => message.role === 'tool' && message.toolCallId === callId,
      );
      if (already) continue;

      const resultText = '[已中断]';
      runtimeMessages.push(
        toolResultMessage({
          content: resultText,
          toolCallId: callId,
          name: call.name,
        }),
      );
      this.appendHistoryMessage({
        role: 'tool',
        content: resultText,
        toolCallId: callId,
        name: call.name,
        interrupted: true,
      });
    }
  }

  private async maybeCompact(): Promise<void> {
    const cfg = getCottageConfig().compaction;
    if (cfg?.auto === false) return;

    const threshold = cfg?.threshold ?? COMPACTION_THRESHOLD;
    const keepRecentTurns = cfg?.keepRecentTurns ?? COMPACTION_KEEP_RECENT_TURNS;
    const tokens = estimateContextTokens(
      this.systemPrompt,
      this.llmHistory,
      this.modelConfig?.model,
    );
    const window = this.resolveContextWindowForModel();
    if (window <= 0 || tokens / window < threshold) return;

    const { droppedCount, before, afterEstimate } = estimateCompactionBenefit(
      this.llmHistory,
      keepRecentTurns,
    );
    if (droppedCount === 0) return;

    // pre_compaction checkpoint：在压缩 LLM 上下文前建点（不绑定工作区）
    await this.createPreCompactionCheckpoint();

    const userIndexes: number[] = [];
    this.llmHistory.forEach((message, index) => {
      if (message.role === 'user') userIndexes.push(index);
    });
    const recentStart =
      userIndexes.length <= keepRecentTurns
        ? 0
        : (userIndexes[userIndexes.length - keepRecentTurns] ?? 0);
    const coveredMessageIds = this.llmHistory
      .slice(0, recentStart)
      .map((message) => message.id)
      .filter((id): id is string => Boolean(id));

    const result = await compactHistory(this.llmHistory, {
      keepRecentTurns,
      summarize: async (prompt) => {
        const response = await this.model.generate({
          messages: [
            {
              role: 'system',
              content:
                '你是任务历史压缩助手。输出简洁中文摘要，保留文件路径、标识符与任务进度。',
            },
            { role: 'user', content: prompt },
          ],
        });
        return response.content;
      },
    });

    if (result.droppedCount === 0) return;

    const summaryMessage: StoredMessage =
      result.kept[0]?.compaction
        ? result.kept[0].id
          ? result.kept[0]
          : { ...result.kept[0], id: newMessageId() }
        : {
            role: 'user',
            content: `[上下文已压缩，以下为较早对话摘要]\n\n${result.summary}`,
            userText: `已压缩上下文（覆盖 ${coveredMessageIds.length} 条较早消息）`,
            synthetic: true,
            compaction: true,
            id: newMessageId(),
          };

    const keptRest = result.kept[0]?.compaction
      ? result.kept.slice(1)
      : result.kept;
    // 只压缩发给模型的投影；展示 transcript 保持完整
    this.llmHistory = [summaryMessage, ...keptRest];
    this.contextUsage = null;
    this.syncContextUsage();
    this.traceRecorder?.append({
      type: 'compaction',
      at: Date.now(),
      droppedCount: result.droppedCount,
      keptCount: this.llmHistory.length,
      beforeTokens: before,
      afterTokensEstimate: afterEstimate,
      summaryMessage,
      coveredMessageIds,
    });
    this.bumpSectionVersion();
  }

  private resolveTraceEndReason(
    kind: FinishReasonKind,
    loopStopReason: string | null,
  ): TraceTurnEndEvent['endReason'] {
    if (kind === 'content_filter') return 'content_filter';
    if (kind === 'empty') return 'stalled';
    if (loopStopReason) return 'stopped';
    if (kind === 'length') return 'stopped';
    return 'complete';
  }

  private moonshotReasoningPatchFromHistory(): string[] {
    return this.llmHistory
      .filter((m) => m.role === 'assistant')
      .map((m) => m.reasoningContent?.trim() || MOONSHOT_PLACEHOLDER_REASONING);
  }

  private recordUsageFromMessage(message: CottageAssistantResponse): void {
    const usage = normalizeUsage(message.usage);
    if (!usage) return;
    this.contextUsage = usage;
    this.syncContextUsage();
  }

  /**
   * 解析上下文窗口：优先 models.dev 真实值，回退到基于 model id 的本地规则。
   */
  private resolveContextWindowForModel(): number {
    const model = this.modelConfig?.model;
    const provider = this.modelConfig?.provider;
    if (model && provider) {
      const fromCatalog = resolveCatalogContextWindow(
        normalizeProviderId(provider),
        model,
      );
      if (fromCatalog && fromCatalog > 0) return fromCatalog;
    }
    return resolveContextWindow(model);
  }

  private syncContextUsage(): void {
    const model = this.modelConfig?.model;
    const tokens = this.contextUsage?.totalTokens
      ?? estimateContextTokens(this.systemPrompt, this.llmHistory, model);
    syncContextUsageToViewState(
      this.agentViewState,
      this.contextUsage,
      tokens,
      this.resolveContextWindowForModel(),
    );
  }

  private extractReasoningFromAi(message: CottageAssistantResponse): string {
    return message.reasoningContent?.trim() || MOONSHOT_PLACEHOLDER_REASONING;
  }

  /** API reasoning（非占位）优先；否则用 UI think sections / 正文标签抽出的思考 */
  private resolveAssistantReasoning(
    response: CottageAssistantResponse,
    assistantMsg: CottageMessage,
    rawContent?: string,
  ): string | undefined {
    const api = this.extractReasoningFromAi(response);
    if (api && api !== MOONSHOT_PLACEHOLDER_REASONING) {
      return api;
    }
    const fromSections = assistantMsg.sections
      .filter((s): s is Extract<CottageSection, { type: 'think' }> => s.type === 'think')
      .map((s) => s.text.trim())
      .filter(Boolean)
      .join('\n\n');
    if (fromSections) return fromSections;
    if (rawContent) {
      const { thinking } = extractThinkingFromContent(rawContent);
      if (thinking) return thinking;
    }
    return undefined;
  }

  private resolveAssistantContent(
    assistantMsg: CottageMessage,
    rawContent: string,
  ): string {
    const fromSections = assistantMsg.sections
      .filter((s): s is Extract<CottageSection, { type: 'content' }> => s.type === 'content')
      .map((s) => s.text)
      .join('');
    if (fromSections.trim()) return fromSections;
    if (!rawContent) return '';
    return extractThinkingFromContent(rawContent).content;
  }

  /**
   * 工具循环里 UI 气泡正文是累计的，但 transcript / LLM / 落盘必须是「本轮增量」，
   * 否则每轮重写全文会让磁盘与上下文近似 O(n²) 膨胀，并诱发模型复读前文。
   */
  private takeAssistantHistoryDelta(
    assistantMsg: CottageMessage,
    response: CottageAssistantResponse,
    cursor: { content: string; reasoning: string },
  ): { content: string; reasoningContent?: string } {
    const raw = response.content;
    const fullContent = this.resolveAssistantContent(assistantMsg, raw);
    const fullReasoning = this.resolveAssistantReasoning(
      response,
      assistantMsg,
      raw,
    );

    let content: string;
    if (cursor.content && fullContent.startsWith(cursor.content)) {
      content = fullContent.slice(cursor.content.length);
    } else if (fullContent === cursor.content) {
      content = '';
    } else {
      content = fullContent;
    }
    cursor.content = fullContent;

    let reasoningContent: string | undefined;
    if (fullReasoning) {
      if (cursor.reasoning && fullReasoning.startsWith(cursor.reasoning)) {
        const delta = fullReasoning.slice(cursor.reasoning.length);
        reasoningContent = delta.trim() ? delta : undefined;
      } else if (fullReasoning !== cursor.reasoning) {
        reasoningContent = fullReasoning;
      }
      cursor.reasoning = fullReasoning;
    }

    return { content, reasoningContent };
  }

  /** 当前模型是否可接收图片（能力门控关闭时由用户手动放行） */
  private currentModelSupportsVision(): boolean {
    const visionConfig = getCottageConfig().vision;
    if (visionConfig?.enabled === false) return false;
    if (visionConfig?.requireModelCapability === false) return true;
    const provider = this.modelConfig?.provider;
    const model = this.modelConfig?.model;
    if (!provider || !model) return false;
    const meta = getCachedProviderModels(provider, true, this.modelConfig?.baseUrl)?.find(
      (m) => m.id === model,
    );
    return supportsVisionInput(
      resolveCottageModelCapabilities({ provider, model }, meta),
    );
  }

  /** 工具回传的工作区图片路径 → 路径态附件（挂到 tool 消息，后续 hydrate 回传模型） */
  private buildToolAttachments(imagePaths: readonly string[]): ChatAttachment[] {
    return imagePaths.map((path) => ({
      id: crypto.randomUUID(),
      type: 'image' as const,
      filename: path.split('/').pop() || path,
      mimeType: mimeFromPath(path),
      data: path,
    }));
  }

  /**
   * 把工具图片作为紧随 tool 消息的 synthetic user message 注入本轮上下文
   *（OpenAI 协议 tool 消息不支持图片）；模型不支持 vision 时跳过。
   */
  private async injectToolImagesIntoTurn(
    toolName: string,
    attachments: readonly ChatAttachment[],
    runtimeMessages: CottageModelMessage[],
  ): Promise<void> {
    if (!this.currentModelSupportsVision()) return;
    const imageParts: Array<{ type: 'image'; url: string; mediaType?: string }> = [];
    for (const att of attachments) {
      const url = await resolveAttachmentDataUrl(att);
      if (url) imageParts.push({ type: 'image', url, mediaType: att.mimeType });
    }
    if (!imageParts.length) return;
    runtimeMessages.push(
      {
        role: 'user',
        content: [
          { type: 'text', text: toolImagesNoteText(toolName, attachments) },
          ...imageParts,
        ],
      },
    );
  }

  private async buildRuntimeMessages() {
    const repaired = repairToolCallHistory(
      this.llmHistory.filter((m) => m.role !== 'system'),
    );
    // 路径态附件解析回 data URL；模型不支持 vision 时剔除图片避免 400
    const hydrated = await hydrateAttachmentsForLlm(
      repaired,
      this.currentModelSupportsVision(),
    );
    const withSystem: StoredMessage[] = [
      { role: 'system', content: this.systemPrompt },
      ...hydrated,
    ];
    return storedToRuntime(withSystem);
  }

  private async streamModel(
    messages: CottageModelMessage[],
    assistantMsg: CottageMessage,
    signal: AbortSignal,
  ): Promise<CottageAssistantResponse> {
    if (signal.aborted) {
      return { content: '' };
    }
    this.assertRuntimeCurrent();
    if (
      this.moonshotThinking &&
      supportsMoonshotThinking(this.modelConfig?.model ?? '')
    ) {
      beginAssistantThinkStreaming(assistantMsg);
      this.bumpSectionVersion();
    }
    this.setStatus({ phase: 'thinking' });
    const stream = await withLlmRetry(
      async () => this.model.stream({ messages, tools: this.tools }, signal),
      { ...this.retryOptions, signal },
    );
    const response: CottageAssistantResponse = { content: '', toolCalls: [] };
    const pendingToolInputs = new Map<string, { id: string; name: string; args: string }>();
    let sawEvent = false;
    let firstTextSeen = false;
    let firstToolArgsSeen = false;
    for await (const event of stream) {
      if (signal.aborted) break;
      sawEvent = true;
      if (event.type === 'text-delta') {
        if (!firstTextSeen) {
          firstTextSeen = true;
          this.setStatus({ phase: 'streaming' });
        }
        response.content += event.text;
        appendAssistantText(assistantMsg, event.text);
        this.bumpSectionVersion();
      }

      if (event.type === 'reasoning-delta') {
        response.reasoningContent = `${response.reasoningContent ?? ''}${event.text}`;
        setAssistantThink(assistantMsg, response.reasoningContent);
        this.bumpSectionVersion();
      }
      if (event.type === 'tool-input-start') {
        pendingToolInputs.set(event.id, { id: event.id, name: event.name, args: '' });
      }
      if (event.type === 'tool-input-delta') {
        const pending = pendingToolInputs.get(event.id) ?? {
          id: event.id,
          name: '',
          args: '',
        };
        pending.args += event.delta;
        pendingToolInputs.set(event.id, pending);
      }
      if (event.type === 'tool-call') {
        response.toolCalls?.push(event.call);
        pendingToolInputs.set(event.call.id, {
          id: event.call.id,
          name: event.call.name,
          args: JSON.stringify(event.call.args),
        });
      }
      const toolProgress =
        event.type === 'tool-input-start' ||
        event.type === 'tool-input-delta' ||
        event.type === 'tool-call'
          ? mergeToolCallChunks([...pendingToolInputs.values()])
          : [];
      if (
        toolProgress.length &&
        applyToolCallProgress(assistantMsg, toolProgress, {
          argsStreaming: event.type !== 'tool-call',
        })
      ) {
        if (!firstToolArgsSeen) {
          firstToolArgsSeen = true;
          // 正文流结束，收起已完成段的光标，避免工具轮次后多段正文各留一个闪烁方块
          sealAssistantTextStreaming(assistantMsg);
          const lead = toolProgress[toolProgress.length - 1];
          this.setStatus({
            phase: 'tool_args',
            toolName: lead.name || '工具',
          });
        }
        this.bumpSectionVersion();
      }

      if (event.type === 'finish') {
        response.finishReason = event.finishReason;
        response.rawFinishReason = event.rawFinishReason;
        response.usage = event.usage;
        response.metrics = event.metrics;
      } else if (event.type === 'error') {
        throw event.error;
      }
    }
    if (!sawEvent && !signal.aborted) {
      return await withLlmRetry(
        () => this.model.generate({ messages, tools: this.tools }, signal),
        { ...this.retryOptions, signal },
      );
    }
    return response;
  }
}

const toolCallFingerprint = (name: string, args: unknown): string =>
  `${name}:${JSON.stringify(args ?? {})}`;

/** 从文件写入工具的 args 中提取路径，用于 PatchApplied 事件 */
const parseWriteSnapshotPath = (args: unknown): string | null => {
  if (!args || typeof args !== 'object') return null;
  const obj = args as Record<string, unknown>;
  const path = obj.path ?? obj.filePath ?? obj.filepath;
  return typeof path === 'string' && path.trim() ? path : null;
};

export const mergeStoredWithSystem = (
  systemPrompt: string,
  history: readonly StoredMessage[],
): StoredMessage[] => {
  const { rest } = extractSystemPrompt(history);
  return [{ role: 'system', content: systemPrompt }, ...rest];
};

export const exportHistoryForSave = (
  agent: CottageAgent,
): StoredMessage[] => agent.getChatHistory();
