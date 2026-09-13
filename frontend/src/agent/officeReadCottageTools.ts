import { cottageTool, type CottageTool } from '@/agent/runtime/tool';
import { z } from 'zod';
import {
  isOptionalToolEnabled,
  type OfficeReadToolName,
} from './toolCatalog';
import { readPresentation, readWordDocument } from './officeDocuments';
import { normalizeWordRange } from './officeRanges';
import { wordRangeSchema } from './spreadsheetWriteSchema';

const toolReadWordInputSchema = z.object({
  path: z.string(),
  wordRange: wordRangeSchema.optional(),
});

const toolReadPresentationInputSchema = z.object({
  path: z.string(),
  slideIndex: z.number().int().min(1).optional(),
  textIndex: z.number().int().min(1).optional(),
  includeElements: z.boolean().optional().describe('返回元素 ID、类型、坐标、样式与可编辑状态'),
  includeStyleProfile: z.boolean().optional().describe('分析页面尺寸、主题字体/颜色、常用区域和重复装饰'),
  includeLayouts: z.boolean().optional().describe('随 StyleProfile 返回版式摘要'),
  includeMasters: z.boolean().optional().describe('随 StyleProfile 返回母版摘要'),
  includeSourceManifest: z.boolean().optional().describe('返回 Cottage V3 HTML/Scene 源稿清单'),
});

export const createOfficeReadCottageTools = (options: {
  enabledTools: readonly string[];
}): CottageTool[] => {
  const enabled = options.enabledTools;
  const tools: CottageTool[] = [];

  const add = (name: OfficeReadToolName, t: CottageTool) => {
    if (isOptionalToolEnabled(enabled, name)) tools.push(t);
  };

  add(
    'readWord',
    cottageTool(
      async (input) => {
        const data = await readWordDocument(input.path, {
          wordRange: input.wordRange
            ? normalizeWordRange(wordRangeSchema.parse(input.wordRange))
            : undefined,
        });
        return { kind: 'word', path: input.path, ...data };
      },
      {
        name: 'readWord',
        description:
          '读取 Word 文档（docx）纯文本。返回 paragraphs 数组。' +
          '可用 wordRange（startParagraph/endParagraph，1-based）只读段落。不支持写入。',
        schema: toolReadWordInputSchema,
      },
    ),
  );

  add(
    'readPresentation',
    cottageTool(
      async (input) => {
        const data = await readPresentation(input.path, {
          slideIndex: input.slideIndex,
          textIndex: input.textIndex,
          includeElements: input.includeElements,
          includeStyleProfile: input.includeStyleProfile,
          includeLayouts: input.includeLayouts,
          includeMasters: input.includeMasters,
          includeSourceManifest: input.includeSourceManifest,
        });
        return { kind: 'presentation', path: input.path, ...data };
      },
      {
        name: 'readPresentation',
        description:
          '读取 PowerPoint（pptx）的文本与结构。includeElements=true 返回稳定定位信息；includeStyleProfile/includeLayouts/includeMasters 可分析参考 PPT 的页面尺寸、主题、母版和版式；includeSourceManifest 返回 Cottage V3 源稿状态。',
        schema: toolReadPresentationInputSchema,
      },
    ),
  );

  return tools;
};
