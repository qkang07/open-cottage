import { cottageTool, type CottageTool } from '@/agent/runtime/tool';
import { z } from 'zod';
import {
  LOAD_TOOLS_TOOL_NAME,
  buildToolSkillMarkdown,
  toolSkillSummary,
} from './toolSkills';

export interface CreateLoadToolsToolOptions {
  /** 可按需激活的工具（name → tool） */
  deferredByName: Map<string, CottageTool>;
  /** 激活工具（写入 Agent 的 tools/toolMap） */
  onActivate: (tools: CottageTool[]) => void;
  /** 当前已挂载的工具名 */
  getActiveNames: () => ReadonlySet<string>;
}

/**
 * 元工具：按名称加载延后工具的 skill，并在本回合启用对应工具。
 * 类似 SKILLS 的「先看目录、需要时再读全文」。
 */
export const createLoadToolsTool = (
  options: CreateLoadToolsToolOptions,
): CottageTool =>
  cottageTool(
    async ({ names }) => {
      const requested = [
        ...new Set(
          names
            .map((n) => n.trim())
            .filter(Boolean),
        ),
      ];
      if (!requested.length) {
        throw new Error('names 不能为空');
      }

      const active = options.getActiveNames();
      const loaded: string[] = [];
      const alreadyActive: string[] = [];
      const unknown: string[] = [];
      const toActivate: CottageTool[] = [];
      const skillParts: string[] = [];

      for (const name of requested) {
        if (active.has(name)) {
          alreadyActive.push(name);
          const toolInstance = options.deferredByName.get(name);
          if (toolInstance) {
            skillParts.push(buildToolSkillMarkdown(toolInstance));
          } else {
            skillParts.push(
              `# Tool: ${name}\n\n已在当前可调用列表中。\n\n${toolSkillSummary(name)}`,
            );
          }
          continue;
        }
        const deferred = options.deferredByName.get(name);
        if (!deferred) {
          unknown.push(name);
          continue;
        }
        toActivate.push(deferred);
        loaded.push(name);
        skillParts.push(buildToolSkillMarkdown(deferred));
      }

      if (toActivate.length) {
        options.onActivate(toActivate);
      }

      const catalogHint =
        unknown.length > 0
          ? `\n\n未知工具名：${unknown.join(', ')}。可用延后工具见 system 中 <available_deferred_tools>。`
          : '';

      return {
        loaded,
        alreadyActive,
        unknown,
        note:
          loaded.length > 0
            ? `已启用：${loaded.join(', ')}。请在本回合后续步骤中直接调用。`
            : alreadyActive.length > 0
              ? '请求的工具此前已启用。'
              : '未启用任何新工具。',
        skills: skillParts.join('\n\n---\n\n') + catalogHint,
      };
    },
    {
      name: LOAD_TOOLS_TOOL_NAME,
      description:
        '加载延后工具的完整 skill（参数说明）并在本回合启用它们。仅用于 <available_deferred_tools> 中列出的工具；核心工具无需 loadTools。可一次传多个 names。',
      schema: z.object({
        names: z
          .array(z.string())
          .min(1)
          .describe('要加载并启用的工具名，如 ["runScript","compress"]'),
      }),
    },
  );
