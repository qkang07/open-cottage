import type { CottageTool } from '../agent/runtime/tool';
import type { EvalToolFault } from './types';

/** 在工具边界注入确定性故障，不 mock CottageAgent 内部私有状态。 */
export const wrapEvalToolsWithFaults = (
  tools: readonly CottageTool[],
  configured: readonly EvalToolFault[] = [],
): CottageTool[] => {
  const counts = new Map<string, number>();
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    schema: tool.schema,
    async invoke(input, config) {
      const occurrence = (counts.get(tool.name) ?? 0) + 1;
      counts.set(tool.name, occurrence);
      const matches = (phase: 'before' | 'after') =>
        configured.find(
          (fault) =>
            fault.target === 'tool' &&
            fault.toolName === tool.name &&
            fault.phase === phase &&
            (fault.occurrence ?? 1) === occurrence,
        );
      const before = matches('before');
      if (before) throw new Error(before.error);
      const output = await tool.invoke(input, config);
      const after = matches('after');
      if (after) throw new Error(after.error);
      return output;
    },
  }));
};
