import { cottageTool, type CottageTool } from '@/agent/runtime/tool';
import { z } from 'zod';
import type {
  PlanDefinition,
  PlanDraft,
  PlanRun,
  ToolMutationReport,
} from './types';
import { requestPlanApproval } from './approvalGate';

export interface PlanToolCallbacks {
  registerPlan: (
    draft: PlanDraft,
  ) => Promise<{ definition: PlanDefinition; run: PlanRun }>;
  approvePlan: (planId: string, revision: number) => Promise<PlanRun>;
  startStep: (stepId: string) => Promise<PlanRun>;
  completeStep: (input: {
    stepId: string;
    summary: string;
    changedFiles?: string[];
  }) => Promise<PlanRun>;
  blockStep: (stepId: string, reason: string) => Promise<PlanRun>;
  requestRevision: (reason: string) => Promise<PlanRun>;
  completeRun: (summary: string) => Promise<PlanRun>;
  failRun: (reason: string) => Promise<PlanRun>;
  runResearch: (questions: string[]) => Promise<Array<{ question: string; summary: string }>>;
  getActivePlan: () => { definition: PlanDefinition; run: PlanRun } | null;
  onGuardBlocked: (reason: string) => void | Promise<void>;
  onGuardMutation: (
    report: ToolMutationReport,
    risk: 'read' | 'write' | 'external' | 'destructive' | 'control',
    predictedPaths: string[],
  ) => void | Promise<void>;
  onGuardExternalCall: (succeeded: boolean) => void | Promise<void>;
}

export const CHAT_PLAN_MODE_TOOL_NAMES = [
  'suggestPlanMode',
  'submitPlan',
  'completePlanStep',
  'blockPlanStep',
  'requestPlanRevision',
  'completePlanRun',
  'failPlanRun',
  'dispatchPlanResearch',
  // 旧 Spec 工具一并卸载，防止热切换后残留两套计划协议。
  'suggestSpec',
  'submitSpec',
  'specUpdateTask',
  'specComplete',
  'specFail',
] as const;

const criterionSchema = z.object({
  id: z.string().optional(),
  providerId: z.string().default('user.acceptance'),
  description: z.string().min(1),
  required: z.boolean().default(true),
  config: z.record(z.string(), z.unknown()).default({}),
});

const stepSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  detail: z.string().optional(),
  kind: z.enum(['research', 'implementation', 'verification']).default('implementation'),
  dependsOn: z.array(z.string()).default([]),
  skippable: z.boolean().optional().default(false),
  allowedPathPrefixes: z.array(z.string()).optional(),
  acceptance: z.array(criterionSchema).default([]),
});

const budgetsSchema = z.object({
  maxTurns: z.number().int().positive().optional(),
  maxChangedFiles: z.number().int().positive().optional(),
  maxExternalCalls: z.number().int().nonnegative().optional(),
  maxStepRetries: z.number().int().nonnegative().optional(),
});

const createSubmitPlanTool = (
  callbacks: PlanToolCallbacks,
  sessionId?: string | null,
): CottageTool =>
  cottageTool(
    async (input, config) => {
      const draft: PlanDraft = {
        planId: input.planId,
        baseRevision: input.baseRevision === 0 ? undefined : input.baseRevision,
        goal: input.goal,
        requirements: input.requirements,
        design: input.design,
        allowedPathPrefixes: input.allowedPathPrefixes,
        steps: input.steps,
        finalAcceptance: input.finalAcceptance,
        budgets: input.budgets,
        preserveStepIds: input.preserveStepIds,
      };
      const { definition, run } = await callbacks.registerPlan(draft);
      const resolution = await requestPlanApproval({
        definition,
        run,
        signal: config?.signal,
        sessionId,
      });
      const { decision } = resolution;
      if (decision !== 'approved') {
        return {
          ok: false,
          reason:
            decision === 'adjust'
              ? `用户要求调整计划${resolution.feedback ? `：${resolution.feedback}` : ''}。` +
                '请根据反馈提交新的 revision，不要执行写入。'
              : '用户取消了计划。请停止执行。',
        };
      }
      const approved = await callbacks.approvePlan(definition.id, definition.revision);
      return {
        ok: true,
        planId: definition.id,
        revision: definition.revision,
        status: approved.status,
        steps: definition.steps.map((step) => ({
          id: step.id,
          title: step.title,
          dependsOn: step.dependsOn,
          skippable: step.skippable === true,
        })),
        verificationCapabilities: definition.verificationCapabilitySnapshot,
        message: '计划已批准，系统已登记第一个可执行步骤。只可在批准路径范围内执行；步骤完成后调用 completePlanStep 提交证据。',
      };
    },
    {
      name: 'submitPlan',
      description:
        '提交版本化计划供用户批准。新计划省略 baseRevision 或传 0；修订已有计划时传当前正整数 revision。计划必须声明允许写入的路径前缀、依赖关系和基于当前浏览器能力的验收标准；不得填写 npm/build/tsc 等未注册命令。',
      schema: z.object({
        planId: z.string().optional(),
        baseRevision: z.number().int().nonnegative().optional(),
        goal: z.string().min(1),
        requirements: z.array(z.string()).default([]),
        design: z.string().default(''),
        allowedPathPrefixes: z.array(z.string()).min(1),
        steps: z.array(stepSchema).min(1),
        finalAcceptance: z.array(criterionSchema).default([]),
        budgets: budgetsSchema.optional(),
        preserveStepIds: z.array(z.string()).optional(),
      }),
    },
  );

const createCompleteStepTool = (callbacks: PlanToolCallbacks): CottageTool =>
  cottageTool(
    async ({ stepId, summary, changedFiles }) => {
      const active = callbacks.getActivePlan();
      if (!active) return { ok: false, reason: '当前没有活动计划' };
      const state = active.run.stepStates[stepId];
      if (state?.status === 'ready') await callbacks.startStep(stepId);
      const run = await callbacks.completeStep({ stepId, summary, changedFiles });
      const next = callbacks.getActivePlan();
      return {
        ok: run.status !== 'paused' && run.status !== 'waiting_for_user',
        planId: run.planId,
        stepId,
        status: run.stepStates[stepId]?.status,
        verificationState: run.stepStates[stepId]?.verificationState,
        planStatus: run.status,
        reason: run.pendingReason,
        nextStep: next?.run.currentStepId
          ? next.definition.steps.find((step) => step.id === next.run.currentStepId)
          : null,
      };
    },
    {
      name: 'completePlanStep',
      description:
        '提交当前计划步骤的实现摘要。changedFiles 只是可选提示；系统以 Mutation Journal 的实际记录为准，并检查依赖、路径范围和批准时的验证能力快照。',
      schema: z.object({
        stepId: z.string().min(1),
        summary: z.string().min(1),
        changedFiles: z.array(z.string()).optional(),
      }),
    },
  );

export const createPlanTools = (
  callbacks: PlanToolCallbacks,
  sessionId?: string | null,
): CottageTool[] => [
  createSubmitPlanTool(callbacks, sessionId),
  createCompleteStepTool(callbacks),
  cottageTool(
    async ({ stepId, reason }) => ({
      ok: true,
      run: await callbacks.blockStep(stepId, reason),
    }),
    {
      name: 'blockPlanStep',
      description: '当前步骤确实无法继续时，记录阻塞原因并暂停计划。',
      schema: z.object({ stepId: z.string().min(1), reason: z.string().min(1) }),
    },
  ),
  cottageTool(
    async ({ reason }) => ({
      ok: true,
      run: await callbacks.requestRevision(reason),
      message: '计划已暂停。请调用 submitPlan 提交新的 revision 并等待用户重新批准。',
    }),
    {
      name: 'requestPlanRevision',
      description: '目标、步骤、依赖、路径范围或验收标准需要改变时暂停并请求计划修订。',
      schema: z.object({ reason: z.string().min(1) }),
    },
  ),
  cottageTool(
    async ({ summary }) => {
      const run = await callbacks.completeRun(summary);
      return {
        ok: run.status === 'completed',
        status: run.status,
        verification: run.finalVerification,
        reason: run.pendingReason,
      };
    },
    {
      name: 'completePlanRun',
      description:
        '全部步骤实现后请求完成计划。只有充分的浏览器机器验证通过时才自动完成，否则进入等待用户验收。',
      schema: z.object({ summary: z.string().min(1) }),
    },
  ),
  cottageTool(
    async ({ reason }) => ({ ok: true, run: await callbacks.failRun(reason) }),
    {
      name: 'failPlanRun',
      description: '计划确实无法恢复时记录失败；不会删除或回退现有修改。',
      schema: z.object({ reason: z.string().min(1) }),
    },
  ),
  cottageTool(
    async ({ questions }) => ({
      ok: true,
      results: await callbacks.runResearch(questions),
    }),
    {
      name: 'dispatchPlanResearch',
      description:
        '并行派生最多 3 个临时只读研究执行器。它们没有写入、联网、交互或继续派生能力，只返回结构化摘要。',
      schema: z.object({
        questions: z.array(z.string().min(1)).min(1).max(3),
      }),
    },
  ),
];

export const createSuggestPlanModeTool = (options: {
  onSuggest: (goal: string, reason?: string) => boolean | void | Promise<boolean | void>;
}): CottageTool =>
  cottageTool(
    async ({ goal, reason }) => {
      const accepted = await options.onSuggest(goal, reason);
      return {
        ok: accepted !== false,
        message:
          accepted === false
            ? '用户选择继续当前对话。不要切换模式。'
            : '用户已确认切换到计划模式；请结束当前回合，等待系统起草流程。',
      };
    },
    {
      name: 'suggestPlanMode',
      description:
        '仅为明显跨多文件、多阶段且需要批准范围的大型任务建议进入计划模式。该工具只提出建议，由用户确认是否切换。',
      schema: z.object({
        goal: z.string().min(1),
        reason: z.string().optional(),
      }),
    },
  );
