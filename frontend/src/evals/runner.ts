import { CottageAgent } from '../agent/CottageAgent';
import { createReplayModelController } from '../agent/runtime/replay';
import type { CottageModelMessage } from '../agent/runtime/model';
import { createUnifiedToolExecutor } from '../agent/toolInvocation';
import { EventBus } from '../platform/events';
import {
  approvePendingStagedEntry,
  deferPendingStagedApproval,
  discardPendingStagedEntry,
  getPendingStagedApproval,
} from '../platform/staging';
import { createPlanToolGuard } from '../plan/scopeGate';
import type { PlanDefinition, PlanRun } from '../plan/types';
import { parseSessionEventsText, projectSessionState } from '../session/eventLog';
import { wrapEvalToolsWithFaults } from './faultInjector';
import { changedEvalPaths, createEvalWorkspaceTools, EvalMemoryWorkspace } from './inMemoryWorkspace';
import { normalizeEvalArtifact } from './normalize';
import { createEvalPolicyScript, createEvalTraceRecorder } from './runtime';
import {
  createEvalStagingRuntime,
  createEvalStagingTools,
  EvalStagingPersistence,
} from './staging';
import type {
  AgentEvalReport,
  AgentEvalScenario,
  AgentEvalSuiteReport,
  EvalAssertionResult,
  EvalEventExpectation,
  EvalModelRequestArtifact,
  EvalRecordedTraceEvent,
  EvalRecordedUiEvent,
} from './types';

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const messageText = (message: CottageModelMessage): string => {
  if (typeof message.content === 'string') return message.content;
  return message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
};

const matchesFields = (
  event: Record<string, unknown>,
  fields: Record<string, unknown> | undefined,
): boolean =>
  !fields ||
  Object.entries(fields).every(([key, expected]) =>
    JSON.stringify(event[key]) === JSON.stringify(expected),
  );

const checkEventExpectation = (
  events: readonly unknown[],
  expected: EvalEventExpectation,
): { passed: boolean; actual: number } => {
  const actual = events.filter((event) => {
    if (!event || typeof event !== 'object') return false;
    const record = event as Record<string, unknown>;
    return record.type === expected.type && matchesFields(record, expected.fields);
  }).length;
  return { passed: actual === (expected.count ?? 1), actual };
};

const addAssertion = (
  assertions: EvalAssertionResult[],
  name: string,
  passed: boolean,
  detail?: string,
) => {
  assertions.push({ name, passed, ...(detail ? { detail } : {}) });
};

const toRequestArtifacts = (
  calls: ReturnType<typeof createReplayModelController>['calls'],
): EvalModelRequestArtifact[] =>
  calls.map((call) => ({
    operation: call.operation,
    messages: call.request.messages.map((message) => ({ ...message })),
    toolNames:
      'tools' in call.request
        ? (call.request.tools ?? []).map((tool) => tool.name)
        : [],
  }));

const assertScenario = (
  scenario: AgentEvalScenario,
  input: {
    assertions: EvalAssertionResult[];
    initialWorkspace: Record<string, string>;
    finalWorkspace: Record<string, string>;
    changedPaths: string[];
    trace: EvalRecordedTraceEvent[];
    uiEvents: EvalRecordedUiEvent[];
    requests: EvalModelRequestArtifact[];
    approvals: AgentEvalReport['artifacts']['approvals'];
    history: ReturnType<CottageAgent['getChatHistory']>;
    pendingStagedPaths: string[];
    persistedStagedPaths: string[];
    planBlocks: string[];
  },
) => {
  const expected = scenario.expected;
  if (!expected) return;

  for (const [path, content] of Object.entries(expected.workspace?.files ?? {})) {
    addAssertion(
      input.assertions,
      `workspace file: ${path}`,
      input.finalWorkspace[path] === content,
      input.finalWorkspace[path] === content
        ? undefined
        : `期望 ${JSON.stringify(content)}，实际 ${JSON.stringify(input.finalWorkspace[path])}`,
    );
  }
  for (const path of expected.workspace?.absent ?? []) {
    addAssertion(
      input.assertions,
      `workspace absent: ${path}`,
      !(path in input.finalWorkspace),
      path in input.finalWorkspace ? '文件仍然存在' : undefined,
    );
  }
  if (expected.staging?.pendingPaths) {
    const expectedPaths = [...expected.staging.pendingPaths].sort();
    addAssertion(
      input.assertions,
      'staging pending paths',
      JSON.stringify(input.pendingStagedPaths) === JSON.stringify(expectedPaths),
      `期望 ${JSON.stringify(expectedPaths)}，实际 ${JSON.stringify(input.pendingStagedPaths)}`,
    );
  }
  if (expected.staging?.persistedPaths) {
    const expectedPaths = [...expected.staging.persistedPaths].sort();
    addAssertion(
      input.assertions,
      'staging persisted paths',
      JSON.stringify(input.persistedStagedPaths) === JSON.stringify(expectedPaths),
      `期望 ${JSON.stringify(expectedPaths)}，实际 ${JSON.stringify(input.persistedStagedPaths)}`,
    );
  }
  if (expected.workspace?.changedPaths) {
    const expectedPaths = [...expected.workspace.changedPaths].sort();
    addAssertion(
      input.assertions,
      'workspace changed paths',
      JSON.stringify(input.changedPaths) === JSON.stringify(expectedPaths),
      `期望 ${JSON.stringify(expectedPaths)}，实际 ${JSON.stringify(input.changedPaths)}`,
    );
  }

  for (const event of expected.trace ?? []) {
    const result = checkEventExpectation(input.trace, event);
    addAssertion(
      input.assertions,
      `trace ${event.type}`,
      result.passed,
      `期望 ${event.count ?? 1}，实际 ${result.actual}`,
    );
  }
  for (const event of expected.uiEvents ?? []) {
    const result = checkEventExpectation(input.uiEvents, event);
    addAssertion(
      input.assertions,
      `ui event ${event.type}`,
      result.passed,
      `期望 ${event.count ?? 1}，实际 ${result.actual}`,
    );
  }

  if (expected.requests?.count !== undefined) {
    addAssertion(
      input.assertions,
      'model request count',
      input.requests.length === expected.requests.count,
      `期望 ${expected.requests.count}，实际 ${input.requests.length}`,
    );
  }
  const requestText = input.requests
    .flatMap((request) => request.messages.map(messageText))
    .join('\n');
  for (const text of expected.requests?.messageIncludes ?? []) {
    addAssertion(
      input.assertions,
      `model request includes: ${text}`,
      requestText.includes(text),
      requestText.includes(text) ? undefined : '所有模型请求均未包含该文本',
    );
  }
  const availableTools = new Set(input.requests.flatMap((request) => request.toolNames));
  for (const toolName of expected.requests?.toolNamesInclude ?? []) {
    addAssertion(
      input.assertions,
      `model request exposes tool: ${toolName}`,
      availableTools.has(toolName),
      availableTools.has(toolName) ? undefined : '模型请求未暴露该工具',
    );
  }

  for (const approval of expected.approvals ?? []) {
    const actual = input.approvals.filter(
      (request) =>
        request.toolName === approval.toolName &&
        (approval.allowed === undefined || request.decision.allowed === approval.allowed),
    ).length;
    addAssertion(
      input.assertions,
      `approval ${approval.toolName}`,
      actual === (approval.count ?? 1),
      `期望 ${approval.count ?? 1}，实际 ${actual}`,
    );
  }

  const finalAssistant = [...input.history]
    .reverse()
    .find((message) => message.role === 'assistant');
  for (const text of expected.finalResponseIncludes ?? []) {
    addAssertion(
      input.assertions,
      `final response includes: ${text}`,
      finalAssistant?.content.includes(text) === true,
      finalAssistant?.content.includes(text) ? undefined : '最终助手消息未包含该文本',
    );
  }
  for (const text of expected.planBlocksInclude ?? []) {
    addAssertion(
      input.assertions,
      `plan block includes: ${text}`,
      input.planBlocks.some((reason) => reason.includes(text)),
      input.planBlocks.some((reason) => reason.includes(text))
        ? undefined
        : `计划阻止原因中未找到 ${JSON.stringify(text)}`,
    );
  }

  const toolCalls = input.trace.filter((event) => event.type === 'tool_call').length;
  if (expected.limits?.maxModelCalls !== undefined) {
    addAssertion(
      input.assertions,
      'model call limit',
      input.requests.length <= expected.limits.maxModelCalls,
      `上限 ${expected.limits.maxModelCalls}，实际 ${input.requests.length}`,
    );
  }
  if (expected.limits?.maxToolCalls !== undefined) {
    addAssertion(
      input.assertions,
      'tool call limit',
      toolCalls <= expected.limits.maxToolCalls,
      `上限 ${expected.limits.maxToolCalls}，实际 ${toolCalls}`,
    );
  }
};

export const runAgentEvalScenario = async (
  scenario: AgentEvalScenario,
): Promise<AgentEvalReport> => {
  const startedAt = Date.now();
  const assertions: EvalAssertionResult[] = [];
  const memoryWorkspace = new EvalMemoryWorkspace(scenario.workspace);
  const initialWorkspace = memoryWorkspace.snapshot();
  const traceCapture = createEvalTraceRecorder();
  const policy = createEvalPolicyScript(scenario.approvalDecisions);
  const replay = createReplayModelController({
    streams: scenario.model.streams,
    identity: scenario.model.identity,
  });
  const eventBus = new EventBus();
  const uiEvents: EvalRecordedUiEvent[] = [];
  eventBus.subscribe((event) => uiEvents.push(event));
  const planBlocks: string[] = [];
  const evalSessionId = `eval:${scenario.id}`;
  const stagingPersistence = new EvalStagingPersistence();

  const planContext = scenario.planGuard
    ? (() => {
        const now = Date.now();
        const definition: PlanDefinition = {
          schema: 1,
          id: `eval-plan:${scenario.id}`,
          revision: 1,
          sessionId: `eval:${scenario.id}`,
          workspaceId: `eval-workspace:${scenario.id}`,
          goal: scenario.title,
          requirements: [],
          design: 'Deterministic eval fixture',
          allowedPathPrefixes: scenario.planGuard.allowedPathPrefixes,
          steps: [
            {
              id: 'step-1',
              title: 'Eval step',
              detail: scenario.prompt ?? scenario.title,
              kind: scenario.planGuard.currentStepKind ?? 'implementation',
              dependsOn: [],
              allowedPathPrefixes: scenario.planGuard.allowedPathPrefixes,
              acceptance: [],
            },
          ],
          finalAcceptance: [],
          verificationCapabilitySnapshot: [],
          budgets: {
            maxTurns: 10,
            maxChangedFiles: scenario.planGuard.maxChangedFiles ?? 10,
            maxExternalCalls: scenario.planGuard.maxExternalCalls ?? 5,
            maxStepRetries: 2,
          },
          createdAt: now,
          updatedAt: now,
        };
        const run: PlanRun = {
          schema: 1,
          planId: definition.id,
          sessionId: definition.sessionId,
          workspaceId: definition.workspaceId,
          approvedRevision: definition.revision,
          status: 'running',
          stepStates: {
            'step-1': {
              status: 'running',
              verificationState: 'unverified',
              attempts: 1,
              changedFiles: [],
              evidence: [],
              checkResults: [],
            },
          },
          currentStepId: 'step-1',
          changedFiles: scenario.planGuard.changedFiles ?? [],
          operatorInstructions: [],
          counters: {
            turns: 0,
            changedFiles: scenario.planGuard.changedFiles?.length ?? 0,
            externalCalls: scenario.planGuard.externalCalls ?? 0,
          },
          createdAt: now,
          updatedAt: now,
        };
        return { definition, run };
      })()
    : null;
  const planToolGuard = planContext
    ? createPlanToolGuard({
        getContext: () => planContext,
        onBlocked: (reason) => {
          planBlocks.push(reason);
        },
        onMutation: (report) => {
          const paths = [
            ...report.created.map((entry) => entry.path),
            ...report.modified.map((entry) => entry.path),
            ...report.deleted.map((entry) => entry.path),
            ...report.moved.flatMap((entry) => [entry.from.path, entry.to.path]),
          ];
          planContext.run.changedFiles = [
            ...new Set([...planContext.run.changedFiles, ...paths]),
          ];
          planContext.run.counters.changedFiles = planContext.run.changedFiles.length;
        },
        onExternalCall: () => {
          planContext.run.counters.externalCalls += 1;
        },
      })
    : undefined;

  let activeStagingStore: ReturnType<typeof createEvalStagingRuntime>['store'] | null = null;
  const createAgent = (
    history?: Parameters<CottageAgent['loadHistory']>[0],
    llmHistory?: Parameters<CottageAgent['loadHistory']>[1],
  ): CottageAgent => {
    let createdAgent: CottageAgent | null = null;
    const stagingRuntime = scenario.staging?.enabled
      ? createEvalStagingRuntime(memoryWorkspace, stagingPersistence)
      : null;
    activeStagingStore = stagingRuntime?.store ?? null;
    const scenarioTools = wrapEvalToolsWithFaults(
      [
        ...(stagingRuntime
          ? createEvalStagingTools(stagingRuntime.stagingWorkspace)
          : createEvalWorkspaceTools(memoryWorkspace)),
        ...(scenario.extraTools ?? []),
      ],
      scenario.faults,
    );
    const toolsByName = new Map(scenarioTools.map((tool) => [tool.name, tool]));
    const toolExecutor = createUnifiedToolExecutor({
      getTool: (name) => createdAgent?.getToolByName(name) ?? toolsByName.get(name),
      getPolicyGate: () => policy.gate,
      getPlanToolGuard: () => planToolGuard,
      getDoomLoopDetector: () => createdAgent?.getDoomLoopDetector(),
      getTraceRecorder: () => traceCapture.recorder,
      sessionId: evalSessionId,
    });
    createdAgent = new CottageAgent({
      systemPrompt:
        scenario.systemPrompt ?? 'You are running a deterministic regression scenario.',
      model: replay.driver,
      tools: scenarioTools,
      history,
      llmHistory,
      policyGate: policy.gate,
      planToolGuard,
      toolExecutor,
      traceRecorder: traceCapture.recorder,
      eventBus,
      mode: scenario.mode ?? 'chat',
      sessionId: evalSessionId,
      enableConversationCheckpoints: false,
      stagingStore: stagingRuntime?.store,
      stagingWorkspace: stagingRuntime?.stagingWorkspace,
      stagingPersistence,
    });
    return createdAgent;
  };

  let agent: CottageAgent | null = createAgent(scenario.initialHistory);
  let pendingTurn: Promise<void> | null = null;
  const requireAgent = (): CottageAgent => {
    if (!agent) throw new Error('当前没有 Agent；请先执行 restoreAgent');
    return agent;
  };
  const waitForStagedApproval = async () => {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const pending = getPendingStagedApproval(evalSessionId);
      if (pending) return pending;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    throw new Error('等待暂存审批超时');
  };
  const waitForStagingSettled = async () => {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      if (
        !getPendingStagedApproval(evalSessionId) &&
        (activeStagingStore?.isEmpty() ?? true) &&
        stagingPersistence.pendingPaths(evalSessionId).length === 0
      ) return;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    throw new Error('暂存审批未能收敛');
  };

  let runError: string | undefined;
  try {
    const actions = scenario.actions ?? (
      scenario.prompt !== undefined
        ? [{ type: 'send' as const, text: scenario.prompt }]
        : []
    );
    if (actions.length === 0) throw new Error('场景必须提供 prompt 或 actions');
    for (const action of actions) {
      switch (action.type) {
        case 'send': {
          if (pendingTurn) throw new Error('上一回合仍在运行');
          const turn = requireAgent().next(action.text);
          if (action.waitForCompletion === false) pendingTurn = turn;
          else await turn;
          break;
        }
        case 'awaitTurn':
          if (!pendingTurn) throw new Error('没有等待中的回合');
          await pendingTurn;
          pendingTurn = null;
          break;
        case 'resolveApproval':
          await policy.resolvePending(action);
          break;
        case 'abort':
          requireAgent().abort();
          break;
        case 'abortAfterStaged':
          await waitForStagedApproval();
          requireAgent().abort();
          break;
        case 'approveStaged': {
          const pending = await waitForStagedApproval();
          const paths = action.paths ?? pending.store.pendingEntriesList().map((e) => e.path);
          for (const path of paths) approvePendingStagedEntry(path, undefined, evalSessionId);
          await waitForStagingSettled();
          break;
        }
        case 'discardStaged': {
          const pending = await waitForStagedApproval();
          const paths = action.paths ?? pending.store.pendingEntriesList().map((e) => e.path);
          for (const path of paths) discardPendingStagedEntry(path, evalSessionId);
          await waitForStagingSettled();
          break;
        }
        case 'deferStaged':
          await waitForStagedApproval();
          deferPendingStagedApproval(evalSessionId);
          break;
        case 'destroyAgent':
          if (pendingTurn) throw new Error('不能销毁仍在运行的 Agent');
          agent = null;
          break;
        case 'restoreAgent': {
          if (pendingTurn) throw new Error('不能在回合运行中恢复 Agent');
          const serialized = traceCapture.events
            .map((event) => JSON.stringify(event))
            .join('\n');
          const restoredEvents = action.corruptEventLogTail
            ? parseSessionEventsText(`${serialized}\n{"broken":`)
            : traceCapture.events;
          const projected = projectSessionState(restoredEvents);
          agent = createAgent(projected.transcript, projected.llmHistory);
          await agent.restoreStagedReviewIfNeeded();
          break;
        }
      }
    }
    if (pendingTurn) {
      if (policy.pendingCount() > 0) {
        throw new Error('场景结束时仍有审批和回合处于等待状态');
      }
      await pendingTurn;
      pendingTurn = null;
    }
  } catch (error) {
    runError = errorText(error);
    agent?.abort();
  }

  try {
    if (scenario.model.assertExhausted !== false) replay.assertExhausted();
    policy.assertExhausted();
  } catch (error) {
    addAssertion(assertions, 'script exhausted', false, errorText(error));
  }

  const finalWorkspace = memoryWorkspace.snapshot();
  const changedPaths = changedEvalPaths(initialWorkspace, finalWorkspace);
  const requests = toRequestArtifacts(replay.calls);
  const history = agent?.getChatHistory() ?? [];
  const pendingStagedPaths = activeStagingStore?.entriesList().map((entry) => entry.path) ?? [];
  const persistedStagedPaths = stagingPersistence.pendingPaths(evalSessionId);

  addAssertion(
    assertions,
    'agent reached terminal state',
    Boolean(agent && !agent.busy && !agent.isInFlight()),
    agent && !agent.busy && !agent.isInFlight()
      ? undefined
      : 'Agent 不存在或仍处于 busy/in-flight',
  );
  const turnStarts = traceCapture.events.filter((event) => event.type === 'turn_start').length;
  const turnEnds = traceCapture.events.filter((event) => event.type === 'turn_end').length;
  addAssertion(
    assertions,
    'turn start/end balanced',
    turnStarts === turnEnds,
    `turn_start=${turnStarts}, turn_end=${turnEnds}`,
  );
  if (runError) addAssertion(assertions, 'scenario execution', false, runError);

  assertScenario(scenario, {
    assertions,
    initialWorkspace,
    finalWorkspace,
    changedPaths,
    trace: traceCapture.events,
    uiEvents,
    requests,
    approvals: policy.requests,
    history,
    pendingStagedPaths,
    persistedStagedPaths,
    planBlocks,
  });

  return {
    schemaVersion: 1,
    scenarioId: scenario.id,
    title: scenario.title,
    ...(scenario.tags?.length ? { tags: [...scenario.tags] } : {}),
    ...(scenario.regression ? { regression: { ...scenario.regression } } : {}),
    passed: assertions.every((assertion) => assertion.passed),
    durationMs: Date.now() - startedAt,
    assertions,
    artifacts: {
      initialWorkspace,
      finalWorkspace,
      changedPaths,
      trace: normalizeEvalArtifact(traceCapture.events) as unknown[],
      uiEvents: normalizeEvalArtifact(uiEvents) as unknown[],
      modelRequests: requests,
      approvals: policy.requests,
      planBlocks,
      history,
    },
    ...(runError ? { error: runError } : {}),
  };
};

export const formatAgentEvalReport = (report: AgentEvalReport): string => {
  const lines = [
    `${report.passed ? 'PASS' : 'FAIL'} ${report.scenarioId}: ${report.title}`,
    ...report.assertions.map(
      (assertion) =>
        `${assertion.passed ? '  ✓' : '  ✗'} ${assertion.name}` +
        (assertion.detail ? ` — ${assertion.detail}` : ''),
    ),
  ];
  return lines.join('\n');
};

export const runAgentEvalSuite = async (
  scenarios: readonly AgentEvalScenario[],
): Promise<AgentEvalSuiteReport> => {
  const startedAt = Date.now();
  const reports: AgentEvalReport[] = [];
  // Workspace/tool state is scenario-local; keep execution serial so global Web Locks and
  // future fault injectors cannot leak ordering assumptions across scenarios.
  for (const scenario of scenarios) {
    reports.push(await runAgentEvalScenario(scenario));
  }
  const passedCount = reports.filter((report) => report.passed).length;
  return {
    schemaVersion: 1,
    passed: passedCount === reports.length,
    scenarioCount: reports.length,
    passedCount,
    failedCount: reports.length - passedCount,
    durationMs: Date.now() - startedAt,
    reports,
  };
};
