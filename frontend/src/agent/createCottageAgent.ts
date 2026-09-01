import type { CottageTool } from '@/agent/runtime/tool';
import { adaptToolsForMoonshot } from './moonshotToolSchema';
import type {
  LlmModelConfig,
  SearchSource,
  ThirdPartySearchProviderId,
} from '../config/constants';
import {
  normalizeProviderId,
  providerLabel,
  resolveLlmBaseUrl,
  type LlmProviderId,
} from '../config/llmProviders';
import { getActiveModelPreset, getCottageConfig, getLlmConfig } from '../config/store';
import {
  getPresetApiKey,
  getSecretForProvider,
  type ProviderSecretEntry,
  type ProviderSecrets,
  type SecretProviderId,
} from '../config/secrets';
import {
  buildCottageSystemPrompt,
  buildCottagePlanSystemPrompt,
  buildCottageTaskSystemPrompt,
} from './constants';
import type { Capability } from '../platform/capabilities';
import { capabilitiesForEnabledTools } from './toolCatalog';
import { CottageAgent } from './CottageAgent';
import { isApiKeyRequiredForConfig } from '../config/llmKeyStatus';
import { shouldApplyMoonshotThinking } from '../config/moonshotThinking';
import { createChatModel, LlmConfigError } from './createModel';
import {
  createFileCottageTools,
  createSaveChatAttachmentTool,
  createTaskCottageTools,
  createViewImageTool,
  createWebCottageTools,
} from './cottageTools';
import { createAskUserCottageTool } from './askUserTool';
import { createLoadToolsTool } from './loadToolsTool';
import { createScriptToolInvoker } from './scriptToolBridge';
import {
  createUnifiedToolExecutor,
  type ToolCatalogEntry,
} from './toolInvocation';
import type { ToolStreamContext } from './toolStream';
import {
  DEFERRED_FILE_TOOL_NAMES,
  formatDeferredToolsPromptBlock,
  partitionFileTools,
} from './toolSkills';
import { mcpRegistry } from '../mcp/registry';
import { getCachedProviderModels } from '../config/modelCatalog';
import {
  resolveCottageModelCapabilities,
  supportsVisionInput,
} from '../config/modelCapabilities';
// [HIDDEN] 编排模式已从可见功能下线（由统一计划模式承担），工具不再注入；代码保留见 orchestrator/。详 docs/hidden-features.md
// import { createStartOrchestrationTool } from '../orchestrator/orchestratorTools';
import {
  createPlanTools,
  createSuggestPlanModeTool,
  type PlanToolCallbacks,
} from '../plan/planTools';
import { createPlanToolGuard, type PlanToolGuard } from '../plan/scopeGate';
import { getVerificationRegistry } from '../plan/verification';
import {
  builtinPackPromptOverlays,
  createBuiltinPackTools,
} from '../platform/packs/builtins';
import { createPolicyGate } from '../platform/policy';
import {
  createPlanGate,
  createSubmitPlanTool,
  PlanSession,
} from '../platform/plan';
import { StagingStore, StagingWorkspace } from '../platform/staging';
import { TraceRecorder } from '../platform/trace';
import { EventBus } from '../platform/events';
import type { CottageServiceClient, CottageServiceSearchEngine } from '../cottageService/client';
import type { StoredMessage } from './messages';
import type { TaskToolSignals, DispatchSubtaskFn } from './taskToolSignals';
import type { WorkspaceSkillIndexEntry } from './workspaceSkills';
import { toolRisk } from './toolDescriptions';

/** 对外可选模式；旧 task/spec 仅保留在内部兼容路径。 */
export type AgentMode = 'chat' | 'plan';
export type CottageAgentMode = AgentMode | 'task';

/** chat / plan 热切换与首次创建共用的模式包上下文 */
export interface ChatPlanModeBundleContext {
  mode: 'chat' | 'plan';
  enabledTools?: readonly string[];
  workspaceSkills?: readonly WorkspaceSkillIndexEntry[];
  projectInstructionsBlock?: string;
  packPromptOverlays?: readonly string[];
  resolvedCapabilities?: readonly Capability[];
  cottageServiceClient?: CottageServiceClient;
  cottageServiceServerCapabilities?: string[];
  onSuggestPlan?: (goal: string, reason?: string) => boolean | void | Promise<boolean | void>;
  planCallbacks?: PlanToolCallbacks;
  sessionId?: string;
  /** 是否对模式工具做 Moonshot schema 适配 */
  adaptForMoonshot?: boolean;
}

export interface ChatPlanModeBundle {
  mode: 'chat' | 'plan';
  systemPrompt: string;
  modeTools: CottageTool[];
  planToolGuard?: PlanToolGuard;
}

/** 构建延后工具目录说明块（与 createCottageAgent 一致） */
function buildDeferredToolsPromptBlock(): string {
  const deferredCatalogNames: string[] = [...DEFERRED_FILE_TOOL_NAMES];
  return formatDeferredToolsPromptBlock(deferredCatalogNames);
}

/**
 * 按 chat / plan 构建系统提示词与模式专用工具。
 * 首次创建与热切换共用，避免两套逻辑分叉。
 */
export function buildChatPlanModeBundle(
  ctx: ChatPlanModeBundleContext,
): ChatPlanModeBundle {
  const cottageConfig = getCottageConfig();
  const planGateConfig = cottageConfig.platform?.planGate;
  const stagingReviewConfig = cottageConfig.platform?.stagingReview;
  const stagingReviewEnabled =
    ctx.mode === 'chat' && stagingReviewConfig?.enabled !== false;
  const planGateEnabled =
    __COTTAGE_INCLUDE_HIDDEN_FEATURES__ &&
    ctx.mode === 'chat' &&
    planGateConfig?.enabled === true &&
    !stagingReviewEnabled;

  const enabledTools = ctx.enabledTools ?? cottageConfig.enabledTools ?? [];
  const workspaceSkills = ctx.workspaceSkills ?? [];
  const projectInstructionsBlock = ctx.projectInstructionsBlock ?? '';
  const capabilities =
    ctx.resolvedCapabilities ?? capabilitiesForEnabledTools(enabledTools);
  const cottageAvailability = {
    connected: Boolean(ctx.cottageServiceClient),
    capabilities: ctx.cottageServiceServerCapabilities,
  };
  const packPromptOverlays = [
    ...builtinPackPromptOverlays(enabledTools, cottageAvailability),
    ...(ctx.packPromptOverlays ?? []),
  ];
  const deferredToolsBlock = buildDeferredToolsPromptBlock();

  const systemPrompt =
    ctx.mode === 'plan'
      ? buildCottagePlanSystemPrompt(
          enabledTools,
          workspaceSkills,
          capabilities,
          packPromptOverlays,
          projectInstructionsBlock,
          deferredToolsBlock,
          getVerificationRegistry().capabilities(),
        )
      : buildCottageSystemPrompt(
          enabledTools,
          workspaceSkills,
          capabilities,
          packPromptOverlays,
          planGateEnabled,
          projectInstructionsBlock,
          deferredToolsBlock,
        );

  let modeTools: CottageTool[] = [];
  if (ctx.mode === 'chat' && ctx.onSuggestPlan) {
    modeTools.push(
      createSuggestPlanModeTool({
        onSuggest: ctx.onSuggestPlan,
      }),
    );
  }
  let planToolGuard: PlanToolGuard | undefined;
  if (ctx.mode === 'plan' && ctx.planCallbacks) {
    modeTools.push(...createPlanTools(ctx.planCallbacks, ctx.sessionId));
    planToolGuard = createPlanToolGuard({
      getContext: ctx.planCallbacks.getActivePlan,
      onBlocked: ctx.planCallbacks.onGuardBlocked,
      onMutation: ctx.planCallbacks.onGuardMutation,
      onExternalCall: ctx.planCallbacks.onGuardExternalCall,
    });
  }
  if (ctx.adaptForMoonshot && modeTools.length) {
    modeTools = adaptToolsForMoonshot(modeTools);
  }

  return { mode: ctx.mode, systemPrompt, modeTools, planToolGuard };
}

export interface CreateCottageAgentOptions {
  mode?: CottageAgentMode;
  taskId?: string;
  taskSignals?: TaskToolSignals;
  chat_history?: StoredMessage[];
  /** 发给模型的上下文投影；缺省与 chat_history 相同 */
  llm_history?: StoredMessage[];
  onWorkspaceMutate?: () => void | Promise<void>;
  welcome_message?: string;
  llmConfig?: LlmModelConfig;
  secrets?: ProviderSecrets;
  /** 覆盖配置中的 enabledTools */
  enabledTools?: string[];
  /** 工作空间 SKILLS 目录扫描得到的技能索引 */
  workspaceSkills?: WorkspaceSkillIndexEntry[];
  /** 已格式化的 <project_instructions> 块（AGENTS.md 等） */
  projectInstructionsBlock?: string;
  packPromptOverlays?: readonly string[];
  resolvedCapabilities?: Capability[];
  /** 额外注入的工具（例如编排器专用工具） */
  extraTools?: CottageTool[];
  /** 已连接的 Cottage Service 客户端 */
  cottageServiceClient?: CottageServiceClient;
  /** 启用的路由能力（search / fetch / llm） */
  cottageServiceCapabilities?: string[];
  /** 服务端声明的完整 capability（screenshot / extract / browser 等） */
  cottageServiceServerCapabilities?: string[];
  /** [HIDDEN] 主 Agent 触发编排模式时的回调；编排已下线，此回调不再被消费（代码保留） */
  onStartOrchestration?: (goal: string, hint?: string) => Promise<string>;
  /** plan 模式：计划定义、步骤状态、验证和范围闸门回调。 */
  planCallbacks?: PlanToolCallbacks;
  /** chat 模式：模型建议进入 plan 模式；必须由用户确认。 */
  onSuggestPlan?: (goal: string, reason?: string) => boolean | void | Promise<boolean | void>;
  /** 当前聊天会话 ID，用于全链路 trace；缺省不记录 */
  sessionId?: string;
  /** 子任务 Agent：禁用主任务完成类工具 */
  isSubtask?: boolean;
  /** 主任务 Agent：派发子任务 */
  onDispatchSubtask?: DispatchSubtaskFn;
  /** 回合进行中视图更新回调（供 store 节流中途落盘） */
  onInFlightUpdate?: () => void;
  /** 当前会话生效的搜索来源；缺省读取配置或回退 cottageService */
  searchSource?: SearchSource;
  /** 第二层选中的第三方搜索 provider */
  thirdPartyProvider?: ThirdPartySearchProviderId;
  /** 第三层 Cottage Service 首选搜索引擎 */
  cottageServiceEngine?: CottageServiceSearchEngine;
  /**
   * 热切换：复用已有 Agent 实例，只替换模型 / 工具 / 提示词 / 原生搜索规格。
   * 保留历史、viewState、plan/staging、trace 等会话态。
   */
  reuseAgent?: CottageAgent;
  /** 临时研究执行器：只挂载风险为 read 的工具，不注册交互、联网或写入工具。 */
  readOnly?: boolean;
}

export const createCottageAgent = (options: CreateCottageAgentOptions = {}) => {
  const reuseAgent = options.reuseAgent;
  const fixedConfig = options.llmConfig;
  const config = fixedConfig ?? getLlmConfig();
  if (!config) {
    throw new LlmConfigError('请先在设置中添加模型');
  }
  const resolveExpectedModelConfig = fixedConfig
    ? () => fixedConfig
    : () => getLlmConfig();
  const secrets = options.secrets ?? {};
  const providerId = normalizeProviderId(config.provider);
  const secretKey = providerId as SecretProviderId;
  const globalSecret = getSecretForProvider(secrets, secretKey, config.connectionId);
  const activePreset = getActiveModelPreset();
  const activePresetMatchesConfig = Boolean(
    activePreset &&
      normalizeProviderId(activePreset.config.provider) === providerId &&
      activePreset.config.model === config.model &&
      (activePreset.config.connectionId?.trim() || undefined) ===
        (config.connectionId?.trim() || undefined),
  );
  const runtimePreset = activePresetMatchesConfig ? activePreset : undefined;
  const presetSecret = runtimePreset
    ? getPresetApiKey(secrets, runtimePreset.id)
    : undefined;
  // 模型配置自身的 API Key 优先；未配置则回退到该预设的 Key，再到全局按厂商保存的 Key（兼容旧配置）
  const secret: ProviderSecretEntry = {
    apiKey:
      config.apiKey?.trim() ||
      presetSecret?.apiKey ||
      globalSecret?.apiKey ||
      '',
    baseUrl: config.baseUrl?.trim() || globalSecret?.baseUrl,
  };

  const reusedMode = reuseAgent?.getAgentMode();
  const requestedMode: CottageAgentMode =
    options.mode ?? (reusedMode === 'spec' ? 'chat' : reusedMode) ?? 'chat';
  const mode: CottageAgentMode =
    !__COTTAGE_INCLUDE_HIDDEN_FEATURES__ && requestedMode === 'task'
      ? 'chat'
      : requestedMode;
  const cottageConfig = getCottageConfig();
  const planGateConfig = cottageConfig.platform?.planGate;
  const stagingReviewConfig = cottageConfig.platform?.stagingReview;
  const stagingReviewEnabled =
    mode === 'chat' && stagingReviewConfig?.enabled !== false;
  // 暂存审阅启用时，写工具先落暂存区、回合末审阅合并，不再走 submitExecutionPlan 文本计划闸门
  const planGateEnabled =
    __COTTAGE_INCLUDE_HIDDEN_FEATURES__ &&
    mode === 'chat' &&
    planGateConfig?.enabled === true &&
    !stagingReviewEnabled;
  const enabledTools = options.enabledTools ?? cottageConfig.enabledTools ?? [];
  const workspaceSkills = options.workspaceSkills ?? [];
  const projectInstructionsBlock = options.projectInstructionsBlock ?? '';
  const capabilities =
    options.resolvedCapabilities ?? capabilitiesForEnabledTools(enabledTools);
  // 提示词 overlay = 内置能力包（按 enabledTools 启用） + 外部能力包
  const cottageAvailability = {
    connected: Boolean(options.cottageServiceClient),
    capabilities: options.cottageServiceServerCapabilities,
  };
  const packPromptOverlays = [
    ...builtinPackPromptOverlays(enabledTools, cottageAvailability),
    ...(options.packPromptOverlays ?? []),
  ];

  const deferredToolsBlock = buildDeferredToolsPromptBlock();

  const chatPlanBundle =
    mode === 'chat' || mode === 'plan'
      ? buildChatPlanModeBundle({
          mode,
          enabledTools,
          workspaceSkills,
          projectInstructionsBlock,
          packPromptOverlays: options.packPromptOverlays,
          resolvedCapabilities: capabilities,
          cottageServiceClient: options.cottageServiceClient,
          cottageServiceServerCapabilities:
            options.cottageServiceServerCapabilities,
          onSuggestPlan: options.onSuggestPlan,
          planCallbacks: options.planCallbacks,
          sessionId: options.sessionId,
        })
      : null;

  const systemPrompt =
    __COTTAGE_INCLUDE_HIDDEN_FEATURES__ && mode === 'task'
      ? buildCottageTaskSystemPrompt(
          enabledTools,
          workspaceSkills,
          capabilities,
          packPromptOverlays,
          projectInstructionsBlock,
          deferredToolsBlock,
        )
      : chatPlanBundle!.systemPrompt;

  if (isApiKeyRequiredForConfig(config, secret.baseUrl) && !secret?.apiKey?.trim()) {
    throw new LlmConfigError(
      `请先在设置中配置「${providerLabel(providerId)}」的 API Key`,
    );
  }

  // 搜索三层来源：缺省读配置，再回退 cottageService
  const searchSource: SearchSource =
    options.searchSource ?? cottageConfig.webSearch?.source ?? 'cottageService';
  const thirdPartyProvider =
    options.thirdPartyProvider ?? cottageConfig.webSearch?.thirdPartyProvider;
  const thirdPartyApiKey = thirdPartyProvider
    ? getSecretForProvider(secrets, thirdPartyProvider)?.apiKey
    : undefined;
  const cottageServiceEngine =
    options.cottageServiceEngine ??
    (cottageConfig.webSearch?.engine as CottageServiceSearchEngine | undefined);

  const traceRecorder =
    reuseAgent?.getTraceRecorder() ??
    (options.sessionId ? new TraceRecorder(options.sessionId) : null);
  const model = createChatModel(
    { ...config, provider: providerId },
    secret ?? { apiKey: '' },
    {
      nativeSearch: searchSource === 'native',
      presetId: runtimePreset?.id,
      presetName: runtimePreset?.name,
      middleware: traceRecorder
        ? [
            {
              onCallFinish: (event) => {
                traceRecorder.append({
                  type: 'model_call',
                  at: Date.now(),
                  operation: event.operation,
                  identity: event.identity,
                  requestId: event.metrics.requestId,
                  durationMs: event.metrics.durationMs,
                  firstTokenMs: event.metrics.firstTokenMs,
                  usage: event.usage,
                  finishReason: event.finishReason,
                  error: event.error,
                });
              },
            },
          ]
        : undefined,
    },
  );
  // 热切换时复用已有 plan/staging，避免丢失在途计划与暂存改动
  const planSession =
    reuseAgent?.getPlanSession() ??
    (planGateEnabled ? new PlanSession() : undefined);
  const planGate = reuseAgent
    ? undefined
    : planGateEnabled && planSession
      ? createPlanGate(planSession, {
          enabled: true,
          requirePlanFor: planGateConfig?.requirePlanFor,
          defaultBudget: planGateConfig?.defaultBudget,
          microEditExempt: planGateConfig?.microEditExempt,
          microEditMaxTokens: planGateConfig?.microEditMaxTokens,
        })
      : null;

  const stagingStore = mode === 'plan'
    ? undefined
    : reuseAgent
    ? reuseAgent.getStagingStore()
    : stagingReviewEnabled
      ? new StagingStore()
      : undefined;
  const stagingWorkspace = mode === 'plan'
    ? undefined
    : reuseAgent
    ? reuseAgent.getStagingWorkspace()
    : stagingStore
      ? new StagingWorkspace(stagingStore)
      : undefined;

  // Agent 在构造后回填；loadTools 通过闭包激活工具
  let agentRef: CottageAgent | null = reuseAgent ?? null;

  const deferredByName = new Map<string, CottageTool>();

  // 流式工具执行上下文：先于脚本桥建好，供 cottage.* 子调用归属宿主 runScript
  const toolStreamContext: ToolStreamContext = {
    cottageServiceClient: options.cottageServiceClient,
    cottageServiceCapabilities: options.cottageServiceCapabilities,
  };

  // 统一工具执行器：script / manual 来源共用同一治理管线；
  // 依赖全用 lazy getter，规避组装顺序与 reuseAgent 热切换不重建闸门的问题
  // 手工调用目录：已挂载（含 MCP，按名前缀分组）+ 延后目录（未 loadTools 也可手工调）
  const listInvokableCatalog = (): ToolCatalogEntry[] => {
    const entries: ToolCatalogEntry[] = [];
    const seen = new Set<string>();
    for (const tool of agentRef?.getMountedTools() ?? []) {
      seen.add(tool.name);
      entries.push({
        name: tool.name,
        description: tool.description,
        group: tool.name.startsWith('mcp__') ? 'mcp' : 'mounted',
        schema: tool.schema as ToolCatalogEntry['schema'],
      });
    }
    for (const [name, tool] of deferredByName) {
      if (seen.has(name)) continue;
      seen.add(name);
      entries.push({
        name,
        description: tool.description,
        group: 'deferred',
        schema: tool.schema as ToolCatalogEntry['schema'],
      });
    }
    return entries;
  };

  const toolExecutor =
    reuseAgent?.getToolExecutor() ??
    createUnifiedToolExecutor({
      getTool: (name) =>
        agentRef?.getToolByName(name) ?? deferredByName.get(name),
      getPolicyGate: () => agentRef?.getPolicyGate(),
      getPlanGate: () => agentRef?.getPlanGate(),
      getPlanSession: () => agentRef?.getPlanSession(),
      getPlanToolGuard: () => agentRef?.getPlanToolGuard(),
      getDoomLoopDetector: () => agentRef?.getDoomLoopDetector(),
      getTraceRecorder: () => agentRef?.getTraceRecorder() ?? null,
      sessionId: options.sessionId,
      listTools: listInvokableCatalog,
    });

  // cottage.* SDK 桥：所有子调用必须回到当前会话的统一工具执行器。
  const scriptToolInvoker = createScriptToolInvoker({
    getExecutor: () => agentRef?.getToolExecutor(),
    getParentCallId: () => toolStreamContext.currentCallId,
  });
  toolStreamContext.scriptToolInvoker = scriptToolInvoker;

  // 文件工具：核心始终绑定；低频工具延后，经 loadTools 激活
  const { core: coreFileTools, deferred: deferredFileTools } = partitionFileTools(
    createFileCottageTools(
      options.onWorkspaceMutate,
      stagingWorkspace ?? undefined,
      scriptToolInvoker,
    ),
  );

  for (const t of deferredFileTools) {
    deferredByName.set(t.name, t);
  }

  let tools: CottageTool[] = [
    ...coreFileTools,
    ...createWebCottageTools({
      searchSource,
      thirdPartyProvider,
      thirdPartyApiKey,
      cottageServiceEngine,
      cottageService: options.cottageServiceClient,
      cottageServiceCapabilities: options.cottageServiceCapabilities,
    }),
    createAskUserCottageTool(options.sessionId),
    createLoadToolsTool({
      deferredByName,
      onActivate: (activated) => {
        agentRef?.activateTools(activated);
      },
      getActiveNames: () => agentRef?.getActiveToolNames() ?? new Set(),
    }),
  ];

  if (planGateEnabled && planSession) {
    tools.push(
      createSubmitPlanTool(planSession, {
        requireApproval: planGateConfig?.requireApproval !== false,
        sessionId: options.sessionId,
      }),
    );
  }

  // 附件工具：vision 功能开启即注册保存工具；看图工具还要求当前模型支持图片输入（热切换时随 applyRuntime 重算）
  if (cottageConfig.vision?.enabled !== false) {
    tools.push(
      createSaveChatAttachmentTool(
        () =>
          (agentRef?.getChatHistory() ?? []).flatMap(
            (m) => m.attachments ?? [],
          ),
        options.onWorkspaceMutate,
      ),
    );
    const visionModelMeta = getCachedProviderModels(
      providerId,
      true,
      secret.baseUrl,
    )?.find(
      (m) => m.id === config.model,
    );
    const modelCapabilities = resolveCottageModelCapabilities(
      config,
      visionModelMeta,
    );
    if (
      cottageConfig.vision?.requireModelCapability === false ||
      supportsVisionInput(modelCapabilities)
    ) {
      tools.push(createViewImageTool());
    }
  }

  // 领域能力包（按 enabledTools 启用）：办公 / 编程 / 数据分析 / 网页自动化 / PDF / 图表 / 深度研究
  tools.push(
    ...createBuiltinPackTools({
      enabledTools,
      onWorkspaceMutate: options.onWorkspaceMutate,
      cottageService: options.cottageServiceClient,
      cottageServiceCapabilities: options.cottageServiceCapabilities,
      cottageServiceServerCapabilities: options.cottageServiceServerCapabilities,
    }),
  );

  if (
    __COTTAGE_INCLUDE_HIDDEN_FEATURES__ &&
    mode === 'task' &&
    options.taskId
  ) {
    tools.push(
      ...createTaskCottageTools(options.taskId, options.taskSignals, {
        child: options.isSubtask,
        onDispatchSubtask: options.isSubtask
          ? undefined
          : options.onDispatchSubtask,
      }),
    );
  }

  if (chatPlanBundle?.modeTools.length) {
    tools.push(...chatPlanBundle.modeTools);
  }
  // [HIDDEN] 编排模式自动入口已下线，改由 suggestPlanMode 承担；代码保留。详 docs/hidden-features.md
  // else if (mode === 'chat' && options.onStartOrchestration) {
  //   tools.push(
  //     createStartOrchestrationTool({
  //       onStart: options.onStartOrchestration,
  //     }),
  //   );
  // }

  // MCP 工具注入（外部工具保持立即可用）
  if (cottageConfig.mcp?.enabled && cottageConfig.mcp.servers?.length) {
    const mcpTools = mcpRegistry.getAllTools();
    if (mcpTools.length) {
      tools.push(...mcpTools);
    }
  }

  if (options.extraTools?.length) {
    tools.push(...options.extraTools);
  }

  if (options.readOnly) {
    tools = tools.filter((tool) => toolRisk(tool.name) === 'read');
    for (const [name, tool] of [...deferredByName.entries()]) {
      if (toolRisk(tool.name) !== 'read') deferredByName.delete(name);
    }
  }

  if (providerId === 'moonshot') {
    tools = adaptToolsForMoonshot(tools);
    for (const [name, deferredTool] of [...deferredByName.entries()]) {
      deferredByName.set(name, adaptToolsForMoonshot([deferredTool])[0]!);
    }
  }

  const moonshotThinking = shouldApplyMoonshotThinking(
    providerId,
    resolveLlmBaseUrl(
      providerId as LlmProviderId,
      config.baseUrl,
      secret?.baseUrl,
    ),
  );

  const configuredApproval = cottageConfig.platform?.governance?.requireApprovalFor ?? [];
  const requireApprovalFor = mode === 'plan'
    ? [
        ...new Set([
          // 已批准计划中的普通文件写入由路径范围、文件预算、检查点和 mutation journal
          // 共同约束，不再按文件逐次确认；外部与破坏性操作仍保持单独审批。
          ...configuredApproval.filter((risk) => risk !== 'write'),
          'external' as const,
          'destructive' as const,
        ]),
      ]
    : configuredApproval;
  const policyGate = createPolicyGate({
    requireApprovalFor,
    requireApprovalForTools:
      mode === 'plan'
        ? ['rename', 'move', ...tools.filter((tool) => tool.name.startsWith('mcp__')).map((tool) => tool.name)]
        : [],
    sessionId: options.sessionId,
  });

  if (reuseAgent) {
    reuseAgent.applyRuntime({
      mode,
      systemPrompt,
      model,
      modelConfig: config,
      resolveExpectedModelConfig,
      tools,
      moonshotThinking,
      planToolGuard: chatPlanBundle?.planToolGuard,
      policyGate,
    });
    return reuseAgent;
  }

  const eventBus = new EventBus();
  if (traceRecorder) {
    traceRecorder.attach(eventBus);
  }

  const agent = new CottageAgent({
    systemPrompt,
    model,
    tools,
    history: options.chat_history,
    llmHistory: options.llm_history,
    welcomeMessage: options.welcome_message,
    moonshotThinking,
    modelConfig: config,
    resolveExpectedModelConfig,
    policyGate,
    planGate: planGate ?? undefined,
    planSession: planGateEnabled ? planSession : undefined,
    planToolGuard: chatPlanBundle?.planToolGuard,
    toolExecutor,
    stagingStore: stagingStore ?? undefined,
    stagingWorkspace: stagingWorkspace ?? undefined,
    retryOptions: cottageConfig.llmRetry,
    traceRecorder,
    mode: mode,
    toolStreamContext,
    eventBus,
    sessionId: options.sessionId,
    onInFlightUpdate: options.onInFlightUpdate,
  });
  agentRef = agent;
  return agent;
};
