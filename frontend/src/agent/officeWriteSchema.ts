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

/** Word 主题预设名；PPT 另有更完整的主题集合。 */
export const officeThemeNameSchema = z
  .enum(['minimal-light', 'dark-tech', 'consulting-clean'])
  .optional()
  .describe('内置风格预设；省略则默认 minimal-light');

const presentationThemeNameSchema = z
  .enum([
    'minimal-light',
    'dark-tech',
    'consulting-clean',
    'editorial-warm',
    'academic-blue',
    'product-vibrant',
  ])
  .optional()
  .describe('内置风格预设；省略则默认 minimal-light');

const presentationThemeSchema = z.object({
  name: presentationThemeNameSchema,
  background: z.string().optional().describe('背景色 hex，如 #0B1020'),
  surface: z.string().optional().describe('卡片/表格等表面色 hex'),
  text: z.string().optional().describe('正文/标题文字色 hex'),
  muted: z.string().optional().describe('次要文字色 hex'),
  accent: z.string().optional().describe('强调色 hex（标题、强调条）'),
  accent2: z.string().optional().describe('第二强调色 hex'),
  fontFace: z.string().optional().describe('字体，中文建议 Noto Sans SC / 微软雅黑'),
  headingFontFace: z.string().optional().describe('标题字体'),
  radius: z.number().min(0).max(1).optional().describe('默认圆角强度'),
  shadow: z.boolean().optional().describe('卡片是否默认带阴影'),
  chartColors: z.array(z.string()).max(12).optional().describe('图表系列色 hex'),
});

const wordThemeSchema = z.object({
  name: officeThemeNameSchema,
  text: z.string().optional().describe('正文字色 hex'),
  accent: z.string().optional().describe('标题/强调色 hex'),
  fontFace: z.string().optional().describe('字体，中文建议 Noto Sans SC / 微软雅黑'),
});

const presentationTextRunSchema = z.object({
  text: z.string(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  fontSize: z.number().min(6).max(120).optional(),
  color: z.string().optional(),
  breakLine: z.boolean().optional(),
  hyperlink: z.string().optional(),
});

const presentationListItemSchema = z.object({
  text: z.string(),
  level: z.number().int().min(0).max(8).optional(),
  ordered: z.boolean().optional(),
  bold: z.boolean().optional(),
  color: z.string().optional(),
});

const presentationTableCellSchema = z.object({
  text: z.string(),
  bold: z.boolean().optional(),
  color: z.string().optional(),
  fill: z.string().optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  rowSpan: z.number().int().min(1).optional(),
  colSpan: z.number().int().min(1).optional(),
});

const presentationChartSeriesSchema = z.object({
  name: z.string(),
  values: z.array(z.number()),
  type: z.enum(['bar', 'line', 'area', 'pie', 'doughnut', 'scatter', 'bubble', 'radar']).optional(),
  color: z.string().optional(),
});

/** 扁平元素 schema：由 type 决定字段语义，运行时做逐类型校验。 */
export const presentationElementSchema = z.object({
  id: z.string().optional().describe('页内稳定元素 ID；编辑时用于定位'),
  name: z.string().optional().describe('PowerPoint 选择窗格中显示的名称'),
  type: z.enum(['text', 'shape', 'line', 'image', 'table', 'chart']),
  x: z.number().optional().describe('左边距，英寸'),
  y: z.number().optional().describe('上边距，英寸'),
  w: z.number().min(0).optional().describe('宽度，英寸；连接线可为 0'),
  h: z.number().min(0).optional().describe('高度，英寸；连接线可为 0'),
  zIndex: z.number().int().optional(),
  decorative: z.boolean().optional().describe('纯装饰元素；不参与低对比与文本重叠告警'),
  rotate: z.number().min(-360).max(360).optional(),
  text: z.string().optional(),
  runs: z.array(presentationTextRunSchema).optional().describe('富文本 runs'),
  listItems: z.array(presentationListItemSchema).optional().describe('分级项目符号/编号列表'),
  fontFace: z.string().optional(),
  fontSize: z.number().min(6).max(120).optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  color: z.string().optional(),
  align: z.enum(['left', 'center', 'right', 'justify']).optional(),
  valign: z.enum(['top', 'middle', 'bottom']).optional(),
  bullet: z.boolean().optional(),
  margin: z.number().min(0).max(1).optional(),
  shapeType: z.string().optional().describe('PptxGenJS ShapeType 名称'),
  fill: z.string().optional(),
  transparency: z.number().min(0).max(100).optional(),
  lineColor: z.string().optional(),
  lineWidth: z.number().min(0).max(20).optional(),
  dash: z.enum(['solid', 'dash', 'dot']).optional(),
  beginArrowType: z.string().optional(),
  endArrowType: z.string().optional(),
  radius: z.number().min(0).max(1).optional(),
  shadow: z.boolean().optional(),
  path: z.string().optional().describe('image 的工作区相对路径'),
  fit: z.enum(['stretch', 'contain', 'cover']).optional(),
  alt: z.string().optional(),
  hyperlink: z.string().optional(),
  rows: z.array(z.array(z.union([z.string(), presentationTableCellSchema]))).optional(),
  columnWidths: z.array(z.number().positive()).optional(),
  borderColor: z.string().optional(),
  chartType: z.enum(['bar', 'line', 'area', 'pie', 'doughnut', 'scatter', 'bubble', 'radar']).optional(),
  categories: z.array(z.string()).optional(),
  series: z.array(presentationChartSeriesSchema).optional(),
  showLegend: z.boolean().optional(),
  showTitle: z.boolean().optional(),
  showValue: z.boolean().optional(),
  showCategoryName: z.boolean().optional(),
  legendPosition: z.enum(['top', 'bottom', 'left', 'right']).optional(),
});

const presentationSemanticItemSchema = z.object({
  title: z.string().optional(),
  subtitle: z.string().optional(),
  text: z.string().optional(),
  value: z.string().optional(),
  label: z.string().optional(),
  accent: z.string().optional(),
  path: z.string().optional(),
});

export const presentationSlideSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  subtitle: z.string().optional().describe('副标题，常用于封面/章节页'),
  bullets: z.array(z.string()).optional(),
  notes: z.string().optional(),
  layout: z
    .enum([
      'cover', 'section', 'content', 'agenda', 'title-body', 'two-column',
      'comparison', 'metric-cards', 'timeline', 'process', 'quote',
      'image-left', 'image-right', 'chart-insight', 'table', 'dashboard',
      'chapter-number', 'statement-metrics', 'spotlight', 'split-showcase',
      'closing', 'blank',
    ])
    .optional()
    .describe('语义版式；首页默认 cover，其余默认 content'),
  background: z.string().optional().describe('单页背景色 hex 覆盖'),
  accent: z.string().optional().describe('单页强调色 hex 覆盖'),
  kicker: z.string().optional().describe('短标签；适用于章节编号等强调型版式'),
  chapterNumber: z.string().optional().describe('章节编号；适用于 chapter-number'),
  takeaway: z.string().optional().describe('页尾结论条；适用于 process 等流程版式'),
  items: z.array(presentationSemanticItemSchema).max(24).optional(),
  left: presentationSemanticItemSchema.optional(),
  right: presentationSemanticItemSchema.optional(),
  quote: z.string().optional(),
  attribution: z.string().optional(),
  elements: z.array(presentationElementSchema).max(200).optional(),
  html: z.string().max(250000).optional().describe('V3 受约束 HTML；仅 data-ppt-element 节点导出为 PPT 元素'),
  css: z.string().max(150000).optional().describe('V3 单页 CSS；禁止脚本、外部 URL 与 @import'),
  layoutRole: z.enum(['cover', 'section', 'content', 'comparison', 'data', 'image', 'closing', 'blank']).optional(),
  templateSlideIndex: z.number().int().min(1).optional(),
  module: z.enum([
    'cover', 'section', 'title-body', 'comparison', 'metrics', 'timeline', 'process',
    'matrix', 'funnel', 'roadmap', 'hierarchy', 'image-story', 'image-gallery',
    'quote', 'chart-insight', 'table', 'closing',
  ]).optional().describe('V3 内置 HTML 构图模块；可代替 html'),
  chartBindings: z.array(z.object({
    id: z.string(),
    chartType: z.enum(['bar', 'line', 'area', 'pie', 'doughnut', 'scatter', 'bubble', 'radar']),
    categories: z.array(z.string()).optional(),
    series: z.array(presentationChartSeriesSchema),
    showLegend: z.boolean().optional(),
    showValue: z.boolean().optional(),
    showCategoryName: z.boolean().optional(),
    legendPosition: z.enum(['top', 'bottom', 'left', 'right']).optional(),
  })).optional(),
  tableBindings: z.array(z.object({
    id: z.string(),
    rows: z.array(z.array(z.union([z.string(), presentationTableCellSchema]))),
    columnWidths: z.array(z.number().positive()).optional(),
  })).optional(),
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
    version: z.number().int().min(2).max(3).optional().describe('PPT 协议版本；3 启用 HTML 布局编译'),
    pipeline: z.enum(['html-layout']).optional(),
    title: z.string().optional().describe('演示文稿元数据标题'),
    subject: z.string().optional(),
    author: z.string().optional(),
    company: z.string().optional(),
    language: z.string().optional(),
    paragraphs: z.array(z.string()).optional(),
    blocks: z.array(wordBlockSchema).optional().describe('Word 结构化块（正式文档优先）'),
    theme: z
      .union([presentationThemeSchema, wordThemeSchema])
      .optional()
      .describe('Word/PPT 全局主题'),
    header: wordHeaderSchema.optional().describe('Word 页眉'),
    footer: wordFooterSchema.optional().describe('Word 页脚'),
    presentationHeader: z.string().optional().describe('PPT 页眉文字'),
    presentationFooter: z.string().optional().describe('PPT 页脚文字'),
    slides: z.array(presentationSlideSchema).max(100).optional(),
    showSlideNumbers: z.boolean().optional(),
    slideWidth: z.number().positive().max(100).optional().describe('V3 页面宽度，英寸'),
    slideHeight: z.number().positive().max(100).optional().describe('V3 页面高度，英寸'),
    sharedCss: z.string().max(150000).optional(),
    referencePath: z.string().optional().describe('参考或原生模板 PPTX 的工作区路径'),
    referenceMode: z.enum(['content-only', 'inspiration', 'match-style', 'native-template']).optional(),
    referenceSlideIndices: z.array(z.number().int().min(1)).max(100).optional(),
    draftOnly: z.boolean().optional().describe('仅保存临时 HTML 设计稿，不写目标 PPTX'),
    sourceDraftId: z.string().optional().describe('从已保存的 V3 临时设计稿生成'),
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

const presentationEditOperationSchema = z.object({
  op: z.enum([
    'addElement',
    'updateElement',
    'removeElement',
    'replaceImage',
    'updateTable',
    'updateChartData',
    'updateSlideNotes',
    'addSlide',
    'removeSlide',
    'duplicateSlide',
    'moveSlide',
  ]),
  slideIndex: z.number().int().min(1).optional(),
  targetSlideIndex: z.number().int().min(1).optional(),
  elementId: z.string().optional(),
  element: presentationElementSchema.optional(),
  patch: presentationElementSchema.partial().optional(),
  imagePath: z.string().optional(),
  rows: z.array(z.array(z.union([z.string(), presentationTableCellSchema]))).optional(),
  categories: z.array(z.string()).optional(),
  series: z.array(presentationChartSeriesSchema).optional(),
  notes: z.string().optional(),
  slide: presentationSlideSchema.optional(),
});

export const toolEditPresentationInputSchema = z.object({
  path: z.string(),
  operations: z.array(presentationEditOperationSchema).min(1).max(100),
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
