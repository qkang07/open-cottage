import { cottageTool, type CottageTool } from '@/agent/runtime/tool';
import { z } from 'zod';
import { isOptionalToolEnabled } from '../../../agent/toolCatalog';
import { workspace } from '../../../workspace/FileSystemWorkspace';
import {
  astCapabilitiesForPath,
  resolveAstAdapter,
} from './adapterRegistry';
import { applyAstForPath } from './astWorkerHost';
import type { AstOperation } from './types';

const opSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('renameSymbol'),
    selector: z.object({ name: z.string() }),
    newName: z.string(),
  }),
  z.object({
    kind: z.literal('addImport'),
    spec: z.object({
      module: z.string(),
      named: z.array(z.string()).optional(),
      default: z.string().optional(),
      sideEffect: z.boolean().optional(),
    }),
  }),
  z.object({
    kind: z.literal('removeImport'),
    spec: z.object({
      module: z.string().optional(),
      named: z.array(z.string()).optional(),
      default: z.string().optional(),
    }),
  }),
  z.object({
    kind: z.literal('insertStatement'),
    anchor: z.object({
      afterSymbol: z.string().optional(),
      at: z.enum(['fileTop', 'fileEnd']).optional(),
    }),
    code: z.string(),
  }),
  z.object({
    kind: z.literal('replacePropDefault'),
    spec: z.object({
      component: z.string(),
      prop: z.string(),
      value: z.string(),
    }),
  }),
]);

export const createAstCottageTools = (options: {
  enabledTools: readonly string[];
  onWorkspaceMutate?: () => void | Promise<void>;
}): CottageTool[] => {
  const enabled = options.enabledTools;
  const tools: CottageTool[] = [];

  if (isOptionalToolEnabled(enabled, 'astCapabilities')) {
    tools.push(
      cottageTool(
        async ({ path }) => {
          const info = astCapabilitiesForPath(path);
          if (!info) {
            return {
              supported: false,
              note: '该文件类型暂无 AST 编辑 adapter。回退到 editFile。',
            };
          }
          return { supported: true, ...info };
        },
        {
          name: 'astCapabilities',
          description:
            '查询某文件是否支持 AST 编辑及可用操作（零加载，仅读 adapter 声明）。调用 astEdit 前可先用它确认。',
          schema: z.object({ path: z.string() }),
        },
      ),
    );
  }

  if (isOptionalToolEnabled(enabled, 'astEdit')) {
    tools.push(
      cottageTool(
        async ({ path, dryRun, operations }) => {
          const adapter = resolveAstAdapter(path);
          if (!adapter) {
            return {
              applied: 0,
              written: false,
              note: '该文件类型暂无 AST 编辑 adapter，请回退到 editFile。',
            };
          }
          const { content } = await workspace.readFile(path);
          if (!content) {
            return { applied: 0, written: false, note: '文件不存在或为空' };
          }
          const outcome = await applyAstForPath(
            path,
            content,
            operations as AstOperation[],
          );

          if (outcome.applied === 0) {
            return {
              adapterId: adapter.id,
              applied: 0,
              written: false,
              diff: '',
              notes: outcome.notes.length ? outcome.notes : ['所有操作均未命中'],
            };
          }

          const shouldWrite = dryRun === false;
          if (shouldWrite) {
            await workspace.writeFile(path, outcome.output);
            await options.onWorkspaceMutate?.();
          }
          return {
            adapterId: adapter.id,
            applied: outcome.applied,
            written: shouldWrite,
            diff: outcome.diff,
            notes: outcome.notes,
          };
        },
        {
          name: 'astEdit',
          description:
            'AST 级编辑（按语言懒加载解析器）。默认 dryRun=true 仅返回 diff，确认无误后用 dryRun=false 落盘。支持 renameSymbol（作用域内重命名，含引用点）、addImport / removeImport、insertStatement（afterSymbol 或 fileTop/fileEnd）、replacePropDefault（React defaultProps）。selector 用符号名定位，不要算行号。语法错误或未命中时 applied=0，应回退 editFile。',
          schema: z.object({
            path: z.string(),
            dryRun: z.boolean().optional(),
            operations: z.array(opSchema).min(1),
          }),
        },
      ),
    );
  }

  return tools;
};
