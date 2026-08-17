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
        });
        return { kind: 'presentation', path: input.path, ...data };
      },
      {
        name: 'readPresentation',
        description:
          '读取 PowerPoint（pptx）纯文本。返回 slides 列表。' +
          '可用 slideIndex、textIndex（1-based）只读单页或单个文本块。不支持写入。',
        schema: toolReadPresentationInputSchema,
      },
    ),
  );

  return tools;
};
