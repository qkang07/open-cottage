import { createOfficeReadCottageTools } from '../../../agent/officeReadCottageTools';
import { createOfficeWriteCottageTools } from '../../../agent/officeWriteCottageTools';
import { createSpreadsheetCottageTools } from '../../../agent/spreadsheetCottageTools';
import { OFFICE_TOOL_NAMES } from '../../../agent/toolCatalog';
import type { BuiltinCapabilityPack } from './types';

const OFFICE_PROMPT = `【办公文档能力包已启用】

## 工具速查
- 表格：readSpreadsheet 读取 xlsx/xls/csv（可用 spreadsheetRange 限定区域）；writeSpreadsheet 改单元格时务必 mode=patch（target.spreadsheetRange + content.cells），整表替换才用 replace；replace 时用 content.style（header/colWidths/freezeHeader）美化。
- Word/PPT 读取：readWord（段落 wordRange）、readPresentation（slideIndex/textIndex）。
- Word/PPT 写入：writeWord、writePresentation（replace/patch）；renderOfficeTemplate 按 {{变量}} 渲染模板；batchGenerateOfficeDocs 按变量集批量生成。
- HTML 版 PPT / 文档：用基础文件工具（writeFile / createFile / editFile）写 .html，无需办公二进制工具。
- 切记：xlsx/csv 不要用 readFile 读乱码；docx/pptx 不要用 writeFile 覆盖二进制；纯文本/HTML 才用文件工具。

## 文档审美总原则（Word 与 PPT 通用）
1. 先定设计令牌（design tokens）并全局保持一致：主字体、主色 1 个、强调色 1 个、中性灰阶、间距单位；切忌每页换色换字体。
2. 选定一套风格预设并贯穿全篇（与内置 ppt-beautifier 技能一致）：
   - minimal-light：字体 Noto Sans SC；正文 #0F172A；强调 #2563EB。
   - dark-tech：强调 #22D3EE / #0891B2；正文深色。
   - consulting-clean：正文 #111827；强调 #0EA5E9。
3. 排版四要素：充足留白、严格对齐、清晰层级（字号/字重拉开对比）、强调色只点睛不滥用。
4. 中文正文用无衬线（Noto Sans SC / 微软雅黑），标题可加粗；正文行高 1.5~1.7。
5. 信息可视化优先：能用表格、对比、时间线、图表表达的，不要堆砌长段落。

## 原生 PPT（.pptx，用 writePresentation）
- 先确认或合理推断受众、使用场景、风格方向与页数，并简要说明默认假设；除非故事线存在重大歧义，否则直接继续，不必等待确认。
- **叙事先行**：先列「一页一结论」的故事线，再落地每页；建议顺序为「背景 → 洞察 → 证据 → 行动」。标题必须是结论句而非「背景」「分析」等话题标签。
- 一页只表达一个核心信息。正文默认至多 3 个要点，每条保持短句；内容过多时应删减、拆页或改用表格/对比/时间线，不要缩小字体或堆砌段落。
- 样式：content.theme.name 选 minimal-light / dark-tech / consulting-clean；每页仅用现有 layout：cover / section / content。封面保持简洁；整套 PPT 固定一种主题，避免每页切换配色、字体或图表风格。
- 图表与装饰应服务于结论：不要使用无关图标；整套演示中图表类型保持克制（通常不超过两类）；投影阅读优先，保证层级、对比度与留白。
- 写入示例：{ "slides": [ {"layout":"cover","title":"...","subtitle":"..."}, {"layout":"content","title":"结论句","bullets":["要点1","要点2"]} ], "theme": {"name":"consulting-clean"} }

## Word（.docx，用 writeWord）
- **正式文档必须用 content.blocks + content.theme**，禁止只塞长 paragraphs 当交付件。
- blocks 类型：
  - heading：{ type:"heading", level:1|2|3, text }
  - paragraph：{ type:"paragraph", text, bold? }
  - bullet / numbered：{ type:"bullet"|"numbered", items: string[] }
  - table：{ type:"table", headers?: string[], rows: string[][] }
  - image：{ type:"image", path:"工作区相对路径", width?, height?, alt? }
  - columns：{ type:"columns", count:2|3, children:[文本类块...] }（多栏）
- theme.name：minimal-light / dark-tech / consulting-clean（默认 minimal-light，字体 Noto Sans SC）。
- 可选 header：{ text } 或 { left, right }；footer：{ text?, pageNumber? }（默认显示页码）。
- patch 仍用 paragraphs + wordRange；保留样式时优先整篇 replace。
- 批量与模板：固定版式用 renderOfficeTemplate / batchGenerateOfficeDocs。
- 写入示例：{ "theme": {"name":"consulting-clean"}, "header": {"text":"周报"}, "footer": {"pageNumber":true}, "blocks": [ {"type":"heading","level":1,"text":"本周进展"}, {"type":"bullet","items":["完成 A","推进 B"]}, {"type":"table","headers":["项","状态"],"rows":[["A","完成"]]} ] }

## Excel（.xlsx，用 writeSpreadsheet）
- 整表 replace 时默认美化首行表头（加粗+底色+边框）并自动列宽、冻结首行。
- 可用 content.style：{ header?: boolean, colWidths?: number[], freezeHeader?: boolean }。
- 局部修改用 patch，不要 replace 整表。

## 交付前自检
- PPT：一页一观点？标题是结论而非话题？要点是否精简、适合投影阅读？
- 字体、配色、间距与图表风格是否全篇一致？强调色未滥用？
- Word 是否用了 blocks + theme？表格是否有表头样式？
若任一不达标，先自行修订一轮再交付；复核仍不通过时，说明限制与未满足项。`;

export const OFFICE_PACK: BuiltinCapabilityPack = {
  id: 'builtin.office',
  name: '办公文档',
  domain: 'office',
  description: '读写 Excel / Word / PPT 与模板渲染，处理表格与文档类任务。',
  groupId: 'office',
  toolNames: OFFICE_TOOL_NAMES,
  capabilityIds: [
    'office.spreadsheet.readwrite',
    'office.document.read',
    'office.document.write',
  ],
  promptOverlay: OFFICE_PROMPT,
  riskLevel: 'write',
  intentKeywords: [
    'excel',
    'xlsx',
    'csv',
    '表格',
    'word',
    'docx',
    'ppt',
    'pptx',
    '幻灯片',
    '演示',
    '演示文稿',
    'slides',
    'deck',
    '文档',
    '模板',
    '排版',
    '美化',
    '配色',
  ],
  createTools: (ctx) => [
    ...createSpreadsheetCottageTools({
      enabledTools: OFFICE_TOOL_NAMES,
      onMutate: ctx.onWorkspaceMutate,
    }),
    ...createOfficeReadCottageTools({ enabledTools: OFFICE_TOOL_NAMES }),
    ...createOfficeWriteCottageTools({
      enabledTools: OFFICE_TOOL_NAMES,
      onMutate: ctx.onWorkspaceMutate,
    }),
  ],
};
