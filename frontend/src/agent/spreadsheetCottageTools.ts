import { cottageTool, type CottageTool } from '@/agent/runtime/tool';
import {
  isOptionalToolEnabled,
  type SpreadsheetToolName,
} from './toolCatalog';
import { getActiveChatReferences } from '../chat/activeReferences';
import { readSpreadsheet, writeOfficeDocument } from './officeDocuments';
import { normalizeSpreadsheetRange } from './officeRanges';
import { resolveWriteSpreadsheetOptions } from './resolveWriteSpreadsheetOptions';
import {
  spreadsheetRangeSchema,
  toolReadSpreadsheetInputSchema,
  toolWriteSpreadsheetInputSchema,
} from './spreadsheetWriteSchema';

export const createSpreadsheetCottageTools = (options: {
  enabledTools: readonly string[];
  onMutate?: () => void | Promise<void>;
}): CottageTool[] => {
  const notify = async () => {
    await options.onMutate?.();
  };
  const enabled = options.enabledTools;
  const tools: CottageTool[] = [];

  const add = (name: SpreadsheetToolName, t: CottageTool) => {
    if (isOptionalToolEnabled(enabled, name)) tools.push(t);
  };

  add(
    'readSpreadsheet',
    cottageTool(
      async (input) => {
        const range = input.spreadsheetRange
          ? normalizeSpreadsheetRange(
              spreadsheetRangeSchema.parse(input.spreadsheetRange).sheet,
              input.spreadsheetRange,
            )
          : undefined;
        const data = await readSpreadsheet(input.path, {
          sheet: input.sheet,
          maxRows: input.maxRows,
          range,
        });
        return { kind: 'spreadsheet', path: input.path, ...data };
      },
      {
        name: 'readSpreadsheet',
        description:
          '读取表格文件（xlsx/xls/csv）。返回 sheets 对象。' +
          '可用 sheet、spreadsheetRange（sheet+a1 如 "B2:D5" 或行列号）只读区域。',
        schema: toolReadSpreadsheetInputSchema,
      },
    ),
  );

  add(
    'writeSpreadsheet',
    cottageTool(
      async (input) => {
        const resolved = await resolveWriteSpreadsheetOptions(
          input,
          getActiveChatReferences(),
        );
        const result = await writeOfficeDocument(
          input.path,
          resolved.content,
          {
            mode: resolved.mode,
            target: resolved.target,
          },
        );
        await notify();
        return result;
      },
      {
        name: 'writeSpreadsheet',
        description:
          '写入表格（xlsx/xls/csv）。修改若干单元格时务必 mode=patch（勿 replace 整表），' +
          '须提供 target.spreadsheetRange（sheet+a1，与用户引用 range 一致），content.cells 为范围内新值。' +
          '用户消息含 file_reference 且带 range 时，cells 尺寸匹配可自动 patch。仅整表替换时用 mode=replace；' +
          'replace 时可传 content.style（header/colWidths/freezeHeader）美化表头与列宽。',
        schema: toolWriteSpreadsheetInputSchema,
      },
    ),
  );

  return tools;
};
