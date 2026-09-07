import { defineStore } from 'pinia';
import { ref, shallowRef, computed } from 'vue';
import { ElMessageBox, ElNotification } from 'element-plus';
import { i18n } from '../i18n';
import type { ChatSessionMeta, SearchSource } from '../config/constants';
import {
  chatSessionExists,
  createChatSession,
  deleteChatSession,
  deriveTitleFromHistory,
  ensureChatSessionListed,
  generateChatTitle,
  loadChatSessionsIndex,
  loadSessionHistory,
  loadSessionSnapshot,
  repairChatSessionsIndex,
  saveSessionHistory,
  sessionHasUserInput,
  setActiveChatSession,
  setChatSessionPinned,
  shouldRefineChatTitle,
  sortChatSessions,
} from '../config/chatSessions';
import { buildSessionRuntimeMeta } from '../config/sessionRuntime';
import { loadCottageConfigFromWorkspace, saveCottageConfigToWorkspace } from '../config/cottageStorage';
import type { OptionalToolGroupId } from '../agent/toolCatalog';
import {
  optionalToolGroupsFromNames,
  optionalToolNamesForGroups,
} from '../agent/toolCatalog';
import { getCottageConfig, getLlmConfig, configRevision, clearSessionActivePresetId } from '../config/store';
import { loadProviderSecrets, getSecretForProvider } from '../config/secrets';
import { getCachedProviderModels } from '../config/modelCatalog';
import { resolveCottageModelCapabilities } from '../config/modelCapabilities';
import { createTaskSignalState, type TaskSignalState } from '../task/taskSignals';
import type { CottageAgent } from '../agent/CottageAgent';
import { createCottageAgent } from '../agent/createCottageAgent';
import { prepareTokenCounter } from '../agent/tokenCounter';
import {
  dispatchSubtaskForeground,
  type SubtaskRunnerDeps,
  type DispatchSubtaskResult,
  buildSubtaskInjectionMessage,
} from '../task/subtask';
import { loadTaskState } from '../task/persistence';
import type { TaskToolSignals } from '../agent/taskToolSignals';
import { loadWorkspaceAgentPromptContext } from '../agent/workspaceSkills';
import {
  capabilitiesForAgent,
  resolvePackContext,
} from '../platform/packs/resolve';
import { resetAutoCheckpoint, getPendingMutatedPaths } from '../history/autoCheckpoint';
import { incrementalSymbolIndex } from '../domains/coding/indexer';
import { useWorkspaceStore } from './workspace';
import { useCottageServiceStore } from './cottageService';
import { Orchestrator } from '../orchestrator/Orchestrator';
import { loadOrchestration, listActiveOrchestrations } from '../orchestrator/persistence';
import { createAssistantMessage, type StoredMessage } from '../agent/messages';
import type { CottageSection } from '../agent/messages';
import type { CheckResult, VerifyReport } from '../platform/verify';
import type { OrchestrationState } from '../orchestrator/types';
import type { CottageAgentMode } from '../agent/createCottageAgent';
import type { SpecDoc } from '../spec/types';
import { workspace, formatWorkspaceFsError } from '../workspace/FileSystemWorkspace';
import { setActiveInteractionSession } from '../platform/interaction/interactionScope';
import {
  cancelPendingPlanApproval as cancelPendingExecutionPlanApproval,
  hasPendingPlanApprovalFor as hasPendingExecutionPlanApprovalFor,
} from '../platform/plan';
import type { PlanToolCallbacks } from '../plan/planTools';
import { buildPlanExecutionContext } from '../plan/executionContext';
import type {
  AcceptanceCriterion,
  PlanDefinition,
  PlanDraft,
  PlanEvent,
  PlanManifest,
  PlanRun,
  ToolMutationReport,
} from '../plan/types';
import {
  createPlanDefinition,
  createPlanRun,
  getVerificationRegistry,
  listActiveSessionPlans,
  listWorkspacePlans,
  loadPlanDefinition,
  nextReadyStep,
  refreshReadySteps,
  recoverStoredPlan,
  releasePlanWriter,
  resolvePendingPlanApproval,
  cancelPendingPlanApproval,
  getPendingPlanApproval,
  hasPendingPlanApprovalFor,
  restorePlanStepCheckpoint,
  previewPlanStepCheckpoint,
  runCriteria,
  planRepository,
  planRunner,
  workspaceWriteCoordinator,
  beginMutationJournal,
  endMutationJournal,
  abortMutationJournal,
  rebuildCheckpointObjectIndex,
  deletePlanStepCheckpoint,
  PlanUiController,
  PlanRepositoryError,
} from '../plan';
import {
  cancelPendingStagedApproval,
  hasPendingStagedApprovalFor,
} from '../platform/staging';
import {
  cancelPendingAsk,
  hasPendingAskFor,
} from '../agent/askUserTool';
import {
  cancelAllCallInteractionsForSession,
} from '../chat/callInteractionGate';
import { pendingInteractionCallIds } from '../agent/historyAdapter';

/** 挂载聊天实例的选项 */
interface MountChatOptions {
  taskId?: string;
}

/** 卸载聊天实例的选项 */
interface TeardownChatOptions {
  keepUi?: boolean;
  /** 强制彻底销毁当前实例（中断并从注册表移除）；缺省下 busy 实例后台保活 */
  force?: boolean;
}

/** 每会话运行时状态（供 UI 角标/提示） */
export interface SessionRuntimeStatus {
  busy: boolean;
  inFlight: boolean;
  updatedAt: number;
}

/** 重新加载密钥的选项 */
interface ReloadSecretsOptions {
  remount?: boolean;
  /** 与 remount 联用：原地热切换运行时配置，不 teardown / 不重载聊天列表 */
  hot?: boolean;
}

/**
 * Agent 状态管理。
 * 控制聊天实例的生命周期、会话管理、密钥加载、子任务分发、以及编排模式。
 */
export const useAgentStore = defineStore('agent', () => {
  const workspaceStore = useWorkspaceStore();

  const chat = shallowRef<CottageAgent | null>(null);
  const chatSessions = ref<ChatSessionMeta[]>([]);
  const activeChatId = ref<string | null>(null);
  const activeTaskId = ref<string | null>(null);
  const secretsVersion = ref(0);
  const enabledToolGroups = ref<OptionalToolGroupId[]>(
    optionalToolGroupsFromNames(getCottageConfig().enabledTools),
  );

  // ── 搜索三层来源（每会话选择） ──
  /** 当前会话选中的搜索来源；缺省按可用层自动回退 */
  const searchSource = ref<SearchSource | null>(
    getCottageConfig().webSearch?.source ?? null,
  );

  /** 当前会话真正可用的搜索层（原生 / 第三方 / cottage-service） */
  const availableSearchSources = computed<SearchSource[]>(() => {
    // 显式建立响应式依赖：配置变更、密钥变更、Cottage Service 连接/能力
    void configRevision.value;
    void secretsVersion.value;
    const svc = useCottageServiceStore();
    void svc.status;
    void svc.capabilities;
    void svc.useSearch;
    const sources: SearchSource[] = [];
    const llm = getLlmConfig();
    const modelMeta = llm
      ? getCachedProviderModels(llm.provider, true, llm.baseUrl)?.find(
          (model) => model.id === llm.model,
        )
      : null;
    if (llm && resolveCottageModelCapabilities(llm, modelMeta).nativeSearch) {
      sources.push('native');
    }
    const thirdPartyProvider = getCottageConfig().webSearch?.thirdPartyProvider;
    if (
      thirdPartyProvider &&
      getSecretForProvider(secretsRef.value, thirdPartyProvider)?.apiKey?.trim()
    ) {
      sources.push('thirdParty');
    }
    // 已连接且服务端具备 search 即可选；「经 Cottage Service 搜索」开关用于默认路由偏好，
    // 不再挡住来源列表（否则设置里显示已连接，输入框却提示未连接）。
    if (svc.isConnected() && svc.hasCapability('search')) {
      sources.push('cottageService');
    }
    return sources;
  });

  /** searchSource 落在可用列表内则用之，否则回退到首个可用层；全空则 null */
  const resolvedSearchSource = computed<SearchSource | null>(() => {
    const available = availableSearchSources.value;
    if (available.length === 0) return null;
    const current = searchSource.value;
    if (current && available.includes(current)) return current;
    return available[0];
  });

  const secretsRef = shallowRef<Awaited<ReturnType<typeof loadProviderSecrets>>>({});
  const enabledToolsRef = shallowRef<string[]>(getCottageConfig().enabledTools ?? []);
  const chatRef = shallowRef<CottageAgent | null>(null);
  const lastMountErrorRef = ref<string | null>(null);
  const chatMountingRef = ref(false);
  const activeChatIdRef = shallowRef<string | null>(null);
  const activeTaskIdRef = shallowRef<string | null>(null);
  const taskSignalsMapRef = shallowRef(new Map<string, TaskSignalState>());
  const chatMountGenRef = shallowRef(0);
  let workspaceInitGen = 0;
  const orchestratorRef = shallowRef<Orchestrator | null>(null);
  const activeOrchestrationIdRef = shallowRef<string | null>(null);

  // ── 统一 Plan Mode（公开） ──
  const planMode = ref(false);
  const activePlanIdRef = shallowRef<string | null>(null);
  const activePlanDefinitionRef = shallowRef<PlanDefinition | null>(null);
  const activePlanRunRef = shallowRef<PlanRun | null>(null);
  /** 模型只能建议；用户确认后才真正切换并起草。 */
  const pendingPlanSuggestionRef = shallowRef<{
    goal: string;
    reason?: string;
    sessionId: string;
  } | null>(null);
  const pendingPlanRevisionFeedbackRef = shallowRef<{
    planId: string;
    revision: number;
    feedback: string;
    sessionId: string;
  } | null>(null);
  let observedForeignPlanWriter = false;
  let pendingTakeoverRequest: { workspaceId: string; planId: string } | null = null;
  workspaceWriteCoordinator.subscribeTakeover((request) => {
    const lock = workspaceWriteCoordinator.currentState;
    if (
      lock.status !== 'held' ||
      lock.tabId !== workspaceWriteCoordinator.tabId ||
      lock.workspaceId !== request.workspaceId ||
      lock.planId !== request.planId
    ) return;
    pendingTakeoverRequest = {
      workspaceId: request.workspaceId,
      planId: request.planId,
    };
    ElNotification({
      title: '收到计划接管请求',
      message: '当前写入完成并提交后，计划会在安全边界暂停。',
      type: 'warning',
    });
  });
  workspaceWriteCoordinator.subscribe((state) => {
    if (
      state.status === 'held' &&
      state.tabId !== workspaceWriteCoordinator.tabId &&
      state.workspaceId === activePlanDefinitionRef.value?.workspaceId
    ) {
      observedForeignPlanWriter = true;
      return;
    }
    if (state.status === 'idle' && observedForeignPlanWriter) {
      observedForeignPlanWriter = false;
      const sessionId = activeChatIdRef.value;
      if (sessionId) {
        window.setTimeout(() => void recoverPlan(sessionId, true, false), 0);
      }
    }
    const active = activePlanDefinitionRef.value;
    if (
      state.status === 'idle' &&
      pendingTakeoverRequest &&
      active?.id === pendingTakeoverRequest.planId &&
      active.workspaceId === pendingTakeoverRequest.workspaceId
    ) {
      pendingTakeoverRequest = null;
      window.setTimeout(() => void pausePlan('另一标签页请求接管计划'), 0);
    }
  });

  // ── 多实例注册表：后台会话保持运行、可复用、独立落盘 ──
  interface AgentEntry {
    sessionId: string;
    agent: CottageAgent;
    persistTimer: ReturnType<typeof setTimeout> | null;
    onPersist: () => void;
  }
  const agents = new Map<string, AgentEntry>();

  /** 每会话运行时状态（响应式，供历史列表角标/提示读取） */
  const sessionRuntimeStatus = ref<Record<string, SessionRuntimeStatus>>({});

  /** 写入会话运行时状态（合并式） */
  function setSessionRuntime(
    sessionId: string,
    patch: Partial<Pick<SessionRuntimeStatus, 'busy' | 'inFlight'>>,
  ) {
    const prev = sessionRuntimeStatus.value[sessionId] ?? {
      busy: false,
      inFlight: false,
      updatedAt: 0,
    };
    sessionRuntimeStatus.value = {
      ...sessionRuntimeStatus.value,
      [sessionId]: { ...prev, ...patch, updatedAt: Date.now() },
    };
  }

  /** 清除会话运行时状态 */
  function clearSessionRuntime(sessionId: string) {
    if (!(sessionId in sessionRuntimeStatus.value)) return;
    const next = { ...sessionRuntimeStatus.value };
    delete next[sessionId];
    sessionRuntimeStatus.value = next;
  }

  /** 已启动过 AI 标题精简的会话，避免重复请求 */
  const titleRefineStarted = new Set<string>();

  /**
   * 先用用户首条输入写入标题并入列，长输入再后台用 AI 精简覆盖。
   * 已有非「新对话」标题时仅更新索引时间戳。
   */
  async function ensureSessionTitle(
    sessionId: string,
    history: readonly StoredMessage[],
  ) {
    const current = chatSessions.value.find((s) => s.id === sessionId);
    if (!current || current.title === '新对话') {
      const provisional = deriveTitleFromHistory(history);
      await ensureChatSessionListed(sessionId, { title: provisional });
      scheduleTitleRefine(sessionId, history);
    } else {
      await ensureChatSessionListed(sessionId);
      // 首条入列可能已用用户原文；若尚未精简且偏长，补一次后台 AI
      if (shouldRefineChatTitle(history)) {
        scheduleTitleRefine(sessionId, history);
      }
    }
  }

  /** 后台 AI 精简标题（仅启动一次） */
  function scheduleTitleRefine(
    sessionId: string,
    history: readonly StoredMessage[],
  ) {
    if (!shouldRefineChatTitle(history)) return;
    if (titleRefineStarted.has(sessionId)) return;
    titleRefineStarted.add(sessionId);
    void (async () => {
      try {
        const title = await generateChatTitle(history, secretsRef.value);
        if (title === '新对话') return;
        // 以磁盘索引为准，避免会话已删除后被写回
        const index = await loadChatSessionsIndex();
        const current = index.sessions.find((s) => s.id === sessionId);
        if (!current || title === current.title) return;
        await ensureChatSessionListed(sessionId, { title });
        await syncSessionsFromDisk();
      } catch {
        // 精简失败则保留用户原文标题
      }
    })();
  }

  /** 轻量中途落盘：flush 事件日志 + runtime/draft；若已有用户输入则纳入历史索引 */
  async function persistSessionDraft(sessionId: string) {
    const entry = agents.get(sessionId);
    const root = workspaceRoot();
    if (!entry || !root) return;
    const snapshot = entry.agent.getPersistableSnapshot();
    await entry.agent.persistEventLogArtifacts(
      buildSessionRuntimeMeta(entry.agent),
    );
    if (
      sessionHasUserInput(snapshot.history) &&
      !chatSessions.value.some((s) => s.id === sessionId)
    ) {
      await ensureSessionTitle(sessionId, snapshot.history);
      await syncSessionsFromDisk();
    }
  }

  /** 节流调度中途落盘（约 800ms 一次） */
  function schedulePersist(sessionId: string) {
    const entry = agents.get(sessionId);
    if (!entry || entry.persistTimer) return;
    entry.persistTimer = setTimeout(() => {
      entry.persistTimer = null;
      void persistSessionDraft(sessionId);
    }, 800);
  }

  /** 完整落盘指定会话（含标题生成与索引刷新） */
  async function persistSession(sessionId: string) {
    const entry = agents.get(sessionId);
    const root = workspaceRoot();
    if (!entry || !root) return;
    const snapshot = entry.agent.getPersistableSnapshot();
    const history = snapshot.history;
    if (!sessionHasUserInput(history)) {
      // 无用户输入：不计入历史记录
      return;
    }
    await entry.agent.persistEventLogArtifacts(
      buildSessionRuntimeMeta(entry.agent),
    );
    await ensureSessionTitle(sessionId, history);
    await syncSessionsFromDisk();
  }

  /** 创建指向特定会话的完成落盘回调（assistantComplete/rewind） */
  function makeOnPersist(sessionId: string) {
    return () => {
      const entry = agents.get(sessionId);
      if (entry) {
        setSessionRuntime(sessionId, {
          busy: entry.agent.busy,
          inFlight: entry.agent.isInFlight(),
        });
      }
      void persistSession(sessionId);
      const mutated = getPendingMutatedPaths();
      if (mutated.length > 0) {
        const coding = getCottageConfig().codingIndex;
        if (coding?.enabled !== false && coding?.autoOnMutate !== false) {
          void incrementalSymbolIndex(mutated).catch(() => { /* silent */ });
        }
      }
    };
  }

  /** 将实例注册进多实例表（已存在则直接返回） */
  function registerAgent(sessionId: string, agent: CottageAgent): AgentEntry {
    const existing = agents.get(sessionId);
    if (existing) return existing;
    const onPersist = makeOnPersist(sessionId);
    agent.watch('assistantComplete', onPersist);
    agent.watch('rewind', onPersist);
    agent.watch('assistantComplete', () => notifyBackgroundComplete(sessionId));
    // 延迟到事件分发结束后再切换模式（避免在监听器迭代中改工具表）
    agent.watch('assistantComplete', () => {
      setTimeout(() => {
        void maybeKickoffPendingPlan(sessionId);
        void maybeKickoffPendingPlanRevision(sessionId);
        // 仅供已在内存中的旧 Spec Agent 收口；新建/恢复会话不会再挂载该模式。
        void maybeContinuePlanAfterTurn(sessionId);
      }, 0);
    });
    const entry: AgentEntry = { sessionId, agent, persistTimer: null, onPersist };
    agents.set(sessionId, entry);
    return entry;
  }

  /** 后台（非当前活跃）会话完成一轮时弹出提示 */
  function notifyBackgroundComplete(sessionId: string) {
    if (sessionId === activeChatIdRef.value) return;
    const title =
      chatSessions.value.find((s) => s.id === sessionId)?.title ?? '新对话';
    ElNotification({
      title: i18n.global.t('chat.backgroundDoneTitle'),
      message: i18n.global.t('chat.backgroundDoneBody', { title }),
      type: 'success',
      duration: 4000,
    });
  }

  /** 会话是否仍有未完成的交互闸门或落盘 pending interaction */
  function sessionHasPendingInteraction(sessionId: string): boolean {
    const entry = agents.get(sessionId);
    if (entry && entry.agent.getPendingInteractionCalls().length > 0) return true;
    return (
      hasPendingExecutionPlanApprovalFor(sessionId) ||
      hasPendingPlanApprovalFor(sessionId) ||
      hasPendingStagedApprovalFor(sessionId) ||
      hasPendingAskFor(sessionId)
    );
  }

  /** 彻底销毁指定会话实例（可选中断 + 落盘）并从注册表移除 */
  async function teardownEntry(
    sessionId: string,
    options?: { abort?: boolean; save?: boolean },
  ) {
    const entry = agents.get(sessionId);
    if (!entry) return;
    if (options?.abort && entry.agent.busy) entry.agent.abort();
    // 销毁会话时清理其残留的交互闸门待处理项，避免 promise 泄漏与状态残留
    cancelPendingExecutionPlanApproval('会话已关闭', sessionId);
    cancelPendingPlanApproval(new Error('会话已关闭'), sessionId);
    cancelPendingStagedApproval('会话已关闭', sessionId);
    cancelPendingAsk('会话已关闭', sessionId);
    cancelAllCallInteractionsForSession(sessionId, '会话已关闭');
    entry.agent.unwatch('assistantComplete', entry.onPersist);
    entry.agent.unwatch('rewind', entry.onPersist);
    if (entry.persistTimer) {
      clearTimeout(entry.persistTimer);
      entry.persistTimer = null;
    }
    const root = workspaceRoot();
    if (options?.save !== false && root) {
      const history = entry.agent.getPersistableSnapshot().history;
      if (!sessionHasUserInput(history)) {
        // 无用户输入：不计入历史，销毁时直接删除会话文件
        await deleteChatSession(sessionId);
      } else {
        await entry.agent.persistEventLogArtifacts(
          buildSessionRuntimeMeta(entry.agent),
        );
        await ensureSessionTitle(sessionId, history);
      }
    }
    agents.delete(sessionId);
    clearSessionRuntime(sessionId);
    // 会话文件将删除时取消精简标记；保留会话则可让后台精简继续写回
    if (options?.save === false) {
      titleRefineStarted.delete(sessionId);
    }
  }

  /** 销毁所有会话实例（工作空间切换/关闭） */
  async function teardownAll(options?: { abort?: boolean }) {
    for (const sessionId of [...agents.keys()]) {
      await teardownEntry(sessionId, { abort: options?.abort ?? true });
    }
  }

  /** 触发工作空间刷新并重新选中当前文件 */
  async function mutateWorkspace() {
    await workspaceStore.refresh();
    if (workspaceStore.selectedPath) {
      await workspaceStore.selectFile(workspaceStore.selectedPath);
    }
  }

  /** 获取当前工作空间根名称 */
  const workspaceRoot = () => workspaceStore.snapshot?.rootName ?? null;

  /** 从磁盘同步会话列表 */
  async function syncSessionsFromDisk() {
    const index = await loadChatSessionsIndex();
    chatSessions.value = sortChatSessions(index.sessions);
    return index;
  }

  /** 持久化当前聊天会话到磁盘 */
  async function persistCurrentChat() {
    const instance = chatRef.value;
    const sessionId = activeChatIdRef.value;
    const root = workspaceRoot();
    if (!instance || !root || !sessionId) return;

    const snapshot = instance.getPersistableSnapshot();
    const history = snapshot.history;
    if (!sessionHasUserInput(history)) return;

    await instance.persistEventLogArtifacts(
      buildSessionRuntimeMeta(instance),
    );
    await ensureSessionTitle(sessionId, history);
    await syncSessionsFromDisk();
  }

  /** 持久化回调（聊天完成或回退时触发，同时触发 RAG 索引）——见 makeOnPersist（按会话绑定） */

  /** 获取指定任务的信号状态（懒初始化） */
  function getTaskSignals(taskId: string) {
    let signals = taskSignalsMapRef.value.get(taskId);
    if (!signals) {
      signals = createTaskSignalState();
      taskSignalsMapRef.value.set(taskId, signals);
    }
    return signals;
  }

  /** 构建子任务运行器的依赖对象 */
  function buildSubtaskRunnerDeps(parentTaskId: string): SubtaskRunnerDeps {
    return {
      parentTaskId,
      createSession: async (title) => {
        const meta = await createChatSession(title);
        return meta.id;
      },
      loadSessionHistory,
      saveSessionHistory,
      getParentChatSessionId: async () => {
        const state = await loadTaskState(parentTaskId);
        if (!state?.chatSessionId) {
          throw new Error('主任务会话不存在');
        }
        return state.chatSessionId;
      },
      onBackgroundSubtaskFinished: async (result: DispatchSubtaskResult, goal: string) => {
        await injectSubtaskResultToParent(parentTaskId, result, goal);
      },
      onTaskStateChange: () => {
        void notifyTaskStateChange(parentTaskId);
      },
      createSubtaskAgent: async (sessionId, taskId, signals: TaskToolSignals) => {
        const snapshot = await loadSessionSnapshot(sessionId);
        await prepareTokenCounter(getLlmConfig()?.model);
        const promptContext = await loadWorkspaceAgentPromptContext();
        const packContext = await resolvePackContext();
        const capabilities = capabilitiesForAgent(
          enabledToolsRef.value,
          packContext.packs,
        );
        return createCottageAgent({
          chat_history: snapshot.history,
          llm_history: snapshot.llmHistory,
          onWorkspaceMutate: () => { void mutateWorkspace(); },
          mode: 'task',
          taskId,
          taskSignals: signals,
          isSubtask: true,
          secrets: secretsRef.value,
          enabledTools: enabledToolsRef.value,
          workspaceSkills: promptContext.skills,
          projectInstructionsBlock: promptContext.projectInstructionsBlock,
          packPromptOverlays: packContext.promptOverlays,
          resolvedCapabilities: capabilities,
          cottageServiceClient: useCottageServiceStore().isConnected()
            ? useCottageServiceStore().getClient() ?? undefined
            : undefined,
          cottageServiceCapabilities: useCottageServiceStore().isConnected()
            ? [...useCottageServiceStore().routingCapabilities]
            : undefined,
          searchSource: resolvedSearchSource.value ?? undefined,
          thirdPartyProvider: getCottageConfig().webSearch?.thirdPartyProvider,
          cottageServiceEngine: getCottageConfig().webSearch?.engine,
          cottageServiceServerCapabilities: useCottageServiceStore().isConnected()
            ? [...useCottageServiceStore().capabilities]
            : undefined,
          sessionId,
        });
      },
    };
  }

  /** 将子任务结果注入父任务会话 */
  async function injectSubtaskResultToParent(
    parentTaskId: string,
    result: DispatchSubtaskResult,
    goal: string,
  ) {
    const sessionId = await loadTaskState(parentTaskId).then((s) => s?.chatSessionId);
    if (!sessionId) return;

    const content = buildSubtaskInjectionMessage(result, goal);
    const userText =
      result.status === 'completed'
        ? `后台子任务完成：${goal.slice(0, 40)}`
        : `后台子任务失败：${goal.slice(0, 40)}`;

    if (activeChatIdRef.value === sessionId && chatRef.value) {
      chatRef.value.appendSyntheticUserMessage(content, userText);
    } else {
      const { SessionEventLog, ensureMessageId } = await import('../session/eventLog');
      const log = new SessionEventLog(sessionId, { flushDelayMs: 0 });
      log.append({
        type: 'message',
        at: Date.now(),
        message: ensureMessageId({
          role: 'user',
          content,
          userText,
          synthetic: true,
        }),
      });
      await log.flush();
    }

    await notifyTaskStateChange(parentTaskId);
  }

  /** 通知任务状态变化（触发 UI 刷新） */
  async function notifyTaskStateChange(parentTaskId: string) {
    const { useTaskStore } = await import('./task');
    const taskStore = useTaskStore();
    taskStore.notifySubtaskUpdate(parentTaskId);
  }

  /** 运行子任务分发（前台模式） */
  async function runDispatchSubtask(
    parentTaskId: string,
    goal: string,
    options?: { background?: boolean; subtaskId?: string },
  ) {
    return dispatchSubtaskForeground(
      buildSubtaskRunnerDeps(parentTaskId),
      goal,
      options,
    );
  }

  /** 查找指定编排消息 */
  function findOrchestrationMessage(
    orchestrationId: string,
  ): ReturnType<typeof createAssistantMessage> | undefined {
    const instance = chatRef.value;
    if (!instance) return undefined;
    return instance.messages.find(
      (m) =>
        m.role === 'assistant' &&
        m.sections.some(
          (s) =>
            s.type === 'orchestration' &&
            s.orchestrationId === orchestrationId,
        ),
    );
  }

  /** 确保编排消息存在（不存在则创建） */
  function ensureOrchestrationMessage(state: OrchestrationState) {
    const instance = chatRef.value;
    if (!instance) return;

    const existing = findOrchestrationMessage(state.id);
    if (existing) return existing;

    const msg = createAssistantMessage();
    msg.sections.push({
      type: 'orchestration',
      orchestrationId: state.id,
      state,
    });
    instance.messages.push(msg);
    instance.forceUpdate();
    return msg;
  }

  /** 更新编排消息状态 */
  function updateOrchestrationMessage(state: OrchestrationState) {
    const instance = chatRef.value;
    if (!instance) return;

    const msg = findOrchestrationMessage(state.id);
    if (!msg) {
      ensureOrchestrationMessage(state);
      return;
    }

    const section = msg.sections.find(
      (s): s is Extract<typeof s, { type: 'orchestration' }> =>
        s.type === 'orchestration' && s.orchestrationId === state.id,
    );
    if (section) {
      section.state = state;
      instance.forceUpdate();
    }
  }

  /** 处理编排事件（更新消息、完成通知） */
  function handleOrchestrationEvent(event: {
    type: string;
    orchestrationId: string;
    stepId?: string;
    artifactId?: string;
  }) {
    const orchestrator = orchestratorRef.value;
    if (!orchestrator) return;
    updateOrchestrationMessage(orchestrator.state);

    if (event.type === 'finished') {
      const finalState = orchestrator.state;
      if (finalState.status === 'completed') {
        const summary = `编排任务已完成：${finalState.goal}`;
        const instance = chatRef.value;
        if (instance) {
          const msg = findOrchestrationMessage(finalState.id);
          if (msg) {
            msg.sections.push({ type: 'content', text: summary });
            instance.forceUpdate();
          }
        }
      }
      activeOrchestrationIdRef.value = null;
    }
  }

  /** 启动编排任务 */
  async function startOrchestration(
    goal: string,
    hint?: string,
  ): Promise<string> {
    if (!__COTTAGE_INCLUDE_HIDDEN_FEATURES__) {
      throw new Error('当前构建未包含编排模式');
    }
    const sessionId = activeChatIdRef.value;
    const root = workspaceRoot();
    if (!sessionId || !root) {
      throw new Error('没有活跃的聊天会话或工作空间');
    }

    if (orchestratorRef.value?.isRunning) {
      throw new Error('已有编排任务在运行');
    }

    const instance = chatRef.value;
    if (!instance) throw new Error('Agent 未就绪');

    const model = instance.getModel();
    const modelConfig = instance.getModelConfig();
    if (!modelConfig) throw new Error('模型配置未就绪');

    const fullGoal = hint ? `${goal}\n\n补充说明：${hint}` : goal;
    const promptContext = await loadWorkspaceAgentPromptContext();

    const orchestrator = new Orchestrator({
      orchestrationId: crypto.randomUUID(),
      chatSessionId: sessionId,
      goal: fullGoal,
      model,
      tools: [],
      modelConfig,
      secrets: secretsRef.value,
      enabledTools: enabledToolsRef.value,
      workspaceSkills: promptContext.skills,
      projectInstructionsBlock: promptContext.projectInstructionsBlock,
      onWorkspaceMutate: () => {
        void mutateWorkspace();
      },
      onEvent: handleOrchestrationEvent,
    });

    orchestratorRef.value = orchestrator;
    activeOrchestrationIdRef.value = orchestrator.id;

    ensureOrchestrationMessage(orchestrator.state);

    // 非阻塞启动；startOrchestration 工具会立即返回，编排器在后台运行
    void orchestrator.start().then(async () => {
      await persistCurrentChat();
    });

    return orchestrator.id;
  }

  /** 恢复未完成的编排任务（会话恢复时调用） */
  async function recoverOrchestration(sessionId: string) {
    if (!__COTTAGE_INCLUDE_HIDDEN_FEATURES__) return;
    const states = (await listActiveOrchestrations()).filter(
      (s) =>
        s.chatSessionId === sessionId &&
        s.status !== 'completed' &&
        s.status !== 'failed',
    );
    if (states.length === 0) return;

    const state = states[0];
    const serialized = await loadOrchestration(state.id);
    if (!serialized) return;

    const instance = chatRef.value;
    if (!instance) return;

    const model = instance.getModel();
    const modelConfig = instance.getModelConfig();
    if (!modelConfig) return;

    const promptContext = await loadWorkspaceAgentPromptContext();

    const orchestrator = new Orchestrator({
      orchestrationId: state.id,
      chatSessionId: sessionId,
      goal: state.goal,
      model,
      tools: [],
      modelConfig,
      secrets: secretsRef.value,
      enabledTools: enabledToolsRef.value,
      workspaceSkills: promptContext.skills,
      projectInstructionsBlock: promptContext.projectInstructionsBlock,
      onWorkspaceMutate: () => {
        void mutateWorkspace();
      },
      onEvent: handleOrchestrationEvent,
    });
    orchestrator.importState(serialized.state, serialized.artifacts);

    orchestratorRef.value = orchestrator;
    activeOrchestrationIdRef.value = orchestrator.id;
    ensureOrchestrationMessage(orchestrator.state);
  }

  /** 暂停当前编排任务 */
  function pauseOrchestration() {
    orchestratorRef.value?.pause();
  }

  /**
   * 切换活跃会话前分离当前编排器：暂停并清空全局 orchestratorRef，
   * 避免后台会话的编排器事件写入错误会话（handleOrchestrationEvent 读取全局
   * orchestratorRef/chatRef）。目标会话若有未完成编排，由 recoverOrchestration
   * 从磁盘持久化状态重建。
   */
  function detachActiveOrchestrator() {
    if (!orchestratorRef.value) return;
    orchestratorRef.value.pause();
    orchestratorRef.value = null;
    activeOrchestrationIdRef.value = null;
  }

  /** 恢复当前编排任务 */
  function resumeOrchestration() {
    const orchestrator = orchestratorRef.value;
    if (!orchestrator) return;
    void orchestrator.resume();
  }

  /** 批准当前编排计划并开始执行 */
  function approveOrchestrationPlan() {
    const orchestrator = orchestratorRef.value;
    if (!orchestrator) return;
    void orchestrator.approvePlan().then(async () => {
      await persistCurrentChat();
    });
  }

  /** 取消当前编排任务 */
  function cancelOrchestration() {
    orchestratorRef.value?.cancel();
  }

  /** 回答编排任务的人工介入问题 */
  function answerOrchestrationHuman(answer: string) {
    orchestratorRef.value?.answerHuman(answer);
  }

  // ────────────────────── 统一 Plan Mode ──────────────────────

  function findPlanSection(
    planId: string,
  ): Extract<CottageSection, { type: 'plan' }> | undefined {
    const instance = chatRef.value;
    if (!instance) return undefined;
    for (const message of instance.messages) {
      const section = message.sections.find(
        (item): item is Extract<CottageSection, { type: 'plan' }> =>
          item.type === 'plan' && item.planId === planId,
      );
      if (section) return section;
    }
    return undefined;
  }

  function getActivePlanContext(): {
    definition: PlanDefinition;
    run: PlanRun;
  } | null {
    const definition = activePlanDefinitionRef.value;
    const run = activePlanRunRef.value;
    if (!definition || !run || definition.id !== run.planId) return null;
    return { definition, run };
  }

  function selectSingleActivePlan(
    plans: Awaited<ReturnType<typeof listActiveSessionPlans>>,
    notifyConflict = true,
  ): boolean {
    if (plans.length > 1) {
      if (notifyConflict) {
        ElNotification({
          title: '发现多个活动计划',
          message: '为避免静默选择错误计划，已停止自动恢复。请从计划中心明确打开一个计划。',
          type: 'warning',
          duration: 0,
        });
      }
      return false;
    }
    const stored = plans[0];
    if (!stored) return false;
    planMode.value = true;
    activePlanIdRef.value = stored.definition.id;
    activePlanDefinitionRef.value = stored.definition;
    activePlanRunRef.value = stored.run;
    return true;
  }

  function syncPlanSection(definition: PlanDefinition, run: PlanRun) {
    const instance = chatRef.value;
    if (!instance) return;
    const existing = findPlanSection(definition.id);
    if (existing) {
      existing.definition = definition;
      existing.run = run;
    } else {
      const message = createAssistantMessage();
      message.sections.push({
        type: 'plan',
        planId: definition.id,
        definition,
        run,
      });
      instance.messages.push(message);
    }
    instance.forceUpdate();
  }

  async function commitPlan(
    definition: PlanDefinition,
    run: PlanRun,
    event?: PlanEvent,
    manifest?: PlanManifest,
  ) {
    if (run.repositoryCorrupt) {
      throw new Error('计划提交链损坏，已进入 recovery_required；修复 head/commit 前不能继续执行');
    }
    const controller = new PlanUiController(planRepository, {
      project: (committedDefinition, committedRun) => {
        activePlanIdRef.value = committedDefinition.id;
        activePlanDefinitionRef.value = committedDefinition;
        activePlanRunRef.value = committedRun;
        syncPlanSection(committedDefinition, committedRun);
      },
      persistChat: persistCurrentChat,
    });
    let committedRun: PlanRun;
    try {
      committedRun = await controller.commit(
        definition,
        run,
        event ?? {
          type: 'state_updated',
          at: Date.now(),
          revision: definition.revision,
        },
        manifest,
      );
    } catch (error) {
      if (error instanceof PlanRepositoryError && error.detail.actualCommitId) {
        const latest = await planRepository.load(definition.id);
        if (latest) {
          activePlanIdRef.value = latest.definition.id;
          activePlanDefinitionRef.value = latest.definition;
          activePlanRunRef.value = latest.run;
          syncPlanSection(latest.definition, latest.run);
          await persistCurrentChat();
        }
      }
      throw error;
    }
    Object.assign(run, {
      commitId: committedRun.commitId,
      recentEvents: committedRun.recentEvents,
      updatedAt: committedRun.updatedAt,
    });
  }

  const ensureCurrentPlanStep = (definition: PlanDefinition, run: PlanRun): PlanRun => {
    if (run.currentStepId && run.stepStates[run.currentStepId]?.status === 'running') {
      return run;
    }
    const ready = nextReadyStep(definition, run);
    if (!ready) return { ...run, currentStepId: undefined, updatedAt: Date.now() };
    return planRunner.startStep(definition, run, ready.id).run;
  };

  async function registerPlanDraft(
    draft: PlanDraft,
    sessionId: string,
  ): Promise<{ definition: PlanDefinition; run: PlanRun }> {
    const activeContext = getActivePlanContext();
    if (
      !draft.planId &&
      activeContext &&
      !['completed', 'failed', 'cancelled'].includes(activeContext.run.status)
    ) {
      throw new Error(
        `当前聊天已有活动计划 ${activeContext.definition.id}。` +
          '修订时必须提交 planId 与 baseRevision；如要新建请先取消当前计划。',
      );
    }
    const previous =
      draft.planId && activePlanDefinitionRef.value?.id === draft.planId
        ? activePlanDefinitionRef.value
        : null;
    if (
      previous &&
      draft.baseRevision !== undefined &&
      draft.baseRevision !== previous.revision
    ) {
      throw new Error(
        `计划版本冲突：当前为 revision ${previous.revision}，提交基于 ${draft.baseRevision}`,
      );
    }
    const definition = createPlanDefinition(draft, {
      sessionId,
      workspaceId: workspaceStore.activeWorkspaceId ?? workspace.rootName ?? 'workspace',
      capabilities: getVerificationRegistry().capabilities(),
      previous,
    });
    const verificationRegistry = getVerificationRegistry();
    for (const criterion of [
      ...definition.steps.flatMap((step) => step.acceptance),
      ...definition.finalAcceptance,
    ]) {
      const validation = verificationRegistry.validate(criterion);
      if (!validation.valid) {
        throw new Error(
          `验收项「${criterion.description}」无效：${validation.reason ?? '配置不受支持'}。` +
            '请改用当前已注册的浏览器验证器或 user.acceptance。',
        );
      }
    }
    const previousRun = activePlanRunRef.value;
    const transition = planRunner.submitRevision(
      definition,
      previous,
      previousRun,
      draft.preserveStepIds,
    );
    const run = transition.run;
    await commitPlan(definition, run, transition.event);
    if (previous) releasePlanWriter(definition.id);
    return { definition, run };
  }

  async function approvePlanRevision(planId: string, revision: number): Promise<PlanRun> {
    const current = getActivePlanContext();
    const definition =
      current?.definition.id === planId && current.definition.revision === revision
        ? current.definition
        : await loadPlanDefinition(planId, revision);
    if (!definition) throw new Error('找不到待批准的计划版本');
    const baseRun = current?.run ?? createPlanRun(definition);
    let run = planRunner.approveRevision(definition, baseRun).run;
    const first = nextReadyStep(definition, run);
    if (first) run = planRunner.startStep(definition, run, first.id).run;
    await commitPlan(definition, run, {
      type: 'approved',
      at: Date.now(),
      revision,
      stepId: run.currentStepId,
    });
    return run;
  }

  async function startPlanStep(stepId: string): Promise<PlanRun> {
    const context = getActivePlanContext();
    if (!context) throw new Error('当前没有活动计划');
    const state = context.run.stepStates[stepId];
    if (!state || (state.status !== 'ready' && state.status !== 'blocked')) {
      throw new Error(`步骤 ${stepId} 尚未就绪`);
    }
    const readyRun = state.status === 'blocked'
      ? {
          ...context.run,
          stepStates: {
            ...context.run.stepStates,
            [stepId]: { ...state, status: 'ready' as const },
          },
        }
      : context.run;
    const run = planRunner.startStep(context.definition, readyRun, stepId).run;
    await commitPlan(context.definition, run, {
      type: 'step_started',
      at: Date.now(),
      revision: run.approvedRevision,
      stepId,
    });
    return run;
  }

  const requiredCheckFailed = (
    criteria: readonly AcceptanceCriterion[],
    results: readonly CheckResult[],
  ) => {
    const required = new Set(criteria.filter((item) => item.required).map((item) => item.id));
    return results.some(
      (result) =>
        required.has(result.id) &&
        (result.status === 'failed' || result.status === 'unavailable'),
    );
  };

  async function completePlanStep(input: {
    stepId: string;
    summary: string;
    changedFiles?: string[];
  }): Promise<PlanRun> {
    const context = getActivePlanContext();
    if (!context) throw new Error('当前没有活动计划');
    const step = context.definition.steps.find((item) => item.id === input.stepId);
    const state = context.run.stepStates[input.stepId];
    if (!step || !state || state.status !== 'running') {
      throw new Error(`步骤 ${input.stepId} 不是当前执行步骤`);
    }
    if (context.run.currentStepId !== input.stepId) {
      throw new Error(`步骤 ${input.stepId} 与当前步骤不一致`);
    }
    const actualChangedFiles = [...state.changedFiles];
    const verifyingRun: PlanRun = {
      ...context.run,
      status: 'verifying',
      pendingReason: `正在验证步骤「${step.title}」`,
      updatedAt: Date.now(),
    };
    await commitPlan(context.definition, verifyingRun, {
      type: 'step_verifying',
      at: Date.now(),
      stepId: step.id,
    });
    const results = await runCriteria(step.acceptance, {
      signal: undefined,
      capabilitySnapshot: context.definition.verificationCapabilitySnapshot,
      allowedPathPrefixes:
        step.allowedPathPrefixes?.length
          ? step.allowedPathPrefixes
          : context.definition.allowedPathPrefixes,
    });
    const transition = planRunner.completeStep(
      context.definition,
      verifyingRun,
      step.id,
      results,
      actualChangedFiles,
      step.acceptance.filter((criterion) => criterion.required).map((criterion) => criterion.id),
    );
    if (transition.run.status === 'paused') {
      await commitPlan(context.definition, transition.run, transition.event);
      releasePlanWriter(context.definition.id);
      return transition.run;
    }
    const completedState = transition.run.stepStates[step.id]!;
    let run: PlanRun = {
      ...transition.run,
      stepStates: {
        ...transition.run.stepStates,
        [step.id]: {
          ...completedState,
          evidence: [
            ...completedState.evidence,
            {
              id: crypto.randomUUID(),
              kind: 'summary' as const,
              summary: input.summary,
              at: Date.now(),
            },
            ...state.changedFiles.map((path) => ({
              id: crypto.randomUUID(),
              kind: 'file' as const,
              summary: `已通过范围闸门记录写入：${path}`,
              path,
              at: Date.now(),
            })),
          ],
        },
      },
    };
    run = ensureCurrentPlanStep(context.definition, run);
    await commitPlan(context.definition, run, {
      ...transition.event,
      detail: {
        verificationState: completedState.verificationState,
        nextStepId: run.currentStepId,
      },
    });
    return run;
  }

  async function blockPlanStep(stepId: string, reason: string): Promise<PlanRun> {
    const context = getActivePlanContext();
    if (!context) throw new Error('当前没有活动计划');
    const state = context.run.stepStates[stepId];
    if (!state) throw new Error(`步骤不存在：${stepId}`);
    const transition = planRunner.blockStep(
      context.definition,
      context.run,
      stepId,
      reason,
    );
    const run = { ...transition.run, status: 'paused' as const };
    await commitPlan(context.definition, run, transition.event);
    releasePlanWriter(context.definition.id);
    return run;
  }

  async function requestPlanRevision(reason: string): Promise<PlanRun> {
    const context = getActivePlanContext();
    if (!context) throw new Error('当前没有活动计划');
    const transition = planRunner.requestRevision(
      context.run,
      `需要修订计划：${reason}`,
    );
    const run = transition.run;
    await commitPlan(context.definition, run, transition.event);
    releasePlanWriter(context.definition.id);
    return run;
  }

  const buildVerifyReport = (
    results: CheckResult[],
    manifestPathCount: number,
    requiredCriterionIds: readonly string[],
  ): VerifyReport => {
    const required = new Set(requiredCriterionIds);
    const decisive = results.filter((result) => required.has(result.id));
    const failed = decisive.filter((result) => result.status === 'failed');
    const unverified = decisive.filter(
      (result) => result.status === 'unavailable' || result.status === 'manual',
    );
    const hasMachineVerification = decisive.some(
      (result) => result.assurance === 'functional',
    );
    const verdict: VerifyReport['verdict'] = failed.length
      ? 'fail'
      : !decisive.length || unverified.length || !hasMachineVerification
        ? 'unverified'
        : 'pass';
    const uncovered = [
      ...failed,
      ...unverified,
      ...(!failed.length && !unverified.length && decisive.length && !hasMachineVerification
        ? [{ description: '当前只有浏览器结构检查，仍需人工验收' }]
        : []),
    ].map((result) => result.description ?? '未覆盖项');
    return {
      verdict,
      checks: results,
      uncovered,
      reason:
        verdict === 'pass'
          ? undefined
          : verdict === 'fail'
            ? `有 ${failed.length} 项验证失败`
            : '仍有当前浏览器无法机器验证或需要人工验收的项目',
      runAt: Date.now(),
      manifestPathCount,
      acceptanceFileCount: 0,
      scriptRan: results.some((result) => result.providerId === 'browser.worker'),
    };
  };

  async function completePlanRun(summary: string): Promise<PlanRun> {
    const context = getActivePlanContext();
    if (!context) throw new Error('当前没有活动计划');
    const incomplete = context.definition.steps.filter(
      (step) =>
        step.skippable
          ? !['completed', 'skipped'].includes(context.run.stepStates[step.id]?.status)
          : context.run.stepStates[step.id]?.status !== 'completed',
    );
    if (incomplete.length) {
      const run: PlanRun = {
        ...context.run,
        status: 'paused',
        pendingReason: `仍有未完成步骤：${incomplete.map((step) => step.title).join('、')}`,
        updatedAt: Date.now(),
      };
      await commitPlan(context.definition, run);
      releasePlanWriter(context.definition.id);
      return run;
    }
    const mutationReports = Object.values(context.run.stepStates).flatMap(
      (state) => state.mutationReports ?? [],
    );
    const manifestByPath = new Map<string, ToolMutationReport['created'][number]>();
    for (const report of mutationReports) {
      for (const entry of [...report.created, ...report.modified]) {
        if (entry.kind === 'file') manifestByPath.set(entry.path, entry);
      }
      for (const entry of report.deleted) manifestByPath.delete(entry.path);
      for (const moved of report.moved) {
        manifestByPath.delete(moved.from.path);
        if (moved.to.kind === 'file') manifestByPath.set(moved.to.path, moved.to);
      }
    }
    const manifestEntries = [...manifestByPath.values()];
    const manifest = {
      planId: context.definition.id,
      revision: context.definition.revision,
      paths: manifestEntries.length
        ? [...new Set(manifestEntries.map((entry) => entry.path))]
        : [...context.run.changedFiles],
      entries: manifestEntries,
      mutationReports,
      generatedAt: Date.now(),
    };
    const verifyingRun: PlanRun = {
      ...context.run,
      status: 'verifying',
      pendingReason: '正在汇总最终验证',
      updatedAt: Date.now(),
    };
    await commitPlan(context.definition, verifyingRun, {
      type: 'final_verifying',
      at: Date.now(),
    });
    const results = await runCriteria(context.definition.finalAcceptance, {
      manifest,
      capabilitySnapshot: context.definition.verificationCapabilitySnapshot,
      allowedPathPrefixes: context.definition.allowedPathPrefixes,
    });
    const requiredFinalCriterionIds = context.definition.finalAcceptance
      .filter((criterion) => criterion.required)
      .map((criterion) => criterion.id);
    const report = buildVerifyReport(
      results,
      manifest.paths.length,
      requiredFinalCriterionIds,
    );
    const requiredFinal = new Set(requiredFinalCriterionIds);
    const hasFunctionalFinal = results.some(
      (result) =>
        requiredFinal.has(result.id) &&
        result.assurance === 'functional' &&
        (result.status === 'passed' || result.pass),
    );
    const hasHumanCriterion = [
      ...context.definition.steps.flatMap((step) => step.acceptance),
      ...context.definition.finalAcceptance,
    ].some((criterion) => criterion.providerId === 'user.acceptance');
    const requiredFailed = requiredCheckFailed(
      context.definition.finalAcceptance,
      results,
    );
    const transition = planRunner.verifyRun(
      context.definition,
      verifyingRun,
      report,
      hasFunctionalFinal,
      requiredFailed,
    );
    const status = transition.run.status;
    const run: PlanRun = {
      ...transition.run,
      pendingReason:
        status === 'completed'
          ? undefined
          : status === 'paused'
            ? report.reason
            : '实现已结束，但仍有未机器验证项，需要用户验收',
      updatedAt: Date.now(),
    };
    await commitPlan(context.definition, run, {
      ...transition.event,
      detail: { summary, verdict: report.verdict, hasHumanCriterion },
    }, manifest);
    if (status !== 'running') releasePlanWriter(context.definition.id);
    return run;
  }

  async function failPlanRun(reason: string): Promise<PlanRun> {
    const context = getActivePlanContext();
    if (!context) throw new Error('当前没有活动计划');
    const run: PlanRun = {
      ...context.run,
      status: 'failed',
      pendingReason: reason,
      updatedAt: Date.now(),
    };
    await commitPlan(context.definition, run, {
      type: 'failed',
      at: Date.now(),
      detail: { reason },
    });
    releasePlanWriter(context.definition.id);
    return run;
  }

  async function handlePlanGuardBlocked(reason: string) {
    const context = getActivePlanContext();
    if (!context || context.run.status === 'awaiting_approval') return;
    const run: PlanRun = {
      ...context.run,
      status: 'waiting_for_user',
      pendingReason: reason,
      updatedAt: Date.now(),
    };
    await commitPlan(context.definition, run, {
      type: 'scope_blocked',
      at: Date.now(),
      stepId: run.currentStepId,
      detail: { reason },
    });
    releasePlanWriter(context.definition.id);
  }

  async function recordPlanGuardMutation(
    report: ToolMutationReport,
    risk: 'read' | 'write' | 'external' | 'destructive' | 'control',
    predictedPaths: string[],
  ) {
    const context = getActivePlanContext();
    if (!context) return;
    const stepId = context.run.currentStepId;
    const state = stepId ? context.run.stepStates[stepId] : undefined;
    if (!stepId || !state) throw new Error('计划写入缺少当前运行步骤');
    const transition = planRunner.recordMutation(
      context.definition,
      context.run,
      stepId,
      report,
    );
    const changedFiles = transition.run.changedFiles;
    const changedFileBudgetExceeded =
      changedFiles.length > context.definition.budgets.maxChangedFiles;
    const yieldForTakeover =
      pendingTakeoverRequest?.planId === context.definition.id &&
      pendingTakeoverRequest.workspaceId === context.definition.workspaceId;
    if (yieldForTakeover) pendingTakeoverRequest = null;
    const run: PlanRun = {
      ...transition.run,
      status: changedFileBudgetExceeded || yieldForTakeover
        ? 'paused'
        : context.run.status,
      pendingReason: changedFileBudgetExceeded
        ? `实际修改文件数超过预算 ${context.definition.budgets.maxChangedFiles}，已保留现场并暂停`
        : yieldForTakeover
          ? '另一标签页请求接管计划；当前变更已提交并在安全边界暂停'
          : context.run.pendingReason,
      changedFiles,
      counters: {
        ...transition.run.counters,
        changedFiles: changedFiles.length,
        externalCalls: transition.run.counters.externalCalls,
      },
      updatedAt: Date.now(),
    };
    await commitPlan(context.definition, run, {
      ...transition.event,
      type: yieldForTakeover ? 'takeover_yielded' : transition.event.type,
      detail: { report, predictedPaths, risk },
    });
  }

  async function recordPlanGuardExternalCall(succeeded: boolean) {
    const context = getActivePlanContext();
    if (!context || context.run.status !== 'running') return;
    const externalCalls = context.run.counters.externalCalls + 1;
    const run: PlanRun = {
      ...context.run,
      counters: { ...context.run.counters, externalCalls },
      updatedAt: Date.now(),
    };
    await commitPlan(context.definition, run, {
      type: 'external_call_recorded',
      at: Date.now(),
      stepId: run.currentStepId,
      detail: { succeeded, externalCalls },
    });
  }

  async function runPlanResearch(
    questions: string[],
  ): Promise<Array<{ question: string; summary: string }>> {
    const context = getActivePlanContext();
    const stepId = context?.run.currentStepId;
    const step = context?.definition.steps.find((item) => item.id === stepId);
    if (!context || !stepId || !step) throw new Error('当前没有活动计划步骤');
    if (step.kind !== 'research' && step.kind !== 'verification') {
      throw new Error('只有研究或验证步骤可以派生只读研究执行器');
    }
    const promptContext = await loadWorkspaceAgentPromptContext().catch(() => ({
      skills: [],
      projectInstructionsBlock: '',
    }));
    const packContext = await resolvePackContext();
    const capabilities = capabilitiesForAgent(enabledToolsRef.value, packContext.packs);

    const results = await Promise.all(
      questions.slice(0, 3).map(async (question) => {
        const child = createCottageAgent({
          mode: 'chat',
          readOnly: true,
          secrets: secretsRef.value,
          enabledTools: enabledToolsRef.value,
          workspaceSkills: promptContext.skills,
          projectInstructionsBlock: promptContext.projectInstructionsBlock,
          packPromptOverlays: packContext.promptOverlays,
          resolvedCapabilities: capabilities,
        });
        await child.next(
          `你是计划步骤的临时只读研究执行器。只使用已提供的读取工具回答问题，` +
            `不能写入、联网、询问用户或派生其他执行器。请给出结论、依据文件路径和不确定项。\n\n问题：${question}`,
        );
        const last = [...child.messages].reverse().find((message) => message.role === 'assistant');
        const summary = last?.sections
          .filter((section): section is Extract<CottageSection, { type: 'content' }> => section.type === 'content')
          .map((section) => section.text)
          .join('\n')
          .trim() || '只读研究未产生可用结论';
        return { question, summary };
      }),
    );

    const latest = getActivePlanContext();
    if (latest?.run.currentStepId === stepId) {
      const state = latest.run.stepStates[stepId]!;
      const run: PlanRun = {
        ...latest.run,
        stepStates: {
          ...latest.run.stepStates,
          [stepId]: {
            ...state,
            evidence: [
              ...state.evidence,
              ...results.map((result) => ({
                id: crypto.randomUUID(),
                kind: 'summary' as const,
                summary: `只读研究：${result.question}\n${result.summary}`,
                at: Date.now(),
              })),
            ],
          },
        },
        updatedAt: Date.now(),
      };
      await commitPlan(latest.definition, run, {
        type: 'research_completed',
        at: Date.now(),
        stepId,
        detail: { count: results.length },
      });
    }
    return results;
  }

  function buildPlanCallbacks(sessionId: string): PlanToolCallbacks {
    return {
      registerPlan: (draft) => registerPlanDraft(draft, sessionId),
      approvePlan: approvePlanRevision,
      startStep: startPlanStep,
      completeStep: completePlanStep,
      blockStep: blockPlanStep,
      requestRevision: requestPlanRevision,
      completeRun: completePlanRun,
      failRun: failPlanRun,
      runResearch: runPlanResearch,
      getActivePlan: getActivePlanContext,
      onGuardBlocked: handlePlanGuardBlocked,
      onGuardMutation: recordPlanGuardMutation,
      onGuardExternalCall: recordPlanGuardExternalCall,
    };
  }

  async function setChatMode(mode: 'chat' | 'plan') {
    const enabled = mode === 'plan';
    if (planMode.value === enabled) return;
    const instance = chatRef.value;
    if (!instance || instance.getAgentMode() === 'task' || instance.busy) return;
    const sessionId = activeChatIdRef.value;
    if (!sessionId) return;
    if (enabled && hasPendingStagedApprovalFor(sessionId)) {
      throw new Error('请先处理当前回合的暂存审阅，再进入计划模式');
    }
    if (!enabled) {
      const context = getActivePlanContext();
      if (context && !['completed', 'failed', 'cancelled'].includes(context.run.status)) {
        const run: PlanRun = {
          ...context.run,
          status: 'paused',
          pendingReason: '用户切换到对话模式，计划已暂停',
          updatedAt: Date.now(),
        };
        await commitPlan(context.definition, run, {
          type: 'paused_for_chat_mode',
          at: Date.now(),
        });
        releasePlanWriter(context.definition.id);
      }
    }
    planMode.value = enabled;
    try {
      await applyMountedChatRuntime();
    } catch (error) {
      planMode.value = !enabled;
      throw error;
    }
    schedulePersist(sessionId);
  }

  async function approvePlan() {
    const sessionId = activeChatIdRef.value;
    if (resolvePendingPlanApproval('approved', sessionId)) return;
    const context = getActivePlanContext();
    if (!context || context.run.status !== 'awaiting_approval') return;
    await approvePlanRevision(context.definition.id, context.definition.revision);
    await continuePlan();
  }

  async function savePlanEdits(planId: string, draft: PlanDraft) {
    const context = getActivePlanContext();
    if (!context || context.definition.id !== planId) return;
    if (!['awaiting_approval', 'paused', 'waiting_for_user'].includes(context.run.status)) {
      throw new Error('执行中的计划需要先暂停才能修订');
    }
    resolvePendingPlanApproval('adjust', activeChatIdRef.value);
    await registerPlanDraft(
      {
        ...draft,
        planId,
        baseRevision: context.definition.revision,
      },
      context.definition.sessionId,
    );
  }

  async function adjustPlan() {
    const sessionId = activeChatIdRef.value;
    if (resolvePendingPlanApproval('adjust', sessionId)) return;
    const context = getActivePlanContext();
    if (!context) return;
    const transition = planRunner.requestRevision(context.run, '用户要求调整计划');
    await commitPlan(context.definition, transition.run, transition.event);
    releasePlanWriter(context.definition.id);
  }

  async function requestPlanChanges(feedback: string) {
    const text = feedback.trim();
    const sessionId = activeChatIdRef.value;
    const context = getActivePlanContext();
    if (!text || !sessionId || !context) return;
    if (!['awaiting_approval', 'paused', 'waiting_for_user'].includes(context.run.status)) {
      throw new Error('请先暂停正在执行的计划，再要求修改');
    }
    pendingPlanRevisionFeedbackRef.value = {
      planId: context.definition.id,
      revision: context.definition.revision,
      feedback: text,
      sessionId,
    };
    try {
      const resolved = resolvePendingPlanApproval('adjust', sessionId, text);
      if (!resolved) {
        const transition = planRunner.requestRevision(
          context.run,
          `用户要求修改计划：${text}`,
        );
        await commitPlan(context.definition, transition.run, {
          ...transition.event,
          detail: { feedback: text },
        });
        releasePlanWriter(context.definition.id);
      }
      await maybeKickoffPendingPlanRevision(sessionId);
    } catch (error) {
      pendingPlanRevisionFeedbackRef.value = null;
      throw error;
    }
  }

  async function cancelPlan() {
    const sessionId = activeChatIdRef.value;
    pendingPlanRevisionFeedbackRef.value = null;
    const resolvedApproval = resolvePendingPlanApproval('cancel', sessionId);
    if (!resolvedApproval && chatRef.value?.busy) chatRef.value.abort();
    const context = getActivePlanContext();
    if (!context) return;
    const transition = planRunner.cancelRun(context.run);
    await commitPlan(context.definition, transition.run, transition.event);
    releasePlanWriter(context.definition.id);
  }

  async function pausePlan(reason = '用户暂停了计划') {
    if (chatRef.value?.busy) chatRef.value.abort();
    const context = getActivePlanContext();
    if (!context || context.run.status === 'completed') return;
    const run: PlanRun = {
      ...context.run,
      status: 'paused',
      pendingReason: reason,
      updatedAt: Date.now(),
    };
    await commitPlan(context.definition, run, {
      type: reason === '另一标签页请求接管计划' ? 'takeover_yielded' : 'paused',
      at: Date.now(),
      detail: { reason },
    });
    releasePlanWriter(context.definition.id);
  }

  async function skipPlanStep(stepId: string) {
    const context = getActivePlanContext();
    const state = context?.run.stepStates[stepId];
    if (!context || !state || context.run.currentStepId !== stepId) return;
    if (!['paused', 'waiting_for_user'].includes(context.run.status)) return;
    const step = context.definition.steps.find((item) => item.id === stepId);
    if (!step?.skippable) {
      throw new Error('该步骤不可跳过；请提交新 revision 修改或删除步骤');
    }
    const transition = planRunner.skipStep(context.definition, context.run, stepId);
    let run = transition.run;
    run = ensureCurrentPlanStep(context.definition, run);
    await commitPlan(context.definition, run, transition.event);
  }

  async function continuePlan() {
    const instance = chatRef.value;
    const context = getActivePlanContext();
    if (!instance || !context || instance.busy) return;
    let run = context.run;
    if (run.status !== 'running') {
      const blockedStepId = run.currentStepId;
      const blockedState = blockedStepId ? run.stepStates[blockedStepId] : undefined;
      if (
        blockedStepId &&
        blockedState &&
        ['blocked', 'failed'].includes(blockedState.status)
      ) {
        if (blockedState.attempts > context.definition.budgets.maxStepRetries) {
          const exhausted: PlanRun = {
            ...run,
            status: 'paused',
            pendingReason: `步骤重试次数已达到预算 ${context.definition.budgets.maxStepRetries}`,
            updatedAt: Date.now(),
          };
          await commitPlan(context.definition, exhausted, {
            type: 'step_retry_budget_exhausted',
            at: Date.now(),
            stepId: blockedStepId,
          });
          releasePlanWriter(context.definition.id);
          return;
        }
        run = {
          ...run,
          stepStates: {
            ...run.stepStates,
            [blockedStepId]: { ...blockedState, status: 'ready' },
          },
        };
      }
      run = ensureCurrentPlanStep(
        context.definition,
        refreshReadySteps(context.definition, {
          ...run,
          status: 'running',
          pendingReason: undefined,
          recoveryRequired: false,
          updatedAt: Date.now(),
        }),
      );
      await commitPlan(context.definition, run, { type: 'resumed', at: Date.now() });
    }
    const current = context.definition.steps.find((step) => step.id === run.currentStepId);
    if (!current) {
      instance.replaceLlmHistoryProjection([]);
      void instance.next({
        llmContent: buildPlanExecutionContext({ definition: context.definition, run }),
        userText: '计划实现步骤已结束，开始汇总验证。',
        references: [],
      });
      return;
    }
    const instructions = [...run.operatorInstructions];
    if (instructions.length) {
      run = { ...run, operatorInstructions: [], updatedAt: Date.now() };
      await commitPlan(context.definition, run, {
        type: 'operator_instructions_consumed',
        at: Date.now(),
        detail: { count: instructions.length },
      });
    }
    instance.replaceLlmHistoryProjection([]);
    void instance.next({
      llmContent: buildPlanExecutionContext({
        definition: context.definition,
        run,
        currentStepId: current.id,
        operatorInstructions: instructions,
      }),
      userText: `继续计划步骤：${current.title}`,
      references: [],
    });
  }

  async function queuePlanInstruction(instruction: string) {
    const text = instruction.trim();
    const context = getActivePlanContext();
    if (!text || !context || !['running', 'paused', 'waiting_for_user'].includes(context.run.status)) return;
    const run: PlanRun = {
      ...context.run,
      operatorInstructions: [...context.run.operatorInstructions, text],
      updatedAt: Date.now(),
    };
    await commitPlan(context.definition, run, {
      type: 'operator_instruction_queued',
      at: Date.now(),
      detail: { instruction: text },
    });
    if (!chatRef.value?.busy && run.status === 'running') await continuePlan();
  }

  async function acceptPlan(note?: string) {
    const context = getActivePlanContext();
    if (!context || context.run.status !== 'awaiting_acceptance') return;
    const allCriteria = [
      ...context.definition.steps.flatMap((step) => step.acceptance),
      ...context.definition.finalAcceptance,
    ];
    const humanCriteria = allCriteria.filter(
      (criterion) => criterion.providerId === 'user.acceptance',
    );
    const remaining = humanCriteria
      .filter((criterion) => !context.run.acceptanceRecords?.[criterion.id])
      .map((criterion) => criterion.id);
    if (
      context.run.requiresHumanAcceptance ||
      context.run.finalVerification?.verdict !== 'pass'
    ) {
      remaining.push('__plan_result__');
    }
    const transition = planRunner.acceptCriteria(
      context.run,
      remaining,
      'workspace-user',
      note?.trim() || '用户一次接受全部剩余验收项',
    );
    const acceptedAt = Date.now();
    const run: PlanRun = {
      ...transition.run,
      status: 'completed',
      acceptedByUserAt: acceptedAt,
      pendingReason: undefined,
      updatedAt: Date.now(),
    };
    await commitPlan(context.definition, run, {
      type: 'accepted_by_user',
      at: Date.now(),
    });
    releasePlanWriter(context.definition.id);
  }

  async function acceptPlanCriteria(criterionIds: string[], note?: string) {
    const context = getActivePlanContext();
    if (!context || context.run.status !== 'awaiting_acceptance') return;
    const allCriteria = [
      ...context.definition.steps.flatMap((step) => step.acceptance),
      ...context.definition.finalAcceptance,
    ];
    const humanCriteria = allCriteria.filter(
      (criterion) => criterion.providerId === 'user.acceptance',
    );
    const allowed = new Set(humanCriteria.map((item) => item.id));
    const ids = [...new Set(criterionIds)].filter((id) => allowed.has(id));
    if (!ids.length) return;
    const transition = planRunner.acceptCriteria(
      context.run,
      ids,
      'workspace-user',
      note?.trim() || undefined,
    );
    const acceptedAt = Date.now();
    const acceptanceRecords = transition.run.acceptanceRecords ?? {};
    const allCriteriaAccepted = humanCriteria.every(
      (criterion) => acceptanceRecords[criterion.id],
    );
    const needsPlanLevelAcceptance =
      context.run.requiresHumanAcceptance ||
      context.run.finalVerification?.verdict !== 'pass';
    const allAccepted = allCriteriaAccepted && !needsPlanLevelAcceptance;
    const run: PlanRun = {
      ...transition.run,
      status: allAccepted ? 'completed' : 'awaiting_acceptance',
      acceptedByUserAt: allAccepted ? acceptedAt : undefined,
      pendingReason: allAccepted ? undefined : context.run.pendingReason,
      updatedAt: acceptedAt,
    };
    await commitPlan(context.definition, run, {
      type: allAccepted ? 'accepted_by_user' : 'criteria_accepted',
      at: acceptedAt,
      detail: { criterionIds: ids, note },
    });
  }

  async function restorePlanStep(stepId: string) {
    const context = getActivePlanContext();
    if (!context) return;
    const lease = await workspaceWriteCoordinator.acquire(
      context.definition.workspaceId,
      context.definition.id,
    );
    if (!lease) throw new Error('无法获得工作区排他锁，恢复未执行');
    let restored: string[] = [];
    let mutationReport: ToolMutationReport | undefined;
    try {
      beginMutationJournal({
        allowedPathPrefixes: context.definition.allowedPathPrefixes,
      });
      restored = await restorePlanStepCheckpoint(context.definition.id, stepId);
      mutationReport = await endMutationJournal();
    } catch (error) {
      abortMutationJournal();
      throw error;
    } finally {
      lease.release();
    }
    const transition = planRunner.restoreCheckpoint(context.run, stepId, {
      restored,
      mutationReport,
    });
    const run = {
      ...transition.run,
      pendingReason: `已恢复步骤开始前状态：${restored.join('、')}`,
    };
    await commitPlan(context.definition, run, transition.event);
    releasePlanWriter(context.definition.id);
    void mutateWorkspace();
  }

  async function previewPlanRestore(stepId: string) {
    const context = getActivePlanContext();
    if (!context) throw new Error('当前没有活动计划');
    return previewPlanStepCheckpoint(context.definition.id, stepId);
  }

  async function getPlanCheckpointUsage() {
    const context = getActivePlanContext();
    if (!context) return null;
    return rebuildCheckpointObjectIndex(context.definition.id, false);
  }

  async function deletePlanCheckpoint(stepId: string) {
    const context = getActivePlanContext();
    if (!context) throw new Error('当前没有活动计划');
    const result = await deletePlanStepCheckpoint(context.definition.id, stepId);
    await commitPlan(context.definition, context.run, {
      type: 'checkpoint_deleted',
      at: Date.now(),
      stepId,
      detail: result,
    });
    return result;
  }

  async function archivePlan() {
    const context = getActivePlanContext();
    if (!context) return;
    pendingPlanRevisionFeedbackRef.value = null;
    resolvePendingPlanApproval('cancel', activeChatIdRef.value);
    const run: PlanRun = { ...context.run, archivedAt: Date.now(), updatedAt: Date.now() };
    await commitPlan(context.definition, run, {
      type: 'archived',
      at: Date.now(),
    });
    activePlanIdRef.value = null;
    activePlanDefinitionRef.value = null;
    activePlanRunRef.value = null;
    planMode.value = false;
    await applyMountedChatRuntime();
  }

  async function unarchivePlan(planId: string) {
    const active = getActivePlanContext();
    if (active && active.definition.id !== planId) {
      throw new Error(`当前聊天已有活动计划 ${active.definition.id}，请先暂停并归档它`);
    }
    const stored = await planRepository.load(planId);
    if (!stored) throw new Error('找不到要恢复的计划');
    if (!stored.run.archivedAt) return;
    if (['completed', 'failed', 'cancelled'].includes(stored.run.status)) {
      throw new Error('已结束的计划可继续查看，但不能重新进入执行链');
    }
    const run: PlanRun = {
      ...stored.run,
      archivedAt: undefined,
      status: stored.run.status === 'verifying' || stored.run.status === 'running'
        ? 'paused'
        : stored.run.status,
      pendingReason: '计划已从归档恢复，请确认后继续',
      recoveryRequired: stored.run.status === 'verifying' || stored.run.status === 'running',
      updatedAt: Date.now(),
    };
    await commitPlan(stored.definition, run, {
      type: 'unarchived',
      at: Date.now(),
      revision: stored.definition.revision,
    });
    planMode.value = true;
    await applyMountedChatRuntime();
  }

  async function openPlan(planId: string) {
    let stored = await planRepository.load(planId);
    if (!stored) throw new Error('找不到计划');
    const current = getActivePlanContext();
    if (current?.definition.id === planId) return;
    if (
      current &&
      current.definition.sessionId === stored.definition.sessionId &&
      current.definition.id !== planId
    ) {
      throw new Error(`当前会话正在使用计划 ${current.definition.id}，请先归档后再打开另一个计划`);
    }
    if (stored.definition.sessionId !== activeChatIdRef.value) {
      await switchChat(stored.definition.sessionId);
    }
    if (stored.run.archivedAt && !['completed', 'failed', 'cancelled'].includes(stored.run.status)) {
      await unarchivePlan(planId);
      return;
    }
    if (!['completed', 'failed', 'cancelled'].includes(stored.run.status)) {
      stored = await recoverStoredPlan(planId) ?? stored;
      activePlanIdRef.value = stored.definition.id;
      activePlanDefinitionRef.value = stored.definition;
      activePlanRunRef.value = stored.run;
      planMode.value = true;
      syncPlanSection(stored.definition, stored.run);
      await applyMountedChatRuntime();
    }
  }

  async function recoverPlan(
    sessionId: string,
    preserveRunning = false,
    autoContinue = true,
  ) {
    const active = await listActiveSessionPlans(sessionId);
    if (!active.length) return;
    if (active.length > 1) {
      selectSingleActivePlan(active);
      return;
    }
    const stored = active[0]!;
    let run = stored.run;
    if (
      !preserveRunning &&
      (
        run.status === 'running' ||
        run.status === 'verifying' ||
        Object.values(run.stepStates).some((state) => state.status === 'running')
      )
    ) {
      const stepStates = { ...run.stepStates };
      for (const [stepId, state] of Object.entries(stepStates)) {
        if (state.status === 'running') {
          stepStates[stepId] = {
            ...state,
            status: 'blocked',
            failureReason: '应用在执行中中断，需要用户确认后继续',
          };
        }
      }
      run = {
        ...run,
        status: 'paused',
        recoveryRequired: true,
        pendingReason:
          run.status === 'verifying'
            ? '检测到中断的验证，已暂停；恢复后会重新运行声明的只读验证'
            : '检测到中断的计划，已暂停以避免重复执行',
        stepStates,
        updatedAt: Date.now(),
      };
      const recovered = await planRepository.commit({
        definition: stored.definition,
        run,
        writeDefinition: false,
        event: {
          type: 'recovery_required',
          at: Date.now(),
          revision: run.approvedRevision,
        },
      });
      run = recovered.run;
    }
    activePlanIdRef.value = stored.definition.id;
    activePlanDefinitionRef.value = stored.definition;
    activePlanRunRef.value = run;
    planMode.value = true;
    syncPlanSection(stored.definition, run);
    if (chatRef.value?.getAgentMode() !== 'plan' && !chatRef.value?.busy) {
      await applyMountedChatRuntime();
    }
    if (
      preserveRunning &&
      autoContinue &&
      run.status === 'running' &&
      !chatRef.value?.busy
    ) {
      window.setTimeout(() => void continuePlan(), 0);
    }
  }

  async function suggestPlanMode(goal: string, reason?: string) {
    const sessionId = activeChatIdRef.value;
    if (!sessionId) return;
    try {
      await ElMessageBox.confirm(
        reason ? `${reason}\n\n是否切换到计划模式，为「${goal}」先制定可批准计划？` : `是否切换到计划模式，为「${goal}」先制定可批准计划？`,
        '建议使用计划模式',
        { confirmButtonText: '切换并起草', cancelButtonText: '继续对话', type: 'info' },
      );
      pendingPlanSuggestionRef.value = { goal, reason, sessionId };
      return true;
    } catch {
      pendingPlanSuggestionRef.value = null;
      return false;
    }
  }

  async function maybeKickoffPendingPlan(sessionId: string) {
    const pending = pendingPlanSuggestionRef.value;
    if (!pending || pending.sessionId !== sessionId) return;
    pendingPlanSuggestionRef.value = null;
    await setChatMode('plan');
    const instance = chatRef.value;
    if (!instance || !planMode.value) return;
    void instance.next(
      `请为以下目标先做只读影响分析，再调用 submitPlan 提交可批准的版本化计划：\n${pending.goal}`,
    );
  }

  async function maybeKickoffPendingPlanRevision(sessionId: string) {
    const pending = pendingPlanRevisionFeedbackRef.value;
    const instance = chatRef.value;
    if (!pending || pending.sessionId !== sessionId || !instance || instance.busy) return;
    const context = getActivePlanContext();
    if (!context || context.definition.id !== pending.planId) return;
    if (context.definition.revision > pending.revision) {
      pendingPlanRevisionFeedbackRef.value = null;
      return;
    }
    pendingPlanRevisionFeedbackRef.value = null;
    void instance.next(
      `用户要求修改当前计划 revision ${pending.revision}：\n${pending.feedback}\n\n` +
        `请保持 planId=${pending.planId}，先只读核对影响，再以 baseRevision=${pending.revision} ` +
        '调用 submitPlan 提交新 revision。未经重新批准不要写入。',
    );
  }

  async function copyLegacySpecToPlan(doc: SpecDoc) {
    const instance = chatRef.value;
    if (!instance || instance.busy) return;
    await setChatMode('plan');
    void instance.next(
      `用户明确要求把以下旧 Spec 复制为新的 Plan v1。旧数据保持不变。` +
        `请先只读核对当前工作区，然后补充路径前缀、步骤依赖和基于浏览器 provider 的验收标准，` +
        `再调用 submitPlan 提交新的计划供批准：\n${JSON.stringify({
          goal: doc.goal,
          requirements: doc.requirements,
          design: doc.design,
          tasks: doc.tasks.map((task) => ({ title: task.title, detail: task.detail })),
          acceptance: doc.acceptance,
        }, null, 2)}`,
    );
  }

  async function maybeContinuePlanAfterTurn(sessionId: string) {
    if (sessionId !== activeChatIdRef.value) return;
    const context = getActivePlanContext();
    const instance = chatRef.value;
    if (!context || !instance || context.run.status !== 'running') return;
    if (getPendingPlanApproval(sessionId) || instance.busy) return;
    const transition = planRunner.recordTurnCompleted(
      context.definition,
      context.run,
    );
    await commitPlan(context.definition, transition.run, transition.event);
    if (transition.run.status === 'paused') {
      releasePlanWriter(context.definition.id);
      return;
    }
    await continuePlan();
  }

  /**
   * 卸载当前活跃聊天的 UI 绑定。
   * 默认：busy 或仍有待处理交互闸门的实例后台保活（仅落盘并断开指针）；
   * 真正空闲的实例则彻底销毁；options.force=true 时无论是否 busy 都中断并销毁。
   */
  async function teardownCurrentChat(options?: TeardownChatOptions) {
    const sessionId = activeChatIdRef.value;
    const entry = sessionId ? agents.get(sessionId) : null;

    // 编排为活跃态单例，切走即暂停并断开 UI 绑定
    orchestratorRef.value?.pause();
    orchestratorRef.value = null;
    activeOrchestrationIdRef.value = null;

    if (entry && sessionId) {
      const activePlanKeepsAlive =
        activePlanRunRef.value?.sessionId === sessionId &&
        !['completed', 'failed', 'cancelled'].includes(activePlanRunRef.value.status);
      const keepAlive =
        !options?.force &&
        (entry.agent.busy || sessionHasPendingInteraction(sessionId) || activePlanKeepsAlive);
      if (!keepAlive) {
        await teardownEntry(sessionId, { abort: options?.force ?? false });
      } else {
        // 后台保活：落盘当前快照，保留实例与 watcher/timer / 待批准闸门
        await persistSession(sessionId);
        setSessionRuntime(sessionId, {
          busy: entry.agent.busy || sessionHasPendingInteraction(sessionId),
          inFlight: entry.agent.isInFlight() || sessionHasPendingInteraction(sessionId),
        });
      }
    }

    chatRef.value = null;
    if (!options?.keepUi) {
      chat.value = null;
    }
    // 断开 UI 后清空交互作用域，避免切到下一会话前误读上一会话的 pending
    setActiveInteractionSession(null);
  }

  /** 准备工作空间切换（终止所有会话、重置状态） */
  async function prepareWorkspaceSwitch() {
    workspaceInitGen += 1;
    resetAutoCheckpoint();
    clearSessionActivePresetId();

    orchestratorRef.value?.pause();

    await teardownAll({ abort: true });

    chatRef.value = null;
    chat.value = null;
    activeChatIdRef.value = null;
    activeTaskIdRef.value = null;
    activeChatId.value = null;
    activeTaskId.value = null;
    chatSessions.value = [];
    taskSignalsMapRef.value = new Map();
    orchestratorRef.value = null;
    activeOrchestrationIdRef.value = null;
    sessionRuntimeStatus.value = {};
    setActiveInteractionSession(null);
  }

  /** 准备聊天文件系统（确保 .cottage 目录存在、修复索引） */
  async function prepareChatFilesystem(): Promise<void> {
    await workspace.ensureCottageDir();
    await repairChatSessionsIndex();
  }

  /** 挂载聊天实例到指定会话 */
  async function mountChat(sessionId: string, options?: MountChatOptions) {
    const opGen = ++chatMountGenRef.value;
    chatMountingRef.value = true;
    try {
      await mountChatInner(sessionId, opGen, options);
    } finally {
      // 仅当没有更新的挂载操作时才结束加载态，避免误关最新挂载的 loading
      if (opGen === chatMountGenRef.value) {
        chatMountingRef.value = false;
      }
    }
  }

  /** mountChat 的实际实现（外层负责维护 mounting 加载态） */
  async function mountChatInner(
    sessionId: string,
    opGen: number,
    options?: MountChatOptions,
  ) {
    // 确保密钥已从 IndexedDB 加载，避免与初始 reloadSecrets 竞态导致缺 Key 误报
    if (secretsVersion.value === 0) {
      await reloadSecrets();
      if (opGen !== chatMountGenRef.value) return;
    }

    // 切换活跃会话：先分离上一个编排器，防止其事件写入即将切入的会话
    detachActiveOrchestrator();

    // 复用后台仍存活的实例（切回正在运行 / 仍待批准的会话），避免丢失在途状态与批准弹窗
    const reuse = agents.get(sessionId);
    if (reuse && !options?.taskId) {
      if (opGen !== chatMountGenRef.value) return;
      activeTaskIdRef.value = null;
      activeTaskId.value = null;
      lastMountErrorRef.value = null;
      // 先恢复交互作用域，再挂 UI，确保首帧就能读到该会话的 pending 闸门
      setActiveInteractionSession(sessionId);
      chatRef.value = reuse.agent;
      activeChatIdRef.value = sessionId;
      activeChatId.value = sessionId;
      chat.value = reuse.agent;
      const pending = sessionHasPendingInteraction(sessionId);
      setSessionRuntime(sessionId, {
        busy: reuse.agent.busy || pending,
        inFlight: reuse.agent.isInFlight() || pending,
      });
      planMode.value = false;
      activePlanIdRef.value = null;
      activePlanDefinitionRef.value = null;
      activePlanRunRef.value = null;
      try {
        const activePlans = await listActiveSessionPlans(sessionId);
        selectSingleActivePlan(activePlans, false);
      } catch (error) {
        console.warn('[Agent] 恢复复用会话的计划上下文失败:', error);
      }
      // 空闲复用时同步最新模型/工具配置，避免切回会话仍走旧 API
      if (!reuse.agent.busy) {
        try {
          await loadCottageConfigFromWorkspace();
          if (opGen !== chatMountGenRef.value) return;
          await applyMountedChatRuntime();
        } catch (error) {
          console.warn('[Agent] 复用会话时热切换运行时失败，已跳过:', error);
        }
      }
      try {
        await recoverOrchestration(sessionId);
      } catch (error) {
        console.warn('[Agent] 恢复编排状态失败，已跳过:', error);
      }
      try {
        await recoverPlan(sessionId, true);
      } catch (error) {
        console.warn('[Agent] 恢复统一计划状态失败，已跳过:', error);
      }
      return;
    }

    await loadCottageConfigFromWorkspace();
    const snapshot = await loadSessionSnapshot(sessionId);
    const history = snapshot.history;
    const llmHistory = snapshot.llmHistory;
    const taskId = options?.taskId;
    const isTask = Boolean(taskId);

    if (isTask) {
      activeTaskIdRef.value = taskId!;
      activeTaskId.value = taskId!;
    } else {
      activeTaskIdRef.value = null;
      activeTaskId.value = null;
    }

    // 新 Plan v1 与旧 Spec/Task 数据隔离；仅恢复当前会话的 Plan v1。
    if (!isTask) {
      planMode.value = false;
      activePlanIdRef.value = null;
      activePlanDefinitionRef.value = null;
      activePlanRunRef.value = null;
      try {
        const activePlans = await listActiveSessionPlans(sessionId);
        selectSingleActivePlan(activePlans, false);
      } catch (error) {
        console.warn('[Agent] 检查未完成计划失败，已跳过:', error);
      }
    }

    const signals = taskId ? getTaskSignals(taskId) : undefined;
    let promptContext: Awaited<
      ReturnType<typeof loadWorkspaceAgentPromptContext>
    > = { skills: [], projectInstructionsBlock: '' };
    try {
      promptContext = await loadWorkspaceAgentPromptContext();
    } catch (error) {
      console.warn('[Agent] 加载工作空间技能/项目约定失败，已跳过:', error);
    }
    const packContext = await resolvePackContext();
    const capabilities = capabilitiesForAgent(
      enabledToolsRef.value,
      packContext.packs,
    );

    if (!getLlmConfig()) {
      if (opGen !== chatMountGenRef.value) return;
      chatRef.value = null;
      activeChatIdRef.value = sessionId;
      activeChatId.value = sessionId;
      chat.value = null;
      lastMountErrorRef.value = '请先在设置中添加模型';
      return;
    }

    let instance: CottageAgent;
    const chatMode: CottageAgentMode = isTask
      ? 'task'
      : planMode.value
        ? 'plan'
        : 'chat';
    try {
      await prepareTokenCounter(getLlmConfig()?.model);
      if (opGen !== chatMountGenRef.value) return;
      instance = createCottageAgent({
        chat_history: history,
        llm_history: llmHistory,
        onWorkspaceMutate: () => { void mutateWorkspace(); },
        mode: chatMode,
        taskId,
        taskSignals: signals?.toToolSignals(),
        onDispatchSubtask: isTask && taskId
          ? (goal, opts) => runDispatchSubtask(taskId, goal, opts)
          : undefined,
        secrets: secretsRef.value,
        enabledTools: enabledToolsRef.value,
        workspaceSkills: promptContext.skills,
        projectInstructionsBlock: promptContext.projectInstructionsBlock,
        packPromptOverlays: packContext.promptOverlays,
        resolvedCapabilities: capabilities,
        cottageServiceClient: useCottageServiceStore().isConnected()
          ? useCottageServiceStore().getClient() ?? undefined
          : undefined,
        cottageServiceCapabilities: useCottageServiceStore().isConnected()
          ? [...useCottageServiceStore().routingCapabilities]
          : undefined,
        searchSource: resolvedSearchSource.value ?? undefined,
        thirdPartyProvider: getCottageConfig().webSearch?.thirdPartyProvider,
        cottageServiceEngine: getCottageConfig().webSearch?.engine,
        cottageServiceServerCapabilities: useCottageServiceStore().isConnected()
          ? [...useCottageServiceStore().capabilities]
          : undefined,
        // [HIDDEN] 编排已下线：回调仍传入以保留 startOrchestration 引用，但 Agent 端不再注入编排工具、不会调用它。详 docs/hidden-features.md
        onStartOrchestration: async (goal, hint) => startOrchestration(goal, hint),
        onSuggestPlan:
          chatMode === 'chat'
            ? (goal, reason) => suggestPlanMode(goal, reason)
            : undefined,
        planCallbacks:
          chatMode === 'plan' ? buildPlanCallbacks(sessionId) : undefined,
        sessionId,
        onInFlightUpdate: () => {
          const cur = sessionRuntimeStatus.value[sessionId];
          if (!cur?.busy) setSessionRuntime(sessionId, { busy: true, inFlight: true });
          schedulePersist(sessionId);
        },
      });
    } catch (error) {
      // 例如缺失 API Key：不抛出未处理 rejection，保留会话占位，
      // 由聊天界面根据配置/密钥状态提示用户去设置。
      if (opGen !== chatMountGenRef.value) return;
      chatRef.value = null;
      activeChatIdRef.value = sessionId;
      activeChatId.value = sessionId;
      chat.value = null;
      lastMountErrorRef.value =
        error instanceof Error ? error.message : String(error);
      return;
    }

    lastMountErrorRef.value = null;
    registerAgent(sessionId, instance);

    if (opGen !== chatMountGenRef.value) return;

    chatRef.value = instance;
    activeChatIdRef.value = sessionId;
    activeChatId.value = sessionId;
    chat.value = instance;
    setActiveInteractionSession(sessionId);
    setSessionRuntime(sessionId, {
      busy: instance.busy,
      // 上次回合在刷新/关闭前未完成，或仍有待处理交互 → 标记“已中断/待处理”
      inFlight:
        instance.isInFlight() ||
        Boolean(snapshot.runtime?.inFlight) ||
        pendingInteractionCallIds(history).size > 0,
    });

    if (!isTask) {
      try {
        await recoverOrchestration(sessionId);
      } catch (error) {
        console.warn('[Agent] 恢复编排状态失败，已跳过:', error);
      }
      try {
        await recoverPlan(sessionId);
      } catch (error) {
        console.warn('[Agent] 恢复统一计划状态失败，已跳过:', error);
      }
    }

    try {
      await instance.restoreStagedReviewIfNeeded();
      if (opGen !== chatMountGenRef.value) return;
      if (sessionHasPendingInteraction(sessionId)) {
        setSessionRuntime(sessionId, {
          busy: instance.busy || sessionHasPendingInteraction(sessionId),
          inFlight: true,
        });
      }
    } catch (error) {
      console.warn('[Agent] 恢复暂存审批失败，已跳过:', error);
    }
  }


  /** 解析当前活跃会话 ID（确保有活跃会话） */
  async function resolveActiveSessionId(): Promise<string | null> {
    const root = workspaceRoot();
    if (!root) return null;

    try {
      await prepareChatFilesystem();
    } catch (error) {
      lastMountErrorRef.value = formatWorkspaceFsError(error);
      return null;
    }

    let sessionId = activeChatIdRef.value;
    if (sessionId) return sessionId;

    const index = await loadChatSessionsIndex();
    sessionId = index.activeId;
    // activeId 可指向尚未列入历史的会话；仅当既不在列表、文件也不存在时才回退
    if (sessionId) {
      const listed = index.sessions.some((s) => s.id === sessionId);
      if (!listed && !(await chatSessionExists(sessionId))) {
        sessionId = index.sessions[0]?.id;
      }
    } else {
      sessionId = index.sessions[0]?.id;
    }

    if (!sessionId) {
      const meta = await createChatSession();
      sessionId = meta.id;
      await setActiveChatSession(sessionId);
      const refreshed = await loadChatSessionsIndex();
      chatSessions.value = sortChatSessions(refreshed.sessions);
    } else {
      chatSessions.value = sortChatSessions(index.sessions);
    }

    activeChatIdRef.value = sessionId;
    activeChatId.value = sessionId;
    return sessionId;
  }

  /** 重试挂载聊天（用于挂载失败后的重试） */
  async function retryChatMount(): Promise<CottageAgent | null> {
    try {
      const sessionId = await resolveActiveSessionId();
      if (!sessionId) return null;

      await loadCottageConfigFromWorkspace();
      if (!getLlmConfig()) {
        lastMountErrorRef.value = '请先在设置中添加模型';
        return null;
      }

      const taskId = activeTaskIdRef.value ?? undefined;
      await mountChat(sessionId, taskId ? { taskId } : undefined);
      await syncSessionsFromDisk();
      return chatRef.value;
    } catch (error) {
      lastMountErrorRef.value = formatWorkspaceFsError(error);
      return null;
    }
  }

  /** 确保聊天已挂载（未挂载则尝试挂载或重试） */
  async function ensureChatMounted(): Promise<CottageAgent | null> {
    if (chatRef.value) return chatRef.value;
    return retryChatMount();
  }

  /** 重新加载密钥（可选热切换已挂载聊天的运行时配置） */
  async function reloadSecrets(options?: ReloadSecretsOptions) {
    secretsRef.value = await loadProviderSecrets();
    secretsVersion.value += 1;

    if (!options?.remount) return;

    // remount 语义保留给设置页等需要强制重建的场景；composer 模型切换走热切换
    if (options.hot === true) {
      await applyMountedChatRuntime();
      return;
    }

    const sessionId = activeChatIdRef.value;
    const root = workspaceRoot();
    if (!sessionId || !root) return;

    const taskId = activeTaskIdRef.value ?? undefined;
    await teardownCurrentChat({ keepUi: true, force: true });
    await mountChat(sessionId, taskId ? { taskId } : undefined);
  }

  void reloadSecrets();

  // 关闭/刷新拦截：进行中回合或事件日志尚有未 flush 缓冲时提醒，并尽力落盘
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', (event) => {
      const pendingEntries = [...agents.values()].filter((entry) => {
        if (entry.agent.busy || entry.agent.isInFlight()) return true;
        return entry.agent.getTraceRecorder()?.hasPending() === true;
      });
      if (pendingEntries.length === 0) return;
      // 尽力同步落盘（浏览器不保证 await 完成，仅作尽力而为）
      for (const entry of pendingEntries) {
        void persistSessionDraft(entry.sessionId);
      }
      event.preventDefault();
      event.returnValue = '';
      return '';
    });
  }

  /** 挂载任务会话（切换当前聊天并绑定任务） */
  async function mountTaskSession(sessionId: string, taskId: string) {
    if (!__COTTAGE_INCLUDE_HIDDEN_FEATURES__) {
      throw new Error('当前构建未包含任务模式');
    }
    const root = workspaceRoot();
    if (!root) {
      throw new Error('请先打开工作空间');
    }

    const sameSession = activeChatIdRef.value === sessionId && chatRef.value;
    const alreadyTask = activeTaskIdRef.value === taskId;

    if (sameSession && alreadyTask) return;

    if (sameSession && !alreadyTask) {
      await teardownCurrentChat({ force: true });
      await mountChat(sessionId, { taskId });
      await syncSessionsFromDisk();
      return;
    }

    await teardownCurrentChat({ force: true });
    await setActiveChatSession(sessionId);
    await mountChat(sessionId, { taskId });
    await syncSessionsFromDisk();
  }

  /** 为工作空间初始化 Agent（加载配置、新建空白会话并挂载） */
  async function initAgentForWorkspace() {
    const workspaceId = workspaceStore.activeWorkspaceId;
    const root = workspaceRoot();
    if (!workspaceId || !root) {
      await teardownAll({ abort: true });
      activeChatIdRef.value = null;
      activeTaskIdRef.value = null;
      activeChatId.value = null;
      activeTaskId.value = null;
      chatSessions.value = [];
      return;
    }

    const gen = ++workspaceInitGen;
    chatMountingRef.value = true;
    try {
      const cfg = await loadCottageConfigFromWorkspace();
      if (gen !== workspaceInitGen) return;

      await useCottageServiceStore().restore();
      if (gen !== workspaceInitGen) return;

      enabledToolsRef.value = cfg.enabledTools ?? [];
      enabledToolGroups.value = optionalToolGroupsFromNames(cfg.enabledTools);
      searchSource.value = cfg.webSearch?.source ?? null;

      try {
        await prepareChatFilesystem();
      } catch (error) {
        lastMountErrorRef.value = formatWorkspaceFsError(error);
        return;
      }
      if (gen !== workspaceInitGen) return;

      let index = await loadChatSessionsIndex();
      if (gen !== workspaceInitGen) return;

      // 打开工作区时始终新建空白会话，不恢复上次会话（历史仍可从面板切换）
      const meta = await createChatSession();
      const sessionId = meta.id;
      await setActiveChatSession(sessionId);
      index = await loadChatSessionsIndex();
      if (gen !== workspaceInitGen) return;

      activeChatIdRef.value = sessionId;
      activeChatId.value = sessionId;
      chatSessions.value = sortChatSessions(index.sessions);

      await mountChat(sessionId);
      if (gen !== workspaceInitGen) {
        await teardownCurrentChat({ force: true });
        return;
      }
    } finally {
      // 仅当没有更新的初始化操作时才结束加载态
      if (gen === workspaceInitGen) {
        chatMountingRef.value = false;
      }
    }
  }

  /** 创建新聊天会话 */
  async function createNewChat() {
    const root = workspaceRoot();
    if (!root) return;

    // 当前会话尚无用户输入时，已是空白对话，无需再建一条空历史
    const current = chatRef.value;
    if (
      current &&
      !sessionHasUserInput(current.getPersistableSnapshot().history)
    ) {
      return;
    }

    chatMountingRef.value = true;
    try {
      await teardownCurrentChat();
      await prepareChatFilesystem();
      const meta = await createChatSession();
      await syncSessionsFromDisk();
      await mountChat(meta.id);
      await syncSessionsFromDisk();
    } catch (error) {
      lastMountErrorRef.value = formatWorkspaceFsError(error);
    } finally {
      chatMountingRef.value = false;
    }
  }

  /**
   * 从指定助手消息分叉：复制该消息及之前的上下文到新对话并切换过去。
   */
  async function forkChatFromMessage(messageId: string) {
    const root = workspaceRoot();
    const instance = chatRef.value;
    const sourceSessionId = activeChatIdRef.value;
    if (!root || !instance || !sourceSessionId) return;
    if (instance.busy) {
      throw new Error(i18n.global.t('chat.forkBusy'));
    }

    const history = instance.getHistoryThroughUiMessage(messageId);
    if (!sessionHasUserInput(history)) {
      throw new Error(i18n.global.t('chat.forkEmpty'));
    }

    const sourceTitle =
      chatSessions.value.find((s) => s.id === sourceSessionId)?.title ??
      i18n.global.t('chat.newChat');
    const title = `${sourceTitle}${i18n.global.t('chat.forkTitleSuffix')}`;

    chatMountingRef.value = true;
    try {
      await teardownCurrentChat();
      await prepareChatFilesystem();
      const meta = await createChatSession(title);
      const { SessionEventLog, messagesToEvents } = await import(
        '../session/eventLog'
      );
      const log = new SessionEventLog(meta.id, { flushDelayMs: 0 });
      log.appendMany(messagesToEvents(history));
      await log.flush();
      await ensureChatSessionListed(meta.id, { title });
      await setActiveChatSession(meta.id);
      await mountChat(meta.id);
      await syncSessionsFromDisk();
    } catch (error) {
      lastMountErrorRef.value = formatWorkspaceFsError(error);
      throw error;
    } finally {
      chatMountingRef.value = false;
    }
  }

  /** 设置启用的工具组（保存配置并热切换后续回合，不重建聊天列表） */
  async function setEnabledToolGroups(groups: OptionalToolGroupId[]) {
    if (chatRef.value?.busy) {
      throw new Error(i18n.global.t('chat.switchModelBusy'));
    }
    const toolNames = optionalToolNamesForGroups(groups);
    enabledToolsRef.value = toolNames;
    enabledToolGroups.value = [...groups];
    await saveCottageConfigToWorkspace({ enabledTools: toolNames });
    await applyMountedChatRuntime();
  }

  /** 设置当前会话的搜索来源（保存配置并热切换后续回合，不重建聊天列表） */
  async function setSearchSource(source: SearchSource) {
    if (chatRef.value?.busy) {
      throw new Error(i18n.global.t('chat.switchModelBusy'));
    }
    searchSource.value = source;
    await saveCottageConfigToWorkspace({ webSearch: { source } });
    await applyMountedChatRuntime();
  }

  /**
   * 对已挂载 Agent 原地热切换模型 / 工具 / 搜索等运行时配置。
   * 不 teardown、不重载历史；变更以 runtime 事件写入会话时间线。
   */
  async function applyMountedChatRuntime() {
    const instance = chatRef.value;
    const sessionId = activeChatIdRef.value;
    const root = workspaceRoot();
    if (!instance || !sessionId || !root) return;
    if (instance.busy) {
      throw new Error(i18n.global.t('chat.switchModelBusy'));
    }

    let promptContext: Awaited<
      ReturnType<typeof loadWorkspaceAgentPromptContext>
    > = { skills: [], projectInstructionsBlock: '' };
    try {
      promptContext = await loadWorkspaceAgentPromptContext();
    } catch (error) {
      console.warn('[Agent] 加载工作空间技能/项目约定失败，已跳过:', error);
    }
    const packContext = await resolvePackContext();
    const capabilities = capabilitiesForAgent(
      enabledToolsRef.value,
      packContext.packs,
    );
    if (!getLlmConfig()) return;
    await prepareTokenCounter(getLlmConfig()?.model);

    const taskId = activeTaskIdRef.value ?? undefined;
    const isTask = Boolean(taskId);
    const chatMode: CottageAgentMode = isTask
      ? 'task'
      : planMode.value
        ? 'plan'
        : 'chat';
    const cottage = useCottageServiceStore();
    const signals = taskId ? getTaskSignals(taskId) : undefined;

    createCottageAgent({
      reuseAgent: instance,
      onWorkspaceMutate: () => {
        void mutateWorkspace();
      },
      mode: chatMode,
      taskId,
      taskSignals: signals?.toToolSignals(),
      onDispatchSubtask:
        isTask && taskId
          ? (goal, opts) => runDispatchSubtask(taskId, goal, opts)
          : undefined,
      secrets: secretsRef.value,
      enabledTools: enabledToolsRef.value,
      workspaceSkills: promptContext.skills,
      projectInstructionsBlock: promptContext.projectInstructionsBlock,
      packPromptOverlays: packContext.promptOverlays,
      resolvedCapabilities: capabilities,
      cottageServiceClient: cottage.isConnected()
        ? cottage.getClient() ?? undefined
        : undefined,
      cottageServiceCapabilities: cottage.isConnected()
        ? [...cottage.routingCapabilities]
        : undefined,
      searchSource: resolvedSearchSource.value ?? undefined,
      thirdPartyProvider: getCottageConfig().webSearch?.thirdPartyProvider,
      cottageServiceEngine: getCottageConfig().webSearch?.engine,
      cottageServiceServerCapabilities: cottage.isConnected()
        ? [...cottage.capabilities]
        : undefined,
      onSuggestPlan:
        chatMode === 'chat'
          ? (goal, reason) => suggestPlanMode(goal, reason)
          : undefined,
      planCallbacks:
        chatMode === 'plan' ? buildPlanCallbacks(sessionId) : undefined,
      sessionId,
    });

    // 写入 runtime 时间线条目（模型/工具/来源快照），而非重建整段 transcript
    schedulePersist(sessionId);
  }

  /** 切换到指定聊天会话 */
  async function switchChat(sessionId: string) {
    if (sessionId === activeChatIdRef.value && !activeTaskIdRef.value) return;

    const root = workspaceRoot();
    if (!root) return;

    chatMountingRef.value = true;
    try {
      if (activePlanRunRef.value?.status === 'running') {
        await pausePlan();
      }
      await teardownCurrentChat();
      await setActiveChatSession(sessionId);
      await mountChat(sessionId);
      await syncSessionsFromDisk();
    } finally {
      chatMountingRef.value = false;
    }
  }

  /** 切换会话置顶 */
  async function togglePinChat(sessionId: string) {
    const current = chatSessions.value.find((s) => s.id === sessionId);
    if (!current) return;
    await setChatSessionPinned(sessionId, !current.pinned);
    await syncSessionsFromDisk();
  }

  /** 删除历史会话；若删的是当前会话则切到下一条或新建 */
  async function deleteChat(sessionId: string) {
    const root = workspaceRoot();
    if (!root) return;

    const wasActive = activeChatIdRef.value === sessionId;
    chatMountingRef.value = true;
    try {
      if (wasActive) {
        orchestratorRef.value?.pause();
        orchestratorRef.value = null;
        activeOrchestrationIdRef.value = null;
      }
      if (agents.has(sessionId)) {
        await teardownEntry(sessionId, { abort: true, save: false });
      }
      if (wasActive) {
        chatRef.value = null;
        chat.value = null;
        activeChatIdRef.value = null;
        activeChatId.value = null;
        setActiveInteractionSession(null);
      }
      await deleteChatSession(sessionId);
      titleRefineStarted.delete(sessionId);
      await syncSessionsFromDisk();

      if (!wasActive) return;

      const nextId = chatSessions.value[0]?.id;
      if (nextId) {
        await setActiveChatSession(nextId);
        await mountChat(nextId);
      } else {
        const meta = await createChatSession();
        await mountChat(meta.id);
      }
      await syncSessionsFromDisk();
    } finally {
      chatMountingRef.value = false;
    }
  }

  return {
    chat,
    chatSessions,
    activeChatId,
    activeTaskId,
    sessionRuntimeStatus,
    enabledToolGroups,
    searchSource,
    availableSearchSources,
    setSearchSource,
    secrets: secretsRef,
    secretsVersion,
    lastMountError: lastMountErrorRef,
    chatMounting: chatMountingRef,
    reloadSecrets,
    ensureChatMounted,
    retryChatMount,
    prepareWorkspaceSwitch,
    initAgentForWorkspace,
    createNewChat,
    forkChatFromMessage,
    switchChat,
    togglePinChat,
    deleteChat,
    mountTaskSession,
    persistCurrentChat,
    setEnabledToolGroups,
    getTaskSignals,
    orchestrator: orchestratorRef,
    activeOrchestrationId: activeOrchestrationIdRef,
    startOrchestration,
    pauseOrchestration,
    resumeOrchestration,
    approveOrchestrationPlan,
    cancelOrchestration,
    answerOrchestrationHuman,
    planMode,
    activePlanId: activePlanIdRef,
    activePlanDefinition: activePlanDefinitionRef,
    activePlanRun: activePlanRunRef,
    setChatMode,
    approvePlan,
    adjustPlan,
    requestPlanChanges,
    savePlanEdits,
    cancelPlan,
    pausePlan,
    skipPlanStep,
    continuePlan,
    acceptPlan,
    acceptPlanCriteria,
    restorePlanStep,
    previewPlanRestore,
    getPlanCheckpointUsage,
    deletePlanCheckpoint,
    archivePlan,
    unarchivePlan,
    openPlan,
    listWorkspacePlans,
    queuePlanInstruction,
    copyLegacySpecToPlan,
  };
});
