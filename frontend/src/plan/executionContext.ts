import type { PlanDefinition, PlanRun } from './types';

const MAX_CONTEXT_CHARS = 24_000;
const MAX_LIST_ITEMS = 20;

const boundedText = (value: string, max = 2_000) =>
  value.length <= max ? value : `${value.slice(0, max)}\n[内容已截断]`;

const boundedList = (values: readonly string[], maxItems = MAX_LIST_ITEMS) =>
  values.slice(0, maxItems).map((value) => boundedText(value, 1_000));

const appendSection = (sections: string[], title: string, value: unknown) => {
  const text = `${title}：\n${JSON.stringify(value, null, 2)}`;
  const used = sections.reduce((sum, item) => sum + item.length + 2, 0);
  if (used + text.length <= MAX_CONTEXT_CHARS) sections.push(text);
  else sections.push(`${title}：[超过上下文长度限制，已省略；请依赖批准计划和系统状态，不要猜测]`);
};

export const buildPlanExecutionContext = (input: {
  definition: PlanDefinition;
  run: PlanRun;
  currentStepId?: string;
  operatorInstructions?: readonly string[];
}): string => {
  const { definition, run } = input;
  const currentStepId = input.currentStepId ?? run.currentStepId;
  const currentStep = definition.steps.find((step) => step.id === currentStepId);
  const dependencies = currentStep?.dependsOn.map((id) => {
    const step = definition.steps.find((candidate) => candidate.id === id);
    const state = run.stepStates[id];
    return {
      id,
      title: step?.title ?? id,
      status: state?.status,
      changedFiles: state?.changedFiles ?? [],
      evidence: (state?.evidence ?? []).slice(-10).map((item) => ({
        kind: item.kind,
        summary: boundedText(item.summary, 1_000),
        ...(item.path ? { path: item.path } : {}),
      })),
    };
  }) ?? [];
  const failures = Object.entries(run.stepStates)
    .filter(([, state]) => state.failureReason)
    .slice(-MAX_LIST_ITEMS)
    .map(([stepId, state]) => ({ stepId, reason: boundedText(state.failureReason ?? '', 1_000) }));
  const remainingBudget = {
    turns: Math.max(0, definition.budgets.maxTurns - run.counters.turns),
    changedFiles: Math.max(0, definition.budgets.maxChangedFiles - run.counters.changedFiles),
    externalCalls: Math.max(0, definition.budgets.maxExternalCalls - run.counters.externalCalls),
    stepRetries: currentStepId
      ? Math.max(0, definition.budgets.maxStepRetries - Math.max(0, (run.stepStates[currentStepId]?.attempts ?? 1) - 1))
      : definition.budgets.maxStepRetries,
  };
  const sections = [
    '你正在继续公开 Plan Mode 中已经批准的计划。以下结构化状态来自系统权威状态；不得使用旧 revision、扩大批准范围或虚构验证。',
  ];
  appendSection(sections, '计划身份', {
    planId: definition.id,
    approvedRevision: run.approvedRevision,
    definitionRevision: definition.revision,
    status: run.status,
  });
  appendSection(sections, '目标与设计', {
    goal: boundedText(definition.goal),
    requirements: boundedList(definition.requirements),
    design: boundedText(definition.design, 4_000),
  });
  appendSection(sections, '当前步骤', currentStep
    ? {
        id: currentStep.id,
        title: currentStep.title,
        detail: boundedText(currentStep.detail, 3_000),
        kind: currentStep.kind,
        dependsOn: currentStep.dependsOn,
        allowedPathPrefixes: currentStep.allowedPathPrefixes ?? definition.allowedPathPrefixes,
        acceptance: currentStep.acceptance,
        actualChangedFiles: run.stepStates[currentStep.id]?.changedFiles ?? [],
        attempts: run.stepStates[currentStep.id]?.attempts ?? 0,
      }
    : null);
  appendSection(sections, '依赖证据', dependencies);
  appendSection(sections, '最终验收', definition.finalAcceptance);
  appendSection(sections, '批准时验证能力快照', definition.verificationCapabilitySnapshot);
  appendSection(sections, '失败历史', failures);
  appendSection(sections, '修改与剩余预算', {
    actualChangedFiles: run.changedFiles,
    remainingBudget,
  });
  appendSection(sections, '用户追加指令', boundedList(input.operatorInstructions ?? [], 10));
  const directive = currentStep
    ? '只执行当前步骤。完成后调用 completePlanStep；changedFiles 可省略，系统以 Mutation Journal 的实际记录为准。当前环境没有本地命令执行能力。'
    : '所有实现步骤均已结束。请调用 completePlanRun 汇总最终验证；存在未验证项时不得声称全部完成。';
  const bodyLimit = MAX_CONTEXT_CHARS - directive.length - 2;
  return `${sections.join('\n\n').slice(0, bodyLimit)}\n\n${directive}`;
};
