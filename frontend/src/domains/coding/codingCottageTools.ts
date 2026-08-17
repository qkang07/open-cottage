import { cottageTool, type CottageTool } from '@/agent/runtime/tool';
import { z } from 'zod';
import { isOptionalToolEnabled } from '../../agent/toolCatalog';
import { findSymbolReferences, searchSymbolDefinitions, analyzeSymbolImpact } from './query';
import {
  createAstCottageTools,
  jsxAstAdapter,
  registerAstEditAdapter,
  tsAstAdapter,
  vueAstAdapter,
} from './ast';

export interface CreateCodingToolsOptions {
  enabledTools: readonly string[];
  onWorkspaceMutate?: () => void | Promise<void>;
}

export const createCodingCottageTools = (
  options: CreateCodingToolsOptions,
): CottageTool[] => {
  const enabled = options.enabledTools;
  const tools: CottageTool[] = [];

  // 注册 AST 编辑 adapter（按 id upsert，幂等）。
  // 仅登记元信息，不加载解析器；首次 astEdit 调用才 lazy import。
  registerAstEditAdapter(tsAstAdapter);
  registerAstEditAdapter(jsxAstAdapter);
  registerAstEditAdapter(vueAstAdapter);

  if (isOptionalToolEnabled(enabled, 'searchSymbol')) {
    tools.push(
      cottageTool(
        async ({ query }) => searchSymbolDefinitions(query),
        {
          name: 'searchSymbol',
          description: '按符号名搜索定义（函数/类/组件/类型）。',
          schema: z.object({ query: z.string() }),
        },
      ),
    );
  }

  if (isOptionalToolEnabled(enabled, 'findReferences')) {
    tools.push(
      cottageTool(
        async ({ symbolName }) => findSymbolReferences(symbolName),
        {
          name: 'findReferences',
          description: '查询某个符号的引用位置列表。',
          schema: z.object({ symbolName: z.string() }),
        },
      ),
    );
  }

  if (isOptionalToolEnabled(enabled, 'analyzeImpact')) {
    tools.push(
      cottageTool(
        async ({ symbolName }) => analyzeSymbolImpact(symbolName),
        {
          name: 'analyzeImpact',
          description:
            '改前影响分析：定位符号定义并按文件聚合其全部引用点，返回受影响文件数与调用点总数，用于判断改动范围与是否需要提交计划。',
          schema: z.object({ symbolName: z.string() }),
        },
      ),
    );
  }

  tools.push(
    ...createAstCottageTools({
      enabledTools: enabled,
      onWorkspaceMutate: options.onWorkspaceMutate,
    }),
  );

  return tools;
};
