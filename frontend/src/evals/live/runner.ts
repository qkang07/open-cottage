import { CottageAgent } from '../../agent/CottageAgent';
import type { CottageModelDriver } from '../../agent/runtime/model';
import type { CottageTool } from '../../agent/runtime/tool';
import { createUnifiedToolExecutor } from '../../agent/toolInvocation';
import type { LlmModelConfig } from '../../config/constants';
import { EventBus } from '../../platform/events';
import { changedEvalPaths, createEvalWorkspaceTools, EvalMemoryWorkspace } from '../inMemoryWorkspace';
import { createEvalTraceRecorder } from '../runtime';
import type { LiveEvalCase } from './cases';
import { LIVE_EVAL_CASES, selectLiveEvalCases } from './cases';
import { runPlanLiveEvalCase } from './planRunner';
import type {
  LiveEvalCaseReport,
  LiveEvalConfig,
  LiveEvalReport,
  LiveEvalModelCallRecord,
  LiveEvalUsageTotals,
} from './types';

const deltaUsage = (
  before: LiveEvalUsageTotals,
  after: LiveEvalUsageTotals,
): LiveEvalUsageTotals => ({
  modelCalls: after.modelCalls - before.modelCalls,
  durationMs: after.durationMs - before.durationMs,
  inputTokens: (after.inputTokens ?? 0) - (before.inputTokens ?? 0),
  outputTokens: (after.outputTokens ?? 0) - (before.outputTokens ?? 0),
  totalTokens: (after.totalTokens ?? 0) - (before.totalTokens ?? 0),
  reasoningTokens: (after.reasoningTokens ?? 0) - (before.reasoningTokens ?? 0),
  cachedInputTokens: (after.cachedInputTokens ?? 0) - (before.cachedInputTokens ?? 0),
});

const responseText = (agent: CottageAgent): string =>
  [...agent.getChatHistory()].reverse().find((message) => message.role === 'assistant')?.content ?? '';

export interface LiveEvalWorkspaceSession {
  tools: CottageTool[];
  snapshot(): Promise<Record<string, string>>;
}

export type LiveEvalWorkspaceFactory = (
  item: LiveEvalCase,
) => Promise<LiveEvalWorkspaceSession>;

const createMemoryWorkspaceSession: LiveEvalWorkspaceFactory = async (item) => {
  const workspace = new EvalMemoryWorkspace(item.workspace);
  return {
    tools: createEvalWorkspaceTools(workspace),
    snapshot: async () => workspace.snapshot(),
  };
};

const runCase = async (
  item: LiveEvalCase,
  config: LiveEvalConfig,
  model: CottageModelDriver,
  usageSnapshot: () => LiveEvalUsageTotals,
  callsSnapshot: (() => LiveEvalModelCallRecord[]) | undefined,
  setModelPhase: ((phase: string) => void) | undefined,
  createWorkspace: LiveEvalWorkspaceFactory,
): Promise<LiveEvalCaseReport> => {
  const workspace = await createWorkspace(item);
  let initialWorkspace = await workspace.snapshot();
  const trace = createEvalTraceRecorder();
  const eventBus = new EventBus();
  const tools = workspace.tools;
  let agent: CottageAgent | null = null;
  const executor = createUnifiedToolExecutor({
    getTool: (name) => agent?.getToolByName(name),
    getPolicyGate: () => async () => ({ allowed: true }),
    getDoomLoopDetector: () => agent?.getDoomLoopDetector(),
    getTraceRecorder: () => trace.recorder,
    sessionId: `live-eval:${item.id}`,
  });
  const modelConfig: LlmModelConfig = {
    provider: config.provider,
    connectionId: config.connectionId,
    model: config.model,
    maxTokens: config.budget.maxOutputTokens,
    ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
  };
  const beforeUsage = usageSnapshot();
  const beforeCallCount = callsSnapshot?.().length ?? 0;
  let error: string | undefined;
  let finalWorkspace: Record<string, string>;
  let response = '';
  let toolCalls: Array<{ name: string; status: string }> = [];
  let plan: LiveEvalCaseReport['plan'];
  if (item.mode === 'plan') {
    try {
      const result = await runPlanLiveEvalCase({
        item,
        model,
        modelConfig,
        workspace,
        onModelPhase: setModelPhase,
      });
      initialWorkspace = result.initialWorkspace;
      finalWorkspace = result.finalWorkspace;
      response = result.response;
      toolCalls = result.toolCalls;
      plan = result.trace;
      error = result.error;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      finalWorkspace = await workspace.snapshot();
    }
  } else {
    agent = new CottageAgent({
      systemPrompt:
        '你正在运行隔离的 Agent 能力评测。严格遵循用户要求；只使用提供的评测工作区工具。',
      model,
      modelConfig,
      tools,
      toolExecutor: executor,
      policyGate: async () => ({ allowed: true }),
      traceRecorder: trace.recorder,
      eventBus,
      mode: 'chat',
      enableConversationCheckpoints: false,
      prewarmModelCatalog: false,
    });
    try {
      setModelPhase?.(`chat:${item.id}`);
      await agent.next(item.prompt);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    finalWorkspace = await workspace.snapshot();
    response = responseText(agent);
    toolCalls = trace.events
      .filter((event) => event.type === 'tool_call')
      .map((event) => ({ name: event.name, status: event.status }));
  }
  const usage = deltaUsage(beforeUsage, usageSnapshot());
  const modelCallDetails = callsSnapshot?.().slice(beforeCallCount);
  const checks = item.evaluate({ response, initialWorkspace, finalWorkspace, toolCalls, plan });
  const totalWeight = checks.reduce((sum, result) => sum + result.weight, 0);
  const score = totalWeight > 0
    ? checks.reduce((sum, result) => sum + (result.passed ? result.weight : 0), 0) / totalWeight
    : 0;
  return {
    caseId: item.id,
    title: item.title,
    tags: [...item.tags],
    passed: !error && score >= config.minimumScore,
    score,
    checks,
    usage,
    ...(modelCallDetails?.length ? { modelCallDetails } : {}),
    toolCalls,
    changedPaths: changedEvalPaths(initialWorkspace, finalWorkspace),
    responseExcerpt: response.replace(/\s+/g, ' ').trim().slice(0, 500),
    ...(plan ? { plan } : {}),
    ...(error ? { error } : {}),
  };
};

export const runLiveEvalSuite = async (input: {
  config: LiveEvalConfig;
  model: CottageModelDriver;
  usageSnapshot: () => LiveEvalUsageTotals;
  callsSnapshot?: () => LiveEvalModelCallRecord[];
  setModelPhase?: (phase: string) => void;
  getBudgetViolation?: () => string | null;
  createWorkspace?: LiveEvalWorkspaceFactory;
  onCaseStart?: (item: LiveEvalCase, index: number, total: number) => void;
  onCaseComplete?: (
    report: LiveEvalCaseReport,
    index: number,
    total: number,
  ) => void;
}): Promise<LiveEvalReport> => {
  const selected = selectLiveEvalCases(LIVE_EVAL_CASES, {
    caseIds: input.config.caseIds,
    tags: input.config.tags,
  }).slice(0, input.config.budget.maxCases);
  if (selected.length === 0) throw new Error('没有真实模型 case 匹配筛选条件');
  const reports: LiveEvalCaseReport[] = [];
  const createWorkspace = input.createWorkspace ?? createMemoryWorkspaceSession;
  for (const [index, item] of selected.entries()) {
    input.onCaseStart?.(item, index, selected.length);
    const report = await runCase(
      item,
      input.config,
      input.model,
      input.usageSnapshot,
      input.callsSnapshot,
      input.setModelPhase,
      createWorkspace,
    );
    const violation = input.getBudgetViolation?.();
    if (violation) {
      report.passed = false;
      report.error = violation;
    }
    reports.push(report);
    input.onCaseComplete?.(report, index, selected.length);
    if (violation) break;
  }
  const usage = input.usageSnapshot();
  const identity = input.model.getRuntimeIdentity();
  const passedCount = reports.filter((report) => report.passed).length;
  const estimatedCost =
    input.config.inputPricePerMillion !== undefined ||
    input.config.outputPricePerMillion !== undefined
      ? ((usage.inputTokens ?? 0) / 1_000_000) * (input.config.inputPricePerMillion ?? 0) +
        ((usage.outputTokens ?? 0) / 1_000_000) * (input.config.outputPricePerMillion ?? 0)
      : undefined;
  return {
    schemaVersion: 1,
    kind: 'live-model-eval',
    generatedAt: new Date().toISOString(),
    dryRun: false,
    model: {
      provider: input.config.provider,
      model: input.config.model,
      connectionId: input.config.connectionId,
      ...(identity.baseUrl ? { baseUrl: identity.baseUrl } : {}),
    },
    budget: input.config.budget,
    selection: { caseIds: input.config.caseIds, tags: input.config.tags },
    summary: {
      passed: passedCount === reports.length && reports.length === selected.length,
      caseCount: reports.length,
      passedCount,
      averageScore: reports.reduce((sum, report) => sum + report.score, 0) / reports.length,
      usage,
      ...(estimatedCost !== undefined ? { estimatedCost } : {}),
    },
    cases: reports,
  };
};
