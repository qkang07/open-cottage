import { cottageTool, type CottageTool } from '@/agent/runtime/tool';
import { z } from 'zod';
import type { Artifact } from './types';

export interface StartOrchestrationToolOptions {
  onStart: (goal: string, hint?: string) => Promise<string>;
}

export function createStartOrchestrationTool(
  options: StartOrchestrationToolOptions,
): CottageTool {
  return cottageTool(
    async ({ goal, hint }) => {
      const id = await options.onStart(goal, hint);
      return {
        ok: true,
        orchestrationId: id,
        message:
          '已进入编排模式，正在制定执行计划。计划将展示给用户审阅，经批准后才会开始执行。',
      };
    },
    {
      name: 'cottage_startOrchestration',
      description:
        '仅当任务确实是大型、跨多文件或多阶段、且用户明显是把它当作一个完整项目来提时，才调用此工具进入编排模式。' +
        '进入后会先制定分步计划并展示给用户，经用户批准后才由编排器按步骤调度子 Agent 执行。' +
        '不要用于以下情况：单个功能的修改、单文件或少量文件的编辑、普通问答、调试排错、小范围重构、以及任何你能在当前对话里直接完成的任务。' +
        '拿不准时，默认不要调用此工具，直接在当前对话中完成。',
      schema: z.object({
        goal: z
          .string()
          .describe('要完成的总体目标，保持简洁清晰'),
        hint: z
          .string()
          .optional()
          .describe('可选的补充说明，例如期望的步骤数或关键约束'),
      }),
    },
  );
}

export interface OrchestratorSubToolOptions {
  reportArtifact: (artifact: Omit<Artifact, 'createdAt'>) => Promise<Artifact>;
  completeStep: (result?: string) => void;
  failStep: (reason: string) => void;
  askHuman: (question: string) => Promise<string>;
}

export function createOrchestratorSubTools(
  options: OrchestratorSubToolOptions,
): CottageTool[] {
  return [
    cottageTool(
      async ({ name, type, content, filePath }) => {
        const artifact = await options.reportArtifact({
          id: crypto.randomUUID(),
          name,
          type: type as Artifact['type'],
          content: content ?? undefined,
          filePath: filePath ?? undefined,
          producerStepId: 'sub-agent',
        });
        return {
          ok: true,
          artifactId: artifact.id,
          message: `已记录产物: ${artifact.name}`,
        };
      },
      {
        name: 'orch_reportArtifact',
        description:
          '向编排器提交一个中间产物。用于保存子 Agent 生成的文本、代码、JSON 或文件引用。',
        schema: z.object({
          name: z.string().describe('产物名称'),
          type: z
            .enum(['text', 'json', 'file', 'code'])
            .describe('产物类型'),
          content: z
            .string()
            .optional()
            .describe('产物内容；大内容会自动写入工作区'),
          filePath: z
            .string()
            .optional()
            .describe('若产物已存为工作区文件，填写相对路径'),
        }),
      },
    ),
    cottageTool(
      async ({ result }) => {
        options.completeStep(result);
        return {
          ok: true,
          message: '步骤已完成',
        };
      },
      {
        name: 'orch_completeStep',
        description:
          '声明当前步骤已成功完成，并可附带简短结果摘要。完成前请确保已提交关键产物。',
        schema: z.object({
          result: z
            .string()
            .optional()
            .describe('步骤执行结果摘要'),
        }),
      },
    ),
    cottageTool(
      async ({ reason }) => {
        options.failStep(reason);
        return {
          ok: false,
          message: `步骤已标记为失败: ${reason}`,
        };
      },
      {
        name: 'orch_failStep',
        description: '当当前步骤无法继续时，声明步骤失败并说明原因。',
        schema: z.object({
          reason: z.string().describe('失败原因'),
        }),
      },
    ),
    cottageTool(
      async ({ question }) => {
        const answer = await options.askHuman(question);
        return {
          ok: true,
          answer,
        };
      },
      {
        name: 'orch_askHuman',
        description:
          '当步骤需要用户确认、补充信息或做选择时，向用户提问并等待回复。',
        schema: z.object({
          question: z.string().describe('向用户提出的问题'),
        }),
      },
    ),
  ];
}
