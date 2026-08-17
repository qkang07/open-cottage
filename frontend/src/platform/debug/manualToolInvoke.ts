import type { ZodTypeAny } from 'zod';
import type { CottageAgent } from '../../agent/CottageAgent';
import type {
  ToolCatalogEntry,
  ToolInvocationOutcome,
} from '../../agent/toolInvocation';

/**
 * DebugPanel「工具调用」tab 的底层入口：
 * 枚举可手工调用的工具（已挂载 + 延后目录 + MCP），并以 manual 来源走统一执行器。
 * 设计文档：docs/tool-invocation-design.md（阶段 2）
 */

/** 手工调用失败阶段：UI 据此做行内错误提示 */
export type ManualInvokeErrorStage = 'executor' | 'json' | 'schema';

export class ManualToolInvokeError extends Error {
  readonly stage: ManualInvokeErrorStage;

  constructor(stage: ManualInvokeErrorStage, message: string) {
    super(message);
    this.name = 'ManualToolInvokeError';
    this.stage = stage;
  }
}

/** 枚举当前 agent 可手工调用的全部工具（已挂载 + 延后目录 + MCP，按组分类） */
export const listInvokableTools = (
  agent: CottageAgent | null | undefined,
): ToolCatalogEntry[] => agent?.getToolExecutor()?.listTools() ?? [];

/**
 * 手工调用工具：JSON 解析 → zod schema 预校验 → 统一执行器（source:'manual'）。
 * 前置失败抛 ManualToolInvokeError（stage 区分 json/schema）；
 * 执行层失败不抛错，以 outcome.status 返回（blocked_* / error / aborted 等）。
 */
export const invokeManually = async (
  agent: CottageAgent,
  toolName: string,
  argsJson: string,
  signal?: AbortSignal,
): Promise<ToolInvocationOutcome> => {
  const executor = agent.getToolExecutor();
  if (!executor) {
    throw new ManualToolInvokeError('executor', '当前会话没有可用的工具执行器');
  }

  let args: unknown;
  const trimmed = argsJson.trim();
  try {
    args = trimmed ? JSON.parse(trimmed) : {};
  } catch (error) {
    throw new ManualToolInvokeError(
      'json',
      `参数不是合法 JSON：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const entry = executor.listTools().find((item) => item.name === toolName);
  if (entry?.schema) {
    const parsed = (entry.schema as ZodTypeAny).safeParse(args);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue?.path?.length ? issue.path.join('.') : '(根)';
      throw new ManualToolInvokeError(
        'schema',
        `参数不符合工具 schema（${path}：${issue?.message ?? '未知错误'}）`,
      );
    }
  }

  return executor.invoke({ toolName, args, source: 'manual', signal });
};
