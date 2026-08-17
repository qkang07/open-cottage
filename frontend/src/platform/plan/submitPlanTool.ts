import { cottageTool, type CottageTool } from '@/agent/runtime/tool';
import { z } from 'zod';
import type { PlanSession } from './planSession';
import type { ExecutionPlan } from './types';
import { SUBMIT_PLAN_TOOL_NAME } from './planEngine';
import { requestPlanApproval } from './planApprovalGate';

const planItemSchema = z.object({
  requirement: z.string().min(1),
  actions: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

const planBudgetSchema = z.object({
  maxFiles: z.number().int().positive().optional(),
  maxApiCalls: z.number().int().positive().optional(),
  maxTurns: z.number().int().positive().optional(),
});

export interface CreateSubmitPlanToolOptions {
  /** 为 true 时，提交计划后须用户在 UI 批准才返回 ok；否则立即提交。 */
  requireApproval?: boolean;
  /** 所属会话 ID，用于按会话隔离计划审批闸门 */
  sessionId?: string | null;
}

export const createSubmitPlanTool = (
  session: PlanSession,
  options: CreateSubmitPlanToolOptions = {},
): CottageTool =>
  cottageTool(
    async (input, config) => {
      const items = input.items.map((item) => ({
        requirement: item.requirement.trim(),
        actions: item.actions,
        confidence: item.confidence,
      }));
      // 校准轮次预算：maxTurns 限制的是工具轮次，至少要保证每个计划项有一轮预算，
      // 否则 LLM 提交 4 项但 maxTurns=3 时必然超出预算。
      const budget = { ...input.budget };
      if (items.length > 0) {
        if (
          budget.maxTurns === undefined ||
          budget.maxTurns < items.length
        ) {
          budget.maxTurns = items.length;
        }
      }
      const plan: ExecutionPlan = {
        goal: input.goal.trim(),
        domain: input.domain?.trim() || undefined,
        items,
        budget,
        submittedAt: Date.now(),
      };

      if (options.requireApproval) {
        const signal = config?.signal;
        let decision: 'approved' | 'adjust' | 'cancel';
        try {
          decision = await requestPlanApproval({
            plan,
            signal,
            sessionId: options.sessionId,
            onPending: () => {
              /* UI 通过 getPendingPlanApproval 轮询渲染 */
            },
          });
        } catch {
          // 取消/中断：不写入 session，告知模型需重新规划
          return {
            ok: false,
            reason: '用户取消了计划审批，请重新评估后再提交。',
            itemCount: plan.items.length,
          };
        }
        if (decision === 'adjust') {
          return {
            ok: false,
            reason: '用户要求调整计划，请根据反馈修改后重新提交 submitExecutionPlan。',
            itemCount: plan.items.length,
          };
        }
        if (decision === 'cancel') {
          return {
            ok: false,
            reason: '用户取消了该计划，请改用只读方式或向用户说明。',
            itemCount: plan.items.length,
          };
        }
      }

      session.submit(plan);
      return {
        ok: true,
        goal: plan.goal,
        itemCount: plan.items.length,
        budget: plan.budget ?? null,
      };
    },
    {
      name: SUBMIT_PLAN_TOOL_NAME,
      description:
        '提交本回合的执行计划，用于大改动（多文件重构、批量写入、外部访问、破坏性操作）前的范围与预算管控。' +
        '须包含 goal、items（需求与拟采取动作），可选 budget（maxFiles / maxApiCalls / maxTurns）。' +
        '小改动（单处 editFile、新建小文件等）无需提交计划，可直接执行。计划提交后，后续受管工具才会被允许执行。',
      schema: z.object({
        goal: z.string().describe('本回合要完成的目标'),
        domain: z
          .string()
          .optional()
          .describe('领域，如 office / coding / core'),
        items: z
          .array(planItemSchema)
          .min(1)
          .describe('计划条目：每条对应一个需求及拟采取的动作'),
        budget: planBudgetSchema
          .optional()
          .describe('可选预算上限；未指定时使用平台默认'),
      }),
    },
  );
