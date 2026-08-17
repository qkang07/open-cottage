import { cottageTool, type CottageTool } from '@/agent/runtime/tool';
import { getActiveChatReferences } from '../chat/activeReferences';
import { batchGenerateOfficeDocs } from '../domains/office/batchGenerate';
import { renderOfficeTemplate } from '../domains/office/templateEngine';
import { isOptionalToolEnabled, type OfficeWriteToolName } from './toolCatalog';
import { writeOfficeDocument } from './officeDocuments';
import {
  resolveWritePresentationOptions,
  resolveWriteWordOptions,
} from './resolveWriteOfficeOptions';
import {
  toolBatchGenerateOfficeDocsInputSchema,
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
          '写入 PPT（pptx），支持 replace 或 patch（按 slideIndex）。replace 时可传 theme（minimal-light/dark-tech/consulting-clean）与每页 layout（cover/section/content）以应用配色与版式，避免纯文本白底。',
        schema: toolWritePresentationInputSchema,
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
