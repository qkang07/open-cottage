import { cottageTool, type CottageTool } from '@/agent/runtime/tool';
import { getActiveChatReferences } from '../chat/activeReferences';
import { batchGenerateOfficeDocs } from '../domains/office/batchGenerate';
import { renderOfficeTemplate } from '../domains/office/templateEngine';
import { isOptionalToolEnabled, type OfficeWriteToolName } from './toolCatalog';
import { editPresentation, writeOfficeDocument } from './officeDocuments';
import {
  resolveWritePresentationOptions,
  resolveWriteWordOptions,
} from './resolveWriteOfficeOptions';
import {
  toolBatchGenerateOfficeDocsInputSchema,
  toolEditPresentationInputSchema,
  toolRenderOfficeTemplateInputSchema,
  toolWritePresentationInputSchema,
  toolWriteWordInputSchema,
} from './officeWriteSchema';

export const createOfficeWriteCottageTools = (options: {
  enabledTools: readonly string[];
  onMutate?: () => void | Promise<void>;
}): CottageTool[] => {
  const enabled = options.enabledTools;
  const tools: CottageTool[] = [];
  const notify = async () => {
    await options.onMutate?.();
  };

  const add = (name: OfficeWriteToolName, t: CottageTool) => {
    if (isOptionalToolEnabled(enabled, name)) tools.push(t);
  };

  add(
    'writeWord',
    cottageTool(
      async (input) => {
        const resolved = resolveWriteWordOptions(input, getActiveChatReferences());
        const result = await writeOfficeDocument(resolved.path, resolved.content, {
          mode: resolved.mode,
          target: resolved.target,
        });
        await notify();
        return result;
      },
      {
        name: 'writeWord',
        description:
          '写入 Word（docx），支持 replace 或 patch（段落范围）。正式文档请用 content.blocks（heading/paragraph/bullet/numbered/table/image/columns）+ content.theme（minimal-light/dark-tech/consulting-clean），可加 header/footer；仅兼容场景用 paragraphs。',
        schema: toolWriteWordInputSchema,
      },
    ),
  );

  add(
    'writePresentation',
    cottageTool(
      async (input) => {
        const resolved = resolveWritePresentationOptions(
          input,
          getActiveChatReferences(),
        );
        const result = await writeOfficeDocument(resolved.path, resolved.content, {
          mode: resolved.mode,
          target: resolved.target,
        });
        await notify();
        return result;
      },
      {
        name: 'writePresentation',
        description:
          '新建或完整重建 PPT（pptx）。V3 使用受约束 HTML/CSS 先由浏览器计算布局，再生成原生可编辑 PPTX；支持内置构图模块、参考 PPT 风格分析、native-template 母版/版式继承、临时设计稿与回读验收。V2 语义布局和旧 title/subtitle/bullets 输入继续兼容。',
        schema: toolWritePresentationInputSchema,
      },
    ),
  );

  add(
    'editPresentation',
    cottageTool(
      async (input) => {
        const result = await editPresentation(input.path, input.operations);
        await notify();
        return result;
      },
      {
        name: 'editPresentation',
        description:
          '原位编辑既有 PPT：新增/更新/删除常用元素、替换图片、更新表格/图表、已有备注，以及增删复制重排页面；保留未修改的复杂对象。V3 文稿会同步可安全映射的 sidecar 源稿，无法同步时明确标记 stale。先用 readPresentation(includeElements=true) 获取 elementId。',
        schema: toolEditPresentationInputSchema,
      },
    ),
  );

  add(
    'renderOfficeTemplate',
    cottageTool(
      async (input) => {
        const result = await renderOfficeTemplate(input);
        await notify();
        return result;
      },
      {
        name: 'renderOfficeTemplate',
        description: '基于 docx/pptx 模板进行 {{变量}} 渲染输出。',
        schema: toolRenderOfficeTemplateInputSchema,
      },
    ),
  );

  add(
    'batchGenerateOfficeDocs',
    cottageTool(
      async (input) => {
        const result = await batchGenerateOfficeDocs(input);
        await notify();
        return result;
      },
      {
        name: 'batchGenerateOfficeDocs',
        description: '对同一模板按变量列表批量生成文档。',
        schema: toolBatchGenerateOfficeDocsInputSchema,
      },
    ),
  );

  return tools;
};
