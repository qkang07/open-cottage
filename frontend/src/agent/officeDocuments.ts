// ── 重型库延迟加载（避免打入初始 bundle） ──
// xlsx-js-style：SheetJS API 兼容且支持 cell.s 样式写入
let _xlsxMod: typeof import('xlsx-js-style') | null = null;
const getXLSX = async () => _xlsxMod ??= await import('xlsx-js-style');

type JSZipModule = typeof import('jszip');
let _jszipMod: JSZipModule | null = null;
const getJSZip = async (): Promise<JSZipModule> => {
  if (_jszipMod) return _jszipMod;
  const mod = await import('jszip');
  // export= CJS：Vite 运行时通常挂在 .default
  _jszipMod = (mod as unknown as { default?: JSZipModule }).default ?? (mod as unknown as JSZipModule);
  return _jszipMod;
};

type MammothModule = typeof import('mammoth');
let _mammothMod: MammothModule | null = null;
const getMammoth = async (): Promise<MammothModule> => {
  if (_mammothMod) return _mammothMod;
  const mod = await import('mammoth');
  _mammothMod = (mod as unknown as { default?: MammothModule }).default ?? (mod as MammothModule);
  return _mammothMod;
};

let _pptxgenMod: typeof import('pptxgenjs').default | null = null;
const getPptxgen = async () => _pptxgenMod ??= (await import('pptxgenjs')).default;

let _docxMod: typeof import('docx') | null = null;
const getDocx = async () => _docxMod ??= await import('docx');
import {
  formatSpreadsheetRange,
  normalizeSpreadsheetRange,
  normalizeWordRange,
  splitWordParagraphs,
  type PresentationTarget,
  type SpreadsheetRange,
  type WordRange,
} from './officeRanges';
import { workspace } from '../workspace/FileSystemWorkspace';

export type OfficeDocumentKind = 'spreadsheet' | 'word' | 'presentation';

const SPREADSHEET_EXT = new Set(['xlsx', 'xls', 'csv']);
const WORD_EXT = new Set(['docx']);
const PRESENTATION_EXT = new Set(['pptx']);

export const detectOfficeKind = (path: string): OfficeDocumentKind | null => {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (SPREADSHEET_EXT.has(ext)) return 'spreadsheet';
  if (WORD_EXT.has(ext)) return 'word';
  if (PRESENTATION_EXT.has(ext)) return 'presentation';
  return null;
};

export const isOfficeDocumentPath = (path: string): boolean =>
  detectOfficeKind(path) !== null;

const extOf = (path: string) => path.split('.').pop()?.toLowerCase() ?? '';

export type SpreadsheetContent = {
  sheets: Record<string, (string | number | boolean | null)[][]>;
  sheetNames: string[];
  /** 整表写入样式（patch 忽略） */
  style?: SpreadsheetStyleOptions;
};

export type SpreadsheetStyleOptions = {
  /** 首行表头美化，默认 true */
  header?: boolean;
  /** 列宽（字符宽度） */
  colWidths?: number[];
  /** 冻结首行，默认与 header 一致 */
  freezeHeader?: boolean;
};

export type WordThemeName =
  | 'minimal-light'
  | 'dark-tech'
  | 'consulting-clean';

export type WordTheme = {
  name?: WordThemeName;
  text?: string;
  accent?: string;
  fontFace?: string;
};

export type WordBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string; bold?: boolean }
  | { type: 'bullet'; items: string[] }
  | { type: 'numbered'; items: string[] }
  | { type: 'table'; headers?: string[]; rows: string[][] }
  | { type: 'image'; path: string; width?: number; height?: number; alt?: string }
  | { type: 'columns'; count: 2 | 3; children: WordBlock[] };

export type WordHeaderOptions = {
  text?: string;
  left?: string;
  right?: string;
};

export type WordFooterOptions = {
  text?: string;
  pageNumber?: boolean;
};

export type WordWriteInput = {
  /** 兼容旧版：纯段落；有 blocks 时可省略 */
  paragraphs?: string[];
  blocks?: WordBlock[];
  theme?: WordTheme;
  header?: WordHeaderOptions;
  footer?: WordFooterOptions;
};

/** 内置风格预设，与 ppt-beautifier 技能保持一致 */
export type PresentationThemeName =
  | 'minimal-light'
  | 'dark-tech'
  | 'consulting-clean';

/** 幻灯片版式：封面 / 章节分隔 / 正文 */
export type PresentationSlideLayout = 'cover' | 'section' | 'content';

/** 演示文稿主题；可选 name 套用预设，并允许逐项覆盖设计令牌（hex 可带或不带 #） */
export type PresentationTheme = {
  name?: PresentationThemeName;
  /** 背景色 */
  background?: string;
  /** 正文/标题文字色 */
  text?: string;
  /** 强调色（标题、强调条） */
  accent?: string;
  /** 字体（中文建议 Noto Sans SC / 微软雅黑） */
  fontFace?: string;
};

export type PresentationSlide = {
  title?: string;
  /** 副标题，常用于封面 */
  subtitle?: string;
  bullets?: string[];
  notes?: string;
  /** 版式；缺省 content，首页若未指定则按 cover 处理 */
  layout?: PresentationSlideLayout;
  /** 单页背景色覆盖（hex） */
  background?: string;
  /** 单页强调色覆盖（hex） */
  accent?: string;
};

export type PresentationWriteInput = {
  slides: PresentationSlide[];
  /** 全局主题，套用到每一页 */
  theme?: PresentationTheme;
};

export type DocumentWriteContent =
  | string
  | SpreadsheetContent
  | WordWriteInput
  | PresentationWriteInput;

export type ReadOfficeOptions = {
  sheet?: string;
  maxRows?: number;
  /** 表格范围：sheet 必填，可用 a1 如 "B2:D5" 或 startRow/startCol/endRow/endCol */
  spreadsheetRange?: SpreadsheetRange | { sheet: string; a1: string };
  /** Word 段落范围（1-based，含端点） */
  wordRange?: WordRange;
  /** 仅读取指定幻灯片（1-based） */
  slideIndex?: number;
  /** 仅读取幻灯片内第 N 个文本块（1-based，需配合 slideIndex） */
  textIndex?: number;
};

export type PatchOfficeTarget = {
  spreadsheetRange?: SpreadsheetRange | { sheet: string; a1: string };
  wordRange?: WordRange;
  presentationTarget?: PresentationTarget;
};

export type WriteOfficeOptions = {
  /** replace：整文件覆盖（默认）；patch：仅修改 target 指定范围 */
  mode?: 'replace' | 'patch';
  target?: PatchOfficeTarget;
};

export type SpreadsheetPatchInput = {
  cells: (string | number | boolean | null)[][];
};

export type WordPatchInput = {
  paragraphs: string[];
};

export type PresentationPatchInput = {
  slide: {
    title?: string;
    bullets?: string[];
    notes?: string;
    /** 替换第 textIndex 个文本块（1-based） */
    textIndex?: number;
    text?: string;
  };
};

type StructuredWriteInput = {
  sheets?: SpreadsheetContent['sheets'];
  sheetNames?: string[];
  paragraphs?: string[];
  slides?: PresentationWriteInput['slides'];
  theme?: PresentationTheme;
  slide?: PresentationPatchInput['slide'];
  cells?: (string | number | boolean | null)[][];
};

const cellValue = (value: unknown): string | number | boolean | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  return String(value);
};

const sheetToRows = (sheet: any, maxRows?: number, XLSX?: any): (string | number | boolean | null)[][] => {
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    raw: false,
  }) as unknown[][];
  const mapped = rows.map((row) =>
    (Array.isArray(row) ? row : []).map((cell) => cellValue(cell)),
  );
  if (maxRows && maxRows > 0) return mapped.slice(0, maxRows);
  return mapped;
};

const sliceSpreadsheetRange = (
  rows: (string | number | boolean | null)[][],
  range: SpreadsheetRange,
): (string | number | boolean | null)[][] => {
  const out: (string | number | boolean | null)[][] = [];
  for (let r = range.startRow; r <= range.endRow; r++) {
    const row = rows[r - 1] ?? [];
    const line: (string | number | boolean | null)[] = [];
    for (let c = range.startCol; c <= range.endCol; c++) {
      line.push(row[c - 1] ?? null);
    }
    out.push(line);
  }
  return out;
};

/** SheetJS 对无 BOM 的 UTF-8 CSV 默认按 Latin-1 解字节，需显式 codepage 65001。 */
const readWorkbookFromBytes = (
  XLSX: typeof import('xlsx-js-style'),
  bytes: Uint8Array,
  path: string,
) => {
  const opts: { type: 'array'; codepage?: number } = { type: 'array' };
  if (extOf(path) === 'csv') opts.codepage = 65001;
  return XLSX.read(bytes, opts);
};

export const readSpreadsheet = async (
  path: string,
  options?: { sheet?: string; maxRows?: number; range?: SpreadsheetRange },
): Promise<SpreadsheetContent & { range?: SpreadsheetRange; rangeLabel?: string }> => {
  const bytes = await workspace.readFileBytes(path);
  if (!bytes.byteLength) {
    return { sheets: {}, sheetNames: [] };
  }
  const XLSX = await getXLSX();
  const workbook = readWorkbookFromBytes(XLSX, bytes, path);
  const sheetNames = workbook.SheetNames;
  const targetNames = options?.sheet
    ? sheetNames.filter((n) => n === options.sheet)
    : sheetNames;
  if (options?.sheet && !targetNames.length) {
    throw new Error(`工作表不存在: ${options.sheet}`);
  }
  const sheets: SpreadsheetContent['sheets'] = {};
  for (const name of targetNames) {
    const sheet = workbook.Sheets[name];
    if (sheet) sheets[name] = sheetToRows(sheet, options?.maxRows, XLSX);
  }

  if (options?.range) {
    const range = options.range;
    const rows = sheets[range.sheet];
    if (!rows) {
      throw new Error(`工作表不存在: ${range.sheet}`);
    }
    return {
      sheets: { [range.sheet]: sliceSpreadsheetRange(rows, range) },
      sheetNames: [range.sheet],
      range,
      rangeLabel: formatSpreadsheetRange(range),
    };
  }

  return { sheets, sheetNames };
};

const docxArrayBuffer = async (path: string): Promise<ArrayBuffer> => {
  const ext = extOf(path);
  if (ext !== 'docx') {
    throw new Error('仅支持 .docx；旧版 .doc 请先转换为 docx');
  }
  const bytes = await workspace.readFileBytes(path);
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
};

export const readWordDocument = async (
  path: string,
  options?: { wordRange?: WordRange },
): Promise<{
  text: string;
  paragraphs: string[];
  wordRange?: WordRange;
}> => {
  const buffer = await docxArrayBuffer(path);
  const mammoth = await getMammoth();
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  const allParagraphs = splitWordParagraphs(result.value.trim());
  if (!options?.wordRange) {
    return {
      text: result.value.trim(),
      paragraphs: allParagraphs,
    };
  }
  const range = normalizeWordRange(options.wordRange);
  const slice = allParagraphs.slice(range.startParagraph - 1, range.endParagraph);
  return {
    text: slice.join('\n\n'),
    paragraphs: slice,
    wordRange: range,
  };
};

export const readWordDocumentHtml = async (path: string): Promise<{ html: string }> => {
  const buffer = await docxArrayBuffer(path);
  const mammoth = await getMammoth();
  const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
  return { html: result.value };
};

const extractXmlTexts = (xml: string): string[] => {
  const texts: string[] = [];
  const re = /<a:t[^>]*>([^<]*)<\/a:t>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    const t = match[1].trim();
    if (t) texts.push(t);
  }
  return texts;
};

export const readPresentation = async (
  path: string,
  options?: { slideIndex?: number; textIndex?: number },
): Promise<{
  slides: { index: number; texts: string[] }[];
  slideIndex?: number;
  textIndex?: number;
}> => {
  const ext = extOf(path);
  if (ext !== 'pptx') {
    throw new Error('仅支持 .pptx；旧版 .ppt 请先转换为 pptx');
  }
  const bytes = await workspace.readFileBytes(path);
  const JSZip = await getJSZip();
  const zip = await JSZip.loadAsync(bytes);
  const slideEntries = Object.keys(zip.files)
    .filter((name) => /ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)/i)?.[1] ?? 0);
      const nb = Number(b.match(/slide(\d+)/i)?.[1] ?? 0);
      return na - nb;
    });

  const slides: { index: number; texts: string[] }[] = [];
  for (let i = 0; i < slideEntries.length; i += 1) {
    const name = slideEntries[i];
    const xml = await zip.file(name)!.async('string');
    slides.push({ index: i + 1, texts: extractXmlTexts(xml) });
  }

  if (options?.slideIndex != null) {
    const slide = slides.find((s) => s.index === options.slideIndex);
    if (!slide) {
      throw new Error(`幻灯片不存在: ${options.slideIndex}`);
    }
    if (options.textIndex != null) {
      const block = slide.texts[options.textIndex - 1];
      if (block === undefined) {
        throw new Error(
          `幻灯片 ${options.slideIndex} 无文本块 #${options.textIndex}`,
        );
      }
      return {
        slides: [{ index: slide.index, texts: [block] }],
        slideIndex: options.slideIndex,
        textIndex: options.textIndex,
      };
    }
    return { slides: [slide], slideIndex: options.slideIndex };
  }

  return { slides };
};

export const readOfficeDocument = async (
  path: string,
  options?: ReadOfficeOptions,
) => {
  const kind = detectOfficeKind(path);
  if (!kind) {
    throw new Error('不支持的文档格式，请使用 xlsx/xls/csv/docx/pptx');
  }
  if (kind === 'spreadsheet') {
    const range = options?.spreadsheetRange
      ? normalizeSpreadsheetRange(
          options.spreadsheetRange.sheet,
          options.spreadsheetRange,
        )
      : undefined;
    const sheet = range?.sheet ?? options?.sheet;
    const data = await readSpreadsheet(path, {
      sheet,
      maxRows: options?.maxRows,
      range,
    });
    return { kind, path, ...data };
  }
  if (kind === 'word') {
    const data = await readWordDocument(path, {
      wordRange: options?.wordRange,
    });
    return { kind, path, ...data };
  }
  const data = await readPresentation(path, {
    slideIndex: options?.slideIndex,
    textIndex: options?.textIndex,
  });
  return { kind, path, ...data };
};

export const writeSpreadsheet = async (
  path: string,
  content: SpreadsheetContent,
) => {
  const XLSX = await getXLSX();
  const workbook = XLSX.utils.book_new();
  const names = content.sheetNames?.length
    ? content.sheetNames
    : Object.keys(content.sheets);
  if (!names.length) throw new Error('表格内容为空');

  const styleOpts = content.style ?? {};
  const useHeader = styleOpts.header !== false;
  const freezeHeader = styleOpts.freezeHeader ?? useHeader;
  const ext = extOf(path);
  const isCsv = ext === 'csv';

  const headerStyle = {
    font: { bold: true, color: { rgb: '0F172A' } },
    fill: { fgColor: { rgb: 'E2E8F0' } },
    border: {
      top: { style: 'thin', color: { rgb: 'CBD5E1' } },
      bottom: { style: 'thin', color: { rgb: 'CBD5E1' } },
      left: { style: 'thin', color: { rgb: 'CBD5E1' } },
      right: { style: 'thin', color: { rgb: 'CBD5E1' } },
    },
    alignment: { vertical: 'center', wrapText: true },
  };
  const cellBorder = {
    top: { style: 'thin', color: { rgb: 'E2E8F0' } },
    bottom: { style: 'thin', color: { rgb: 'E2E8F0' } },
    left: { style: 'thin', color: { rgb: 'E2E8F0' } },
    right: { style: 'thin', color: { rgb: 'E2E8F0' } },
  };

  for (const name of names) {
    const rows = content.sheets[name] ?? [];
    const sheet = XLSX.utils.aoa_to_sheet(rows);

    if (!isCsv && rows.length) {
      const colCount = Math.max(0, ...rows.map((r) => r.length));
      if (useHeader && rows[0]) {
        for (let c = 0; c < colCount; c++) {
          const addr = XLSX.utils.encode_cell({ r: 0, c });
          const cell = sheet[addr] ?? { t: 's', v: '' };
          cell.s = headerStyle;
          sheet[addr] = cell;
        }
      }
      for (let r = useHeader ? 1 : 0; r < rows.length; r++) {
        for (let c = 0; c < colCount; c++) {
          const addr = XLSX.utils.encode_cell({ r, c });
          if (!sheet[addr]) continue;
          sheet[addr].s = {
            ...(sheet[addr].s ?? {}),
            border: cellBorder,
            alignment: { vertical: 'center', wrapText: true },
          };
        }
      }

      if (styleOpts.colWidths?.length) {
        sheet['!cols'] = styleOpts.colWidths.map((w) => ({ wch: w }));
      } else {
        const widths: number[] = [];
        for (let c = 0; c < colCount; c++) {
          let max = 8;
          for (const row of rows) {
            const v = row[c];
            if (v == null) continue;
            max = Math.max(max, Math.min(40, String(v).length + 2));
          }
          widths.push(max);
        }
        sheet['!cols'] = widths.map((wch) => ({ wch }));
      }

      if (freezeHeader) {
        sheet['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' };
        sheet['!views'] = [{ state: 'frozen', ySplit: 1, topLeftCell: 'A2' }];
      }
    }

    XLSX.utils.book_append_sheet(workbook, sheet, name.slice(0, 31) || 'Sheet1');
  }

  const bookType: any =
    ext === 'csv' ? 'csv' : ext === 'xls' ? 'biff8' : 'xlsx';
  const out = XLSX.write(workbook, { type: 'array', bookType });
  await workspace.writeFileBytes(path, out);
  return {
    path,
    written: true,
    sheetCount: names.length,
    styled: !isCsv && useHeader,
  };
};

type ResolvedWordTheme = {
  text: string;
  accent: string;
  fontFace: string;
};

const WORD_THEME_PRESETS: Record<WordThemeName, ResolvedWordTheme> = {
  'minimal-light': { text: '0F172A', accent: '2563EB', fontFace: 'Noto Sans SC' },
  'dark-tech': { text: '1E293B', accent: '0891B2', fontFace: 'Noto Sans SC' },
  'consulting-clean': { text: '111827', accent: '0EA5E9', fontFace: 'Noto Sans SC' },
};

const resolveWordTheme = (theme?: WordTheme): ResolvedWordTheme => {
  const preset =
    WORD_THEME_PRESETS[theme?.name ?? 'minimal-light'] ?? WORD_THEME_PRESETS['minimal-light'];
  const hex = (v?: string) => {
    if (!v) return undefined;
    const h = v.trim().replace(/^#/, '').toUpperCase();
    return /^[0-9A-F]{6}$/.test(h) ? h : undefined;
  };
  return {
    text: hex(theme?.text) ?? preset.text,
    accent: hex(theme?.accent) ?? preset.accent,
    fontFace: theme?.fontFace?.trim() || preset.fontFace,
  };
};

const paragraphsFromBlocks = (blocks: WordBlock[]): string[] => {
  const out: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case 'heading':
      case 'paragraph':
        out.push(b.text);
        break;
      case 'bullet':
      case 'numbered':
        out.push(...(b.items ?? []));
        break;
      case 'table':
        if (b.headers?.length) out.push(b.headers.join('\t'));
        for (const row of b.rows ?? []) out.push(row.join('\t'));
        break;
      case 'image':
        out.push(`[image:${b.path}]`);
        break;
      case 'columns':
        out.push(...paragraphsFromBlocks(b.children ?? []));
        break;
      default:
        break;
    }
  }
  return out.length ? out : [''];
};

const imageMediaType = (
  path: string,
): 'jpg' | 'png' | 'gif' | 'bmp' => {
  const ext = extOf(path);
  if (ext === 'jpg' || ext === 'jpeg') return 'jpg';
  if (ext === 'gif') return 'gif';
  if (ext === 'bmp') return 'bmp';
  return 'png';
};

export const writeWordDocument = async (path: string, content: WordWriteInput) => {
  const ext = extOf(path);
  if (ext !== 'docx') throw new Error('Word 仅支持写入 .docx');

  const docx = await getDocx();
  const theme = resolveWordTheme(content.theme);
  const blocks: WordBlock[] =
    content.blocks?.length
      ? content.blocks
      : (content.paragraphs?.length ? content.paragraphs : ['']).map((text) => ({
          type: 'paragraph' as const,
          text,
        }));

  const thinBorder = {
    style: docx.BorderStyle.SINGLE,
    size: 4,
    color: 'CBD5E1',
  };
  const tableBorders = {
    top: thinBorder,
    bottom: thinBorder,
    left: thinBorder,
    right: thinBorder,
    insideHorizontal: thinBorder,
    insideVertical: thinBorder,
  };

  const runOpts = (opts?: { bold?: boolean; size?: number; color?: string }) => ({
    font: theme.fontFace,
    color: opts?.color ?? theme.text,
    bold: opts?.bold,
    size: opts?.size,
  });

  const buildBlocks = async (
    items: WordBlock[],
    depth = 0,
  ): Promise<InstanceType<typeof docx.Paragraph | typeof docx.Table>[]> => {
    const children: InstanceType<typeof docx.Paragraph | typeof docx.Table>[] = [];
    for (const block of items) {
      switch (block.type) {
        case 'heading': {
          const level =
            block.level === 1
              ? docx.HeadingLevel.HEADING_1
              : block.level === 2
                ? docx.HeadingLevel.HEADING_2
                : docx.HeadingLevel.HEADING_3;
          const size = block.level === 1 ? 32 : block.level === 2 ? 26 : 24;
          children.push(
            new docx.Paragraph({
              heading: level,
              spacing: { before: 280, after: 120 },
              children: [
                new docx.TextRun({
                  text: block.text,
                  ...runOpts({ bold: true, size, color: theme.accent }),
                }),
              ],
            }),
          );
          break;
        }
        case 'paragraph':
          children.push(
            new docx.Paragraph({
              spacing: { after: 160 },
              children: [
                new docx.TextRun({
                  text: block.text,
                  ...runOpts({ bold: block.bold, size: 22 }),
                }),
              ],
            }),
          );
          break;
        case 'bullet':
          for (const item of block.items ?? []) {
            children.push(
              new docx.Paragraph({
                numbering: { reference: 'bullets', level: 0 },
                spacing: { after: 80 },
                children: [new docx.TextRun({ text: item, ...runOpts({ size: 22 }) })],
              }),
            );
          }
          break;
        case 'numbered':
          for (const item of block.items ?? []) {
            children.push(
              new docx.Paragraph({
                numbering: { reference: 'numbers', level: 0 },
                spacing: { after: 80 },
                children: [new docx.TextRun({ text: item, ...runOpts({ size: 22 }) })],
              }),
            );
          }
          break;
        case 'table': {
          const headers = block.headers ?? [];
          const rows = block.rows ?? [];
          const tableRows: InstanceType<typeof docx.TableRow>[] = [];
          if (headers.length) {
            tableRows.push(
              new docx.TableRow({
                children: headers.map(
                  (h) =>
                    new docx.TableCell({
                      borders: tableBorders,
                      width: { size: Math.floor(9000 / Math.max(headers.length, 1)), type: docx.WidthType.DXA },
                      shading: { type: docx.ShadingType.CLEAR, fill: 'E2E8F0' },
                      children: [
                        new docx.Paragraph({
                          children: [
                            new docx.TextRun({
                              text: h,
                              ...runOpts({ bold: true, size: 20 }),
                            }),
                          ],
                        }),
                      ],
                    }),
                ),
              }),
            );
          }
          for (const row of rows) {
            const cols = Math.max(row.length, headers.length, 1);
            tableRows.push(
              new docx.TableRow({
                children: Array.from({ length: cols }, (_, i) => {
                  const text = row[i] ?? '';
                  return new docx.TableCell({
                    borders: tableBorders,
                    width: { size: Math.floor(9000 / cols), type: docx.WidthType.DXA },
                    children: [
                      new docx.Paragraph({
                        children: [
                          new docx.TextRun({ text, ...runOpts({ size: 20 }) }),
                        ],
                      }),
                    ],
                  });
                }),
              }),
            );
          }
          if (tableRows.length) {
            children.push(
              new docx.Table({
                width: { size: 9000, type: docx.WidthType.DXA },
                rows: tableRows,
              }),
            );
            children.push(new docx.Paragraph({ children: [] }));
          }
          break;
        }
        case 'image': {
          try {
            const bytes = await workspace.readFileBytes(block.path);
            if (!bytes?.length) throw new Error('empty');
            const w = block.width ?? 480;
            const h = block.height ?? Math.round(w * 0.6);
            children.push(
              new docx.Paragraph({
                spacing: { before: 120, after: 120 },
                children: [
                  new docx.ImageRun({
                    type: imageMediaType(block.path),
                    data: bytes,
                    transformation: { width: w, height: h },
                    altText: {
                      title: block.alt ?? block.path,
                      description: block.alt ?? block.path,
                      name: block.path,
                    },
                  }),
                ],
              }),
            );
            if (block.alt) {
              children.push(
                new docx.Paragraph({
                  alignment: docx.AlignmentType.CENTER,
                  spacing: { after: 160 },
                  children: [
                    new docx.TextRun({
                      text: block.alt,
                      italics: true,
                      size: 18,
                      color: '64748B',
                      font: theme.fontFace,
                    }),
                  ],
                }),
              );
            }
          } catch {
            children.push(
              new docx.Paragraph({
                children: [
                  new docx.TextRun({
                    text: `[无法嵌入图片: ${block.path}]`,
                    ...runOpts({ size: 20, color: 'DC2626' }),
                  }),
                ],
              }),
            );
          }
          break;
        }
        case 'columns': {
          if (depth > 0) {
            children.push(...(await buildBlocks(block.children ?? [], depth + 1)));
            break;
          }
          const cols = block.count === 3 ? 3 : 2;
          const colBlocks = block.children ?? [];
          const perCol = Math.ceil(colBlocks.length / cols) || 1;
          const colCells: InstanceType<typeof docx.TableCell>[] = [];
          for (let c = 0; c < cols; c++) {
            const slice = colBlocks.slice(c * perCol, (c + 1) * perCol);
            const inner = await buildBlocks(slice, depth + 1);
            colCells.push(
              new docx.TableCell({
                borders: {
                  top: { style: docx.BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                  bottom: { style: docx.BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                  left: { style: docx.BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                  right: { style: docx.BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                },
                width: { size: Math.floor(9000 / cols), type: docx.WidthType.DXA },
                children: inner.length
                  ? inner
                  : [new docx.Paragraph({ children: [] })],
              }),
            );
          }
          children.push(
            new docx.Table({
              width: { size: 9000, type: docx.WidthType.DXA },
              rows: [new docx.TableRow({ children: colCells })],
            }),
          );
          break;
        }
        default:
          break;
      }
    }
    return children;
  };

  const bodyChildren = await buildBlocks(blocks);

  const headerChildren: InstanceType<typeof docx.Paragraph>[] = [];
  if (content.header) {
    const h = content.header;
    if (h.text) {
      headerChildren.push(
        new docx.Paragraph({
          children: [
            new docx.TextRun({ text: h.text, size: 18, color: '64748B', font: theme.fontFace }),
          ],
        }),
      );
    } else if (h.left || h.right) {
      headerChildren.push(
        new docx.Paragraph({
          children: [
            new docx.TextRun({
              text: h.left ?? '',
              size: 18,
              color: '64748B',
              font: theme.fontFace,
            }),
            new docx.TextRun({ text: '\t' }),
            new docx.TextRun({
              text: h.right ?? '',
              size: 18,
              color: '64748B',
              font: theme.fontFace,
            }),
          ],
          tabStops: [{ type: docx.TabStopType.RIGHT, position: 9000 }],
        }),
      );
    }
  }

  const footerChildren: InstanceType<typeof docx.Paragraph>[] = [];
  if (content.footer) {
    const f = content.footer;
    const showPage = f.pageNumber !== false;
    const parts: InstanceType<typeof docx.TextRun>[] = [];
    if (f.text) {
      parts.push(
        new docx.TextRun({ text: f.text, size: 16, color: '94A3B8', font: theme.fontFace }),
      );
    }
    if (showPage) {
      if (parts.length) parts.push(new docx.TextRun({ text: '  ·  ' }));
      parts.push(
        new docx.TextRun({ text: '第 ', size: 16, color: '94A3B8', font: theme.fontFace }),
      );
      parts.push(
        new docx.TextRun({
          children: [docx.PageNumber.CURRENT],
          size: 16,
          color: '94A3B8',
          font: theme.fontFace,
        }),
      );
      parts.push(
        new docx.TextRun({ text: ' 页', size: 16, color: '94A3B8', font: theme.fontFace }),
      );
    }
    if (parts.length) {
      footerChildren.push(
        new docx.Paragraph({
          alignment: docx.AlignmentType.CENTER,
          children: parts,
        }),
      );
    }
  }

  const sectionProps: Record<string, unknown> = {
    page: {
      margin: { top: 720, right: 720, bottom: 720, left: 720 },
    },
  };

  const doc = new docx.Document({
    styles: {
      default: {
        document: {
          run: { font: theme.fontFace, size: 22, color: theme.text },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: 'bullets',
          levels: [
            {
              level: 0,
              format: docx.LevelFormat.BULLET,
              text: '•',
              alignment: docx.AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
        {
          reference: 'numbers',
          levels: [
            {
              level: 0,
              format: docx.LevelFormat.DECIMAL,
              text: '%1.',
              alignment: docx.AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: sectionProps,
        headers: headerChildren.length
          ? { default: new docx.Header({ children: headerChildren }) }
          : undefined,
        footers: footerChildren.length
          ? { default: new docx.Footer({ children: footerChildren }) }
          : undefined,
        children: bodyChildren.length
          ? bodyChildren
          : [new docx.Paragraph({ children: [new docx.TextRun('')] })],
      },
    ],
  });
  const blob = await docx.Packer.toBlob(doc);
  const buffer = await blob.arrayBuffer();
  await workspace.writeFileBytes(path, buffer);
  const paragraphs = paragraphsFromBlocks(blocks);
  return {
    path,
    written: true,
    paragraphCount: paragraphs.length,
    blockCount: blocks.length,
    theme: content.theme?.name ?? 'minimal-light',
  };
};

type ResolvedTheme = {
  background: string;
  text: string;
  accent: string;
  fontFace: string;
};

const PRESENTATION_THEME_PRESETS: Record<PresentationThemeName, ResolvedTheme> = {
  'minimal-light': {
    background: 'F8FAFC',
    text: '0F172A',
    accent: '2563EB',
    fontFace: 'Noto Sans SC',
  },
  'dark-tech': {
    background: '0B1020',
    text: 'E5E7EB',
    accent: '22D3EE',
    fontFace: 'Noto Sans SC',
  },
  'consulting-clean': {
    background: 'FFFFFF',
    text: '111827',
    accent: '0EA5E9',
    fontFace: 'Noto Sans SC',
  },
};

const DEFAULT_PRESENTATION_THEME: PresentationThemeName = 'minimal-light';

/** 归一 hex：去掉 #，转大写；非法值返回 undefined */
const normalizeHex = (value?: string): string | undefined => {
  if (!value) return undefined;
  const hex = value.trim().replace(/^#/, '').toUpperCase();
  return /^[0-9A-F]{6}$/.test(hex) ? hex : undefined;
};

const resolvePresentationTheme = (theme?: PresentationTheme): ResolvedTheme => {
  const preset =
    PRESENTATION_THEME_PRESETS[theme?.name ?? DEFAULT_PRESENTATION_THEME] ??
    PRESENTATION_THEME_PRESETS[DEFAULT_PRESENTATION_THEME];
  return {
    background: normalizeHex(theme?.background) ?? preset.background,
    text: normalizeHex(theme?.text) ?? preset.text,
    accent: normalizeHex(theme?.accent) ?? preset.accent,
    fontFace: theme?.fontFace?.trim() || preset.fontFace,
  };
};

/** 在淡色/深色背景上挑一个低对比的次要文字色（副标题、要点缓和处理） */
const subtleTextColor = (theme: ResolvedTheme): string =>
  theme.background === '0B1020' ? 'A5B4CB' : '475569';

const renderPresentationSlide = (
  s: any,
  slide: PresentationSlide,
  theme: ResolvedTheme,
  isFirst: boolean,
): void => {
  const bg = normalizeHex(slide.background) ?? theme.background;
  const accent = normalizeHex(slide.accent) ?? theme.accent;
  s.background = { color: bg };

  const layout: PresentationSlideLayout =
    slide.layout ?? (isFirst ? 'cover' : 'content');
  const title = slide.title?.trim();
  const subtitle = slide.subtitle?.trim();
  const bullets = (slide.bullets ?? []).filter((b) => b.trim());
  const common = { fontFace: theme.fontFace };

  if (layout === 'cover') {
    if (title) {
      s.addText(title, {
        ...common,
        x: 0.9,
        y: 2.4,
        w: 11.5,
        h: 1.6,
        fontSize: 44,
        bold: true,
        color: theme.text,
        align: 'left',
      });
    }
    s.addShape('rect', {
      x: 0.95,
      y: 4.15,
      w: 2.2,
      h: 0.08,
      fill: { color: accent },
      line: { color: accent },
    });
    if (subtitle) {
      s.addText(subtitle, {
        ...common,
        x: 0.9,
        y: 4.4,
        w: 11.5,
        h: 1.0,
        fontSize: 20,
        color: subtleTextColor(theme),
        align: 'left',
      });
    }
  } else if (layout === 'section') {
    s.addShape('rect', {
      x: 0,
      y: 3.25,
      w: 0.25,
      h: 1.0,
      fill: { color: accent },
      line: { color: accent },
    });
    if (title) {
      s.addText(title, {
        ...common,
        x: 0.9,
        y: 3.0,
        w: 11.5,
        h: 1.5,
        fontSize: 36,
        bold: true,
        color: theme.text,
        align: 'left',
        valign: 'middle',
      });
    }
    if (subtitle) {
      s.addText(subtitle, {
        ...common,
        x: 0.95,
        y: 4.4,
        w: 11.4,
        h: 0.8,
        fontSize: 18,
        color: subtleTextColor(theme),
      });
    }
  } else {
    let y = 0.6;
    if (title) {
      s.addText(title, {
        ...common,
        x: 0.7,
        y,
        w: 12.0,
        h: 0.9,
        fontSize: 30,
        bold: true,
        color: theme.text,
      });
      s.addShape('rect', {
        x: 0.75,
        y: y + 0.95,
        w: 1.6,
        h: 0.06,
        fill: { color: accent },
        line: { color: accent },
      });
      y += 1.35;
    }
    if (subtitle) {
      s.addText(subtitle, {
        ...common,
        x: 0.75,
        y,
        w: 11.9,
        h: 0.6,
        fontSize: 18,
        italic: true,
        color: subtleTextColor(theme),
      });
      y += 0.7;
    }
    if (bullets.length) {
      s.addText(
        bullets.map((text) => ({
          text,
          options: {
            bullet: { characterCode: '2022' },
            fontSize: 18,
            color: theme.text,
            fontFace: theme.fontFace,
            paraSpaceAfter: 10,
          },
        })),
        { x: 0.8, y, w: 11.8, h: 7.5 - y - 0.5, valign: 'top' },
      );
    }
  }

  if (slide.notes?.trim()) {
    s.addNotes(slide.notes.trim());
  }
};

export const writePresentation = async (
  path: string,
  content: PresentationWriteInput,
) => {
  const ext = extOf(path);
  if (ext !== 'pptx') throw new Error('演示文稿仅支持写入 .pptx');

  const theme = resolvePresentationTheme(content.theme);
  const PptxGenJS = await getPptxgen();
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE';
  pres.theme = { bodyFontFace: theme.fontFace, headFontFace: theme.fontFace };

  content.slides.forEach((slide, index) => {
    const s = pres.addSlide();
    renderPresentationSlide(s, slide, theme, index === 0);
  });

  const bytes = (await pres.write({ outputType: 'uint8array' })) as Uint8Array;
  await workspace.writeFileBytes(path, bytes);
  return {
    path,
    written: true,
    slideCount: content.slides.length,
    theme: content.theme?.name ?? DEFAULT_PRESENTATION_THEME,
  };
};

const normalizeWriteContent = (
  path: string,
  content: DocumentWriteContent,
): SpreadsheetContent | WordWriteInput | PresentationWriteInput => {
  const kind = detectOfficeKind(path);
  if (!kind) throw new Error('不支持的文档格式');

  if (typeof content === 'string') {
    if (kind === 'word') {
      const paragraphs = content.split(/\n/).map((line) => line.trimEnd());
      return { paragraphs: paragraphs.length ? paragraphs : [''] };
    }
    throw new Error('字符串 content 仅适用于 Word；表格与演示请使用结构化对象');
  }

  if ('sheets' in content && content.sheets) {
    const rawSheets = content.sheets;
    if (Array.isArray(rawSheets)) {
      throw new Error(
        'sheets 不能为数组，请使用 {"工作表名": [[...]]} 或经工具 schema 规范化后的对象',
      );
    }
    const sheetNames = content.sheetNames ?? Object.keys(rawSheets);
    const style = (content as SpreadsheetContent).style;
    return { sheets: rawSheets, sheetNames, style };
  }
  if (
    ('blocks' in content && (content as WordWriteInput).blocks?.length) ||
    ('paragraphs' in content && (content as WordWriteInput).paragraphs)
  ) {
    const w = content as WordWriteInput & {
      blocks?: WordBlock[];
      theme?: WordTheme;
      header?: WordHeaderOptions;
      footer?: WordFooterOptions;
      paragraphs?: string[];
    };
    const blocks = w.blocks;
    const paragraphs =
      w.paragraphs ??
      (blocks?.length ? paragraphsFromBlocks(blocks) : ['']);
    return {
      paragraphs: paragraphs.length ? paragraphs : [''],
      blocks,
      theme: w.theme,
      header: w.header,
      footer: w.footer,
    };
  }
  if ('slides' in content && content.slides) {
    return {
      slides: content.slides,
      theme: (content as PresentationWriteInput).theme,
    };
  }

  throw new Error('content 格式与目标文件类型不匹配');
};

const presentationSlidesToWriteInput = (
  slides: { index: number; texts: string[] }[],
): PresentationWriteInput => ({
  slides: slides.map((s) => ({
    title: s.texts[0] ?? '',
    bullets: s.texts.slice(1),
  })),
});

export const patchSpreadsheetRange = async (
  path: string,
  range: SpreadsheetRange,
  cells: (string | number | boolean | null)[][],
) => {
  const ext = extOf(path);
  if (ext === 'csv') {
    throw new Error('csv 不支持局部 patch，请用 xlsx 或整表 writeSpreadsheet');
  }

  const expectedRows = range.endRow - range.startRow + 1;
  const expectedCols = range.endCol - range.startCol + 1;
  if (cells.length !== expectedRows) {
    throw new Error(
      `cells 行数应为 ${expectedRows}，实际 ${cells.length}（范围 ${formatSpreadsheetRange(range)}）`,
    );
  }
  for (const row of cells) {
    if (row.length !== expectedCols) {
      throw new Error(
        `cells 列数应为 ${expectedCols}，实际 ${row.length}`,
      );
    }
  }

  const bytes = await workspace.readFileBytes(path);
  const XLSX = await getXLSX();
  const workbook = bytes.byteLength
    ? XLSX.read(bytes, { type: 'array' })
    : XLSX.utils.book_new();

  if (!workbook.SheetNames.includes(range.sheet)) {
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([]),
      range.sheet.slice(0, 31),
    );
  }

  const sheet = workbook.Sheets[range.sheet];
  XLSX.utils.sheet_add_aoa(sheet, cells, {
    origin: { r: range.startRow - 1, c: range.startCol - 1 },
  });

  const bookType: any = ext === 'xls' ? 'biff8' : 'xlsx';
  const out = XLSX.write(workbook, { type: 'array', bookType });
  await workspace.writeFileBytes(path, out);
  return {
    path,
    patched: true,
    sheet: range.sheet,
    range: formatSpreadsheetRange(range),
    rows: expectedRows,
    cols: expectedCols,
  };
};

export const patchWordRange = async (
  path: string,
  wordRange: WordRange,
  paragraphs: string[],
) => {
  const range = normalizeWordRange(wordRange);
  const { paragraphs: all } = await readWordDocument(path);
  const count = range.endParagraph - range.startParagraph + 1;
  if (paragraphs.length !== count) {
    throw new Error(
      `paragraphs 数量应为 ${count}（¶${range.startParagraph}-${range.endParagraph}），实际 ${paragraphs.length}`,
    );
  }
  const merged = [...all];
  merged.splice(range.startParagraph - 1, count, ...paragraphs);
  const result = await writeWordDocument(path, { paragraphs: merged });
  return {
    ...result,
    patched: true,
    wordRange: range,
    paragraphCount: paragraphs.length,
  };
};

export const patchPresentationSlide = async (
  path: string,
  target: PresentationTarget,
  patch: PresentationPatchInput['slide'],
) => {
  const { slides: rawSlides } = await readPresentation(path);
  const writeInput = presentationSlidesToWriteInput(rawSlides);
  const pos = rawSlides.findIndex((s) => s.index === target.slideIndex);
  if (pos < 0) {
    throw new Error(`幻灯片不存在: ${target.slideIndex}`);
  }

  const writeSlide = writeInput.slides[pos];
  const raw = rawSlides[pos];

  if (patch.textIndex != null) {
    if (patch.text === undefined) {
      throw new Error('指定 textIndex 时须提供 content.slide.text');
    }
    const texts = [...raw.texts];
    if (patch.textIndex < 1 || patch.textIndex > texts.length) {
      throw new Error(
        `幻灯片 ${target.slideIndex} 无文本块 #${patch.textIndex}（共 ${texts.length} 块）`,
      );
    }
    texts[patch.textIndex - 1] = patch.text;
    writeSlide.title = texts[0] ?? '';
    writeSlide.bullets = texts.slice(1);
  } else {
    if (patch.title !== undefined) writeSlide.title = patch.title;
    if (patch.bullets !== undefined) writeSlide.bullets = patch.bullets;
  }
  if (patch.notes !== undefined) writeSlide.notes = patch.notes;

  const result = await writePresentation(path, writeInput);
  return {
    ...result,
    patched: true,
    slideIndex: target.slideIndex,
    textIndex: patch.textIndex,
  };
};

const extractSpreadsheetPatchCells = (
  content: SpreadsheetContent,
): (string | number | boolean | null)[][] => {
  const names = content.sheetNames ?? Object.keys(content.sheets);
  const first = names[0];
  if (!first) throw new Error('patch 表格缺少 cells 或 sheets');
  return content.sheets[first] ?? [];
};

const patchOfficeDocument = async (
  path: string,
  content: DocumentWriteContent,
  target: PatchOfficeTarget,
) => {
  const kind = detectOfficeKind(path);
  if (!kind) throw new Error('不支持的文档格式');

  if (kind === 'spreadsheet') {
    if (!target.spreadsheetRange) {
      throw new Error('patch 表格须提供 target.spreadsheetRange（含 sheet 与 a1 或行列）');
    }
    const range = normalizeSpreadsheetRange(
      target.spreadsheetRange.sheet,
      target.spreadsheetRange,
    );
    const normalized = normalizeWriteContent(
      path,
      content,
    ) as SpreadsheetContent;
    const cells = extractSpreadsheetPatchCells(normalized);
    return patchSpreadsheetRange(path, range, cells);
  }

  if (kind === 'word') {
    if (!target.wordRange) {
      throw new Error('patch Word 须提供 target.wordRange（startParagraph/endParagraph）');
    }
    const normalized = normalizeWriteContent(path, content);
    const { paragraphs } = normalized as WordWriteInput;
    return patchWordRange(path, target.wordRange, paragraphs ?? []);
  }

  if (!target.presentationTarget) {
    throw new Error('patch PPT 须提供 target.presentationTarget（slideIndex）');
  }
  const raw = content as StructuredWriteInput;
  if (!raw || typeof raw !== 'object' || !raw.slide) {
    throw new Error(
      'patch PPT 的 content 须为 { slide: { title?, bullets?, textIndex?, text? } }',
    );
  }
  const slidePatch = raw.slide;
  return patchPresentationSlide(path, target.presentationTarget, slidePatch);
};

export const writeOfficeDocument = async (
  path: string,
  content: DocumentWriteContent,
  options?: WriteOfficeOptions,
) => {
  const kind = detectOfficeKind(path);
  if (!kind) {
    throw new Error('不支持的文档格式，请使用 xlsx/xls/csv/docx/pptx');
  }

  if (options?.mode === 'patch') {
    if (!options.target) {
      throw new Error('patch 模式须提供 target（范围/段落/幻灯片）');
    }
    return patchOfficeDocument(path, content, options.target);
  }

  const normalized = normalizeWriteContent(path, content);
  if (kind === 'spreadsheet') {
    return writeSpreadsheet(path, normalized as SpreadsheetContent);
  }
  if (kind === 'word') {
    return writeWordDocument(path, normalized as WordWriteInput);
  }
  return writePresentation(path, normalized as PresentationWriteInput);
};
