import { z } from 'zod';

export const spreadsheetCellSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export type SpreadsheetCell = z.infer<typeof spreadsheetCellSchema>;

export type SpreadsheetRows = SpreadsheetCell[][];

export type SpreadsheetSheetsMap = Record<string, SpreadsheetRows>;

const rowsSchema = z.array(z.array(spreadsheetCellSchema));

const sheetEntrySchema = z.object({
  name: z.string().optional(),
  sheet: z.string().optional(),
  rows: rowsSchema,
});

export const spreadsheetRangeSchema = z
  .object({
    sheet: z.string(),
    a1: z.string().optional(),
    startRow: z.number().int().min(1).optional(),
    startCol: z.number().int().min(1).optional(),
    endRow: z.number().int().min(1).optional(),
    endCol: z.number().int().min(1).optional(),
  })
  .refine(
    (v) =>
      v.a1 != null ||
      (v.startRow != null &&
        v.startCol != null &&
        v.endRow != null &&
        v.endCol != null),
    { message: 'spreadsheetRange 须提供 a1（如 B2:D5）或 startRow/startCol/endRow/endCol' },
  );

export const wordRangeSchema = z.object({
  startParagraph: z.number().int().min(1),
  endParagraph: z.number().int().min(1),
});

/** 将模型常见的多种 sheets 写法统一为 { [sheetName]: rows[][] } */
export const normalizeSpreadsheetSheets = (
  sheets: unknown,
  sheetNames?: string[],
): SpreadsheetSheetsMap => {
  if (!sheets) {
    throw new Error('表格 content 缺少 sheets');
  }

  if (!Array.isArray(sheets)) {
    if (typeof sheets === 'object' && sheets !== null) {
      const record = sheets as Record<string, unknown>;
      const out: SpreadsheetSheetsMap = {};
      for (const [name, value] of Object.entries(record)) {
        if (!Array.isArray(value)) {
          throw new Error(`sheets["${name}"] 必须是二维数组`);
        }
        out[name] = value as SpreadsheetRows;
      }
      if (Object.keys(out).length) return out;
    }
    throw new Error(
      'sheets 须为对象（如 {"Sheet1":[[...]]}），或单表二维数组配合 sheetNames',
    );
  }

  if (sheets.length === 0) {
    const name = sheetNames?.[0] ?? 'Sheet1';
    return { [name]: [] };
  }

  const first = sheets[0];

  if (Array.isArray(first)) {
    const name = sheetNames?.[0] ?? 'Sheet1';
    return { [name]: sheets as SpreadsheetRows };
  }

  if (first && typeof first === 'object' && 'rows' in first) {
    const out: SpreadsheetSheetsMap = {};
    for (const entry of sheets as z.infer<typeof sheetEntrySchema>[]) {
      const parsed = sheetEntrySchema.safeParse(entry);
      if (!parsed.success) {
        throw new Error('sheets 数组项须为 { name?, rows } 或二维数组');
      }
      const name = parsed.data.name ?? parsed.data.sheet ?? sheetNames?.[0];
      if (!name) {
        throw new Error('多表写入时每个 sheets 项须提供 name，或使用 sheets 对象');
      }
      out[name] = parsed.data.rows;
    }
    return out;
  }

  throw new Error(
    'sheets 格式无效：使用 {"工作表名":[[单元格]]}，或 [[行]] + sheetNames: ["工作表名"]',
  );
};

const structuredWriteBaseSchema = z.object({
  sheets: z.unknown().optional(),
  sheetNames: z.array(z.string()).optional(),
  rows: rowsSchema.optional(),
  /** patch 表格：与 target.spreadsheetRange 行列数一致的二维数组 */
  cells: rowsSchema.optional(),
  style: z
    .object({
      header: z.boolean().optional(),
      colWidths: z.array(z.number()).optional(),
      freezeHeader: z.boolean().optional(),
    })
    .optional(),
  paragraphs: z.array(z.string()).optional(),
  slides: z
    .array(
      z.object({
        title: z.string().optional(),
        bullets: z.array(z.string()).optional(),
        notes: z.string().optional(),
      }),
    )
    .optional(),
  slide: z
    .object({
      title: z.string().optional(),
      bullets: z.array(z.string()).optional(),
      notes: z.string().optional(),
      textIndex: z.number().int().min(1).optional(),
      text: z.string().optional(),
    })
    .optional(),
});

export type StructuredWriteInput = z.infer<typeof structuredWriteBaseSchema>;

export const normalizeStructuredWriteContent = (
  content: StructuredWriteInput,
): StructuredWriteInput => {
  if (content.cells !== undefined) {
    const name =
      content.sheetNames?.[0] ??
      (typeof content.sheets === 'object' &&
      content.sheets !== null &&
      !Array.isArray(content.sheets)
        ? Object.keys(content.sheets as object)[0]
        : undefined) ??
      'Sheet1';
    return {
      ...content,
      sheets: { [name]: content.cells },
      sheetNames: [name],
      cells: undefined,
    };
  }

  let sheets = content.sheets;
  if (sheets === undefined && content.rows !== undefined) {
    sheets = content.rows;
  }
  if (sheets === undefined) {
    return content;
  }

  const sheetNames =
    content.sheetNames ??
    (Array.isArray(sheets) &&
    sheets.length > 0 &&
    typeof sheets[0] === 'object' &&
    !Array.isArray(sheets[0]) &&
    sheets[0] !== null
      ? (sheets as { name?: string; sheet?: string }[])
          .map((e) => e.name ?? e.sheet)
          .filter((n): n is string => Boolean(n))
      : undefined);

  const normalizedSheets = normalizeSpreadsheetSheets(sheets, sheetNames);
  const names = content.sheetNames?.length
    ? content.sheetNames
    : Object.keys(normalizedSheets);

  return {
    ...content,
    sheets: normalizedSheets,
    sheetNames: names,
    rows: undefined,
  };
};

export const structuredWriteContentSchema = structuredWriteBaseSchema.transform(
  (data) => normalizeStructuredWriteContent(data),
);

export const writeContentSchema = z.union([
  z.string(),
  structuredWriteContentSchema,
]);

/** 工具绑定用：无 z.refine / 无 union，避免 Moonshot 等厂商拒绝 $ref、anyOf */
const spreadsheetRangeToolSchema = z.object({
  sheet: z.string(),
  a1: z.string().optional(),
  startRow: z.number().int().min(1).optional(),
  startCol: z.number().int().min(1).optional(),
  endRow: z.number().int().min(1).optional(),
  endCol: z.number().int().min(1).optional(),
});

const spreadsheetPatchTargetToolSchema = z.object({
  spreadsheetRange: spreadsheetRangeToolSchema.optional(),
});

/** 工具绑定用：仅表格字段，避免 Moonshot 等厂商拒绝 $ref、anyOf */
const spreadsheetContentToolSchema = z.object({
  sheets: z.record(z.string(), z.array(z.array(z.any()))).optional(),
  sheetNames: z.array(z.string()).optional(),
  rows: z.array(z.array(z.any())).optional(),
  cells: z.array(z.array(z.any())).optional(),
  style: z
    .object({
      header: z.boolean().optional().describe('首行表头美化，默认 true'),
      colWidths: z.array(z.number()).optional().describe('列宽（字符数）'),
      freezeHeader: z.boolean().optional().describe('冻结首行，默认随 header'),
    })
    .optional()
    .describe('整表样式（replace 时生效；csv 忽略）'),
});

export const toolReadSpreadsheetInputSchema = z.object({
  path: z.string(),
  sheet: z.string().optional(),
  maxRows: z.number().int().optional(),
  spreadsheetRange: spreadsheetRangeToolSchema.optional(),
});

export const toolWriteSpreadsheetInputSchema = z.object({
  path: z.string(),
  mode: z.enum(['replace', 'patch']).optional(),
  target: spreadsheetPatchTargetToolSchema.optional(),
  content: spreadsheetContentToolSchema,
});

/** 工具入参 → writeContentSchema 可解析的形态 */
export const normalizeToolWriteContent = (raw: unknown): unknown => {
  if (raw === null || raw === undefined) return raw;
  if (typeof raw === 'string') return raw;
  if (typeof raw !== 'object') return raw;

  return raw;
};
