import { z } from 'zod';
import { spreadsheetRangeSchema, wordRangeSchema } from './spreadsheetWriteSchema';

const presentationTargetSchema = z.object({
  slideIndex: z.number().int().min(1),
});

const patchTargetSchema = z.object({
  spreadsheetRange: spreadsheetRangeSchema.optional(),
  wordRange: wordRangeSchema.optional(),
  presentationTarget: presentationTargetSchema.optional(),
});

const writeSlideSchema = z.object({
  title: z.string().optional(),
  bullets: z.array(z.string()).optional(),
  notes: z.string().optional(),
  textIndex: z.number().int().min(1).optional(),
  text: z.string().optional(),
});

/** Word / PPT 共用主题预设名 */
export const officeThemeNameSchema = z
  .enum(['minimal-light', 'dark-tech', 'consulting-clean'])
  .optional()
  .describe('内置风格预设；省略则默认 minimal-light');

const presentationThemeSchema = z.object({
  name: officeThemeNameSchema,
  background: z.string().optional().describe('背景色 hex，如 #0B1020'),
  text: z.string().optional().describe('正文/标题文字色 hex'),
  accent: z.string().optional().describe('强调色 hex（标题、强调条）'),
  fontFace: z.string().optional().describe('字体，中文建议 Noto Sans SC / 微软雅黑'),
});

const wordThemeSchema = z.object({
  name: officeThemeNameSchema,
  text: z.string().optional().describe('正文字色 hex'),
  accent: z.string().optional().describe('标题/强调色 hex'),
  fontFace: z.string().optional().describe('字体，中文建议 Noto Sans SC / 微软雅黑'),
});

const presentationSlideSchema = z.object({
  title: z.string().optional(),
  subtitle: z.string().optional().describe('副标题，常用于封面/章节页'),
  bullets: z.array(z.string()).optional(),
  notes: z.string().optional(),
  layout: z
    .enum(['cover', 'section', 'content'])
    .optional()
    .describe('版式：cover 封面 / section 章节分隔 / content 正文；首页默认 cover'),
  background: z.string().optional().describe('单页背景色 hex 覆盖'),
  accent: z.string().optional().describe('单页强调色 hex 覆盖'),
});

/**
 * Word 结构化块（扁平对象 + type，避免深层 anyOf 被部分厂商拒绝）。
 * columns.children 为同结构块数组（运行时再校验；schema 用 z.any 数组降低厂商拒绝率）。
 */
const wordBlockSchema = z.object({
  type: z
    .enum(['heading', 'paragraph', 'bullet', 'numbered', 'table', 'image', 'columns'])
    .describe('块类型'),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().describe('heading 级别'),
  text: z.string().optional().describe('heading / paragraph 文本'),
  bold: z.boolean().optional().describe('paragraph 整段加粗'),
  items: z.array(z.string()).optional().describe('bullet / numbered 条目'),
  headers: z.array(z.string()).optional().describe('table 表头'),
  rows: z.array(z.array(z.string())).optional().describe('table 数据行'),
  path: z.string().optional().describe('image 工作区相对路径'),
  width: z.number().optional().describe('image 宽度（px，默认 480）'),
  height: z.number().optional().describe('image 高度（px，可选）'),
  alt: z.string().optional().describe('image 说明'),
  count: z.union([z.literal(2), z.literal(3)]).optional().describe('columns 栏数'),
  children: z.array(z.record(z.string(), z.any())).optional().describe('columns 子块'),
});

const wordHeaderSchema = z.object({
  text: z.string().optional(),
  left: z.string().optional(),
  right: z.string().optional(),
});

const wordFooterSchema = z.object({
  text: z.string().optional(),
  pageNumber: z.boolean().optional().describe('是否显示页码，默认 true'),
});

const writeContentSchema = z.union([
  z.string(),
  z.object({
    paragraphs: z.array(z.string()).optional(),
    blocks: z.array(wordBlockSchema).optional().describe('Word 结构化块（正式文档优先）'),
    theme: z
      .union([presentationThemeSchema, wordThemeSchema])
      .optional()
      .describe('Word/PPT 全局主题'),
    header: wordHeaderSchema.optional().describe('Word 页眉'),
    footer: wordFooterSchema.optional().describe('Word 页脚'),
    slides: z.array(presentationSlideSchema).optional(),
    slide: writeSlideSchema.optional(),
  }),
]);

export const toolWriteWordInputSchema = z.object({
  path: z.string(),
  mode: z.enum(['replace', 'patch']).optional(),
  target: patchTargetSchema.optional(),
  content: writeContentSchema,
});

export const toolWritePresentationInputSchema = z.object({
  path: z.string(),
  mode: z.enum(['replace', 'patch']).optional(),
  target: patchTargetSchema.optional(),
  content: writeContentSchema,
});

// 模板变量值统一用字符串（渲染时本就 String(value) 处理）。
// 避免 union/anyOf 生成无 type 的 JSON Schema，被部分厂商（如 Moonshot/Kimi）拒绝。
const templateVariablesSchema = z
  .record(z.string(), z.string())
  .describe('模板变量键值表，值均为字符串；数字/布尔请以文本形式传入');

export const toolRenderOfficeTemplateInputSchema = z.object({
  templatePath: z.string(),
  outputPath: z.string(),
  variables: templateVariablesSchema,
});

export const toolBatchGenerateOfficeDocsInputSchema = z.object({
  templatePath: z.string(),
  outputDir: z.string(),
  items: z.array(
    z.object({
      filename: z.string(),
      variables: templateVariablesSchema,
    }),
  ),
});
