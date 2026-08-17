import { cottageTool, type CottageTool } from '@/agent/runtime/tool';
import { z } from 'zod';
import type { SpecDoc, SpecDraft, SpecTaskStatus } from './types';
import { requestSpecApproval } from './specApprovalGate';

/** store 提供的 spec 控制回调 */
export interface SpecToolCallbacks {
  /** 登记草稿为待批准的 SpecDoc（创建消息分段、持久化），返回完整文档 */
  registerSpec: (draft: SpecDraft) => SpecDoc;
  /** 批准后置为执行中 */
  markExecuting: (specId: string) => void;
  /** 更新单个任务状态 */
  updateTask: (taskId: string, status: SpecTaskStatus, note?: string) => void;
  /** 全部完成 */
  completeSpec: (specId: string) => void;
  /** 声明失败 */
  failSpec: (specId: string, reason: string) => void;
}

/** chat/spec 热切换时需卸下/换上的模式专用工具名 */
export const CHAT_SPEC_MODE_TOOL_NAMES = [
  'suggestSpec',
  'submitSpec',
  'specUpdateTask',
  'specComplete',
  'specFail',
] as const;

const taskSchema = z.object({
  title: z.string().min(1).describe('任务标题（一个具体的改动/交付项）'),
  detail: z.string().optional().describe('该任务的具体改动说明'),
});

/**
 * submitSpec：提交五段式计划文档，随后阻塞等待用户批准。
 * 批准后置为执行中并返回 ok，模型应在同一会话内逐任务执行。
 */
const createSubmitSpecTool = (
  cb: SpecToolCallbacks,
  sessionId?: string | null,
): CottageTool =>
  cottageTool(
    async (input, config) => {
      const draft: SpecDraft = {
        goal: input.goal,
        requirements: input.requirements ?? [],
        design: input.design,
        tasks: input.tasks,
        acceptance: input.acceptance ?? [],
      };
      const doc = cb.registerSpec(draft);

      let decision: 'approved' | 'adjust' | 'cancel';
      try {
        decision = await requestSpecApproval({ doc, signal: config?.signal, sessionId });
      } catch {
        return {
          ok: false,
          reason: '用户取消了计划审批。请停止执行并向用户说明。',
        };
      }
      if (decision === 'adjust') {
        return {
          ok: false,
          reason: '用户要求调整计划，请根据反馈修改后重新调用 submitSpec。',
        };
      }
      if (decision === 'cancel') {
        return {
          ok: false,
          reason: '用户取消了该计划。请停止执行。',
        };
      }

      cb.markExecuting(doc.id);
      return {
        ok: true,
        specId: doc.id,
        taskCount: doc.tasks.length,
        tasks: doc.tasks.map((t) => ({ id: t.id, title: t.title })),
        message:
          '计划已批准。请在本会话内逐任务执行：每个任务开始时调用 specUpdateTask 标记 doing，' +
          '完成后标记 done；全部完成后调用 specComplete。',
      };
    },
    {
      name: 'submitSpec',
      description:
        '提交五段式计划文档（目标 / 需求 / 设计改动 / 任务清单 / 验收标准）。' +
        '提交后会展示给用户审阅，用户批准后本工具才返回 ok，届时再开始逐任务执行。' +
        '任务清单只应包含真正的改动/交付项，不要包含探索、调研、阅读、理解现状等前期步骤。',
      schema: z.object({
        goal: z.string().min(1).describe('一句话目标'),
        requirements: z
          .array(z.string())
          .describe('需求条目列表'),
        design: z.string().describe('设计改动说明（可用 Markdown）'),
        tasks: z
          .array(taskSchema)
          .min(1)
          .describe('任务清单：每项是一个具体可执行的改动/交付项'),
        acceptance: z
          .array(z.string())
          .describe('验收标准条目列表'),
      }),
    },
  );

/** specUpdateTask：更新单个任务状态 */
const createSpecUpdateTaskTool = (
  cb: SpecToolCallbacks,
): CottageTool =>
  cottageTool(
    async (input) => {
      cb.updateTask(input.taskId, input.status, input.note);
      return { ok: true, taskId: input.taskId, status: input.status };
    },
    {
      name: 'specUpdateTask',
      description:
        '更新计划任务清单中某个任务的状态。开始执行某任务时置为 doing，完成后置为 done，' +
        '无法完成时置为 failed 并在 note 中说明原因。',
      schema: z.object({
        taskId: z.string().min(1).describe('任务 id（submitSpec 返回的 tasks[].id）'),
        status: z
          .enum(['doing', 'done', 'failed'])
          .describe('新的任务状态'),
        note: z.string().optional().describe('备注或失败原因'),
      }),
    },
  );

/** specComplete：全部任务完成 */
const createSpecCompleteTool = (
  cb: SpecToolCallbacks,
  specIdRef: () => string | null,
): CottageTool =>
  cottageTool(
    async () => {
      const id = specIdRef();
      if (!id) return { ok: false, reason: '当前没有进行中的计划。' };
      cb.completeSpec(id);
      return { ok: true, specId: id };
    },
    {
      name: 'specComplete',
      description: '所有任务完成且满足验收标准后调用，标记计划完成。',
      schema: z.object({}),
    },
  );

/** specFail：声明计划执行失败 */
const createSpecFailTool = (
  cb: SpecToolCallbacks,
  specIdRef: () => string | null,
): CottageTool =>
  cottageTool(
    async (input) => {
      const id = specIdRef();
      if (!id) return { ok: false, reason: '当前没有进行中的计划。' };
      cb.failSpec(id, input.reason);
      return { ok: true, specId: id };
    },
    {
      name: 'specFail',
      description: '确实无法继续时调用，声明计划执行失败并说明原因。',
      schema: z.object({
        reason: z.string().min(1).describe('失败原因'),
      }),
    },
  );

/**
 * 构建 spec 模式下注入的全部工具。
 * specIdRef 返回当前活跃计划 id（由 registerSpec 后由 store 维护）。
 */
export function createSpecTools(
  cb: SpecToolCallbacks,
  specIdRef: () => string | null,
  sessionId?: string | null,
): CottageTool[] {
  return [
    createSubmitSpecTool(cb, sessionId),
    createSpecUpdateTaskTool(cb),
    createSpecCompleteTool(cb, specIdRef),
    createSpecFailTool(cb, specIdRef),
  ];
}

/**
 * suggestSpec：chat 模式下的自动入口。
 * 当用户的请求确实是大型、跨多文件或多阶段、需要先规划再执行的项目时调用；
 * 调用后由 store 在本回合结束后切换到计划模式并开始起草计划文档。
 */
export function createSuggestSpecTool(options: {
  onSuggest: (goal: string, reason?: string) => void | Promise<void>;
}): CottageTool {
  return cottageTool(
    async ({ goal, reason }) => {
      await options.onSuggest(goal, reason);
      return {
        ok: true,
        message:
          '已安排切换到计划模式。请用一句话告诉用户你将以计划模式为该目标制定可批准的计划，然后结束本回合，不要继续执行其他操作。',
      };
    },
    {
      name: 'suggestSpec',
      description:
        '仅当用户的请求确实是大型、跨多文件或多阶段、且需要先制定完整计划再逐步落地的项目时，才调用此工具切换到「计划模式」。' +
        '切换后会先起草五段式计划文档（目标 / 需求 / 设计改动 / 任务清单 / 验收标准）供用户批准，批准后在同一会话内逐任务执行。' +
        '不要用于：单个功能修改、单文件或少量文件编辑、普通问答、调试排错、小范围重构，以及任何你能在当前对话里直接完成的任务。' +
        '拿不准时默认不要调用，直接在当前对话中完成。',
      schema: z.object({
        goal: z.string().min(1).describe('要完成的总体目标，保持简洁清晰'),
        reason: z
          .string()
          .optional()
          .describe('简要说明为何该任务适合用计划模式'),
      }),
    },
  );
}
