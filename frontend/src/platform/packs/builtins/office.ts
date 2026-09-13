import { createOfficeReadCottageTools } from '../../../agent/officeReadCottageTools';
import { createOfficeWriteCottageTools } from '../../../agent/officeWriteCottageTools';
import { createSpreadsheetCottageTools } from '../../../agent/spreadsheetCottageTools';
import { OFFICE_TOOL_NAMES } from '../../../agent/toolCatalog';
import type { BuiltinCapabilityPack } from './types';

const OFFICE_PROMPT = `【办公文档能力包已启用】

## 工具速查
- 表格：readSpreadsheet 读取 xlsx/xls/csv（可用 spreadsheetRange 限定区域）；writeSpreadsheet 改单元格时务必 mode=patch（target.spreadsheetRange + content.cells），整表替换才用 replace；replace 时用 content.style（header/colWidths/freezeHeader）美化。
- Word/PPT 读取：readWord（段落 wordRange）；readPresentation 可带 includeElements=true 返回 PPT 元素 ID、类型和坐标。
- Word/PPT 写入：writeWord；writePresentation 新建/重建图形化 PPT；editPresentation 按 elementId 原位编辑既有 PPT；renderOfficeTemplate 按 {{变量}} 渲染模板；batchGenerateOfficeDocs 按变量集批量生成。
- PPT V3 的 HTML 是 writePresentation 内部布局与验收输入，最终仍输出原生 pptx；不要把临时 HTML 当成并行交付物。普通网页/HTML 文档才用基础文件工具。
- 切记：xlsx/csv 不要用 readFile 读乱码；docx/pptx 不要用 writeFile 覆盖二进制；纯文本/HTML 才用文件工具。

## 文档审美总原则（Word 与 PPT 通用）
1. 先定设计令牌（design tokens）并全局保持一致：主字体、背景/表面/文字色、中性灰阶、间距单位；可预先选 2~3 个章节强调色并赋予固定语义，但切忌逐页随机换色换字体。
2. 选定一套风格预设并贯穿全篇：
   - minimal-light：字体 Noto Sans SC；正文 #0F172A；强调 #2563EB。
   - dark-tech：强调 #22D3EE / #0891B2；正文深色。
   - consulting-clean：正文 #111827；强调 #0EA5E9。
   - editorial-warm：暖白底、衬线标题，适合叙事与品牌内容。
   - academic-blue：克制蓝色与高密度信息层级，适合研究汇报。
   - product-vibrant：紫红双强调色，适合产品发布与增长汇报。
3. 排版四要素：充足留白、严格对齐、清晰层级（字号/字重拉开对比）、强调色只点睛不滥用。
4. 中文正文用无衬线（Noto Sans SC / 微软雅黑），标题可加粗；正文行高 1.5~1.7。
5. 信息可视化优先：能用表格、对比、时间线、图表表达的，不要堆砌长段落。

## 原生 PPT（.pptx，用 writePresentation）
- 先确认或合理推断受众、使用场景、风格方向与页数，并简要说明默认假设；除非故事线存在重大歧义，否则直接继续，不必等待确认。
- **叙事先行**：先列「一页一结论」的故事线，再落地每页；建议顺序为「背景 → 洞察 → 证据 → 行动」。内容页标题优先写结论；封面、章节过渡与结束页可用简洁主题标题，不要硬凑结论句。
- 一页只表达一个核心信息。正文默认至多 3 个要点，每条保持短句；内容过多时应删减、拆页或改用表格/对比/时间线，不要缩小字体或堆砌段落。
- 优先用语义 layout：cover / section / content / agenda / title-body / two-column / comparison / metric-cards / timeline / process / quote / image-left / image-right / chart-insight / table / dashboard / chapter-number / statement-metrics / spotlight / split-showcase / closing / blank。
- 视觉要求较高的新演示优先使用 V3：version=3、pipeline="html-layout"。先用受约束 HTML/CSS 完成浏览器布局，每个需要导出的节点都必须带唯一 data-ppt-element 和 data-ppt-type；布局容器不带标记。可用 text/shape/line/image/table/chart，图片另用 data-ppt-src 指向工作区路径，表格和图表用 data-ppt-binding 关联 bindings。
- V3 可用 module 快速生成 HTML 构图：cover / section / title-body / comparison / metrics / timeline / process / matrix / funnel / roadmap / hierarchy / image-story / image-gallery / quote / chart-insight / table / closing。自由 HTML 与内置 module 可按页混用。
- 复杂 CSS 默认拒绝。只有 decorative=true 对应的装饰节点同时声明 data-ppt-decorative="true" 与 data-ppt-fallback="rasterize" 时允许局部 SVG 降级；禁止整页截图。
- 参考现有 PPT 时先 readPresentation(includeStyleProfile=true, includeLayouts=true, includeMasters=true)。referenceMode 可选 content-only / inspiration / match-style / native-template；native-template 会以模板 OOXML 包为底座保留母版、版式、主题和无法编辑的复杂对象。
- 默认自动完成 HTML 测量和 OOXML 回读。需要先人工查看时设置 draftOnly=true，随后用 sourceDraftId 生成最终 PPTX；源稿保存在 .cottage/presentations，原位编辑无法安全同步时会返回 sourceManifestStatus=stale。
- **按信息选构图，而不是按页复制模板**：章节过渡用 chapter-number（大号幽灵编号）；人物/定位陈述用 statement-metrics（左主张、右指标）；一个核心成果带两项证据用 spotlight；两个项目或案例用 split-showcase；步骤关系用 process + takeaway；同类数据才用 metric-cards。连续内容页不要超过 2 页使用同一骨架，8 页以上演示通常至少轮换 4 种内容构图。
- **统一感来自锚点，变化来自主体**：内容页保持一致的标题基线、页边距和页眉短标签；主体在大数字、非对称分栏、流程、时间线、图表之间轮换。章节强调色可固定映射到主题/阶段，背景色、卡片色和正文色仍全篇一致。
- 需要自由排版时使用 elements：text / shape / line / image / table / chart；坐标 x/y/w/h 单位均为英寸，页面固定 13.333×7.5。元素必须有稳定 id。低对比水印、幽灵编号、背景圆环等请标记 decorative=true，使其不参与可读性和文字重叠告警。
- 图片只引用工作区路径；图表传 categories + series。图表与装饰应服务于结论，不要为“好看”堆无关图形。
- 修改既有 PPT 时先 readPresentation(includeElements=true)，再用 editPresentation 精确操作。writePresentation 输入里的 id/name 不是后续编辑所需的 OOXML elementId；写入后若要精修，必须重新读取并使用返回的 elementId。支持新增/更新/删除常用元素、替换图片、更新等尺寸表格和等系列数图表、修改已有备注页，以及增删复制重排幻灯片。新增图表/超链接请用 writePresentation；SmartArt、媒体、OLE、动画等只读对象不得强行修改。
- 图表与装饰应服务于结论：不要使用无关图标；整套演示中图表类型保持克制（通常不超过两类）；投影阅读优先，保证层级、对比度与留白。
- 写入后检查 warnings；若是内容元素的越界、溢出、重叠或低对比，先修订一轮。装饰性低对比必须通过 decorative=true 明示，不要把真实内容伪装成装饰来压掉告警。若覆盖当前打开文件时报告状态已变化或被锁定，不要反复提交同一大对象；改写同目录的新版本文件并说明原因。
- 写入示例：{ "version":2, "slides": [ {"layout":"cover","title":"...","subtitle":"..."}, {"layout":"chapter-number","chapterNumber":"01","kicker":"MARKET","title":"增长机会"}, {"layout":"spotlight","title":"核心指标已显著改善","items":[{"value":"42%","label":"转化提升","text":"来自主路径优化"},{"value":"18%","label":"成本下降"},{"value":"3 周","label":"交付周期"}]}, {"layout":"process","title":"三步完成迁移","items":[{"title":"诊断"},{"title":"改造"},{"title":"上线"}],"takeaway":"结果：风险可控且可分批交付"} ], "theme":{"name":"consulting-clean"} }
- V3 示例：{ "version":3, "pipeline":"html-layout", "sharedCss":".hero{display:flex;gap:48px}", "slides":[{"id":"slide-1","html":"<section data-ppt-slide='slide-1'><h1 data-ppt-element='title' data-ppt-type='text' data-ppt-text-layout='frozen-lines'>标题</h1></section>"},{"id":"slide-2","module":"metrics","title":"关键结果","items":[{"value":"42%","label":"转化提升"},{"value":"18%","label":"成本下降"}]}] }

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
- PPT：一页一观点？内容页标题是否传达结论？要点是否精简、适合投影阅读？
- 字体、背景、间距与图表风格是否全篇一致？章节强调色是否有固定语义？连续页面是否重复同一骨架？
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
