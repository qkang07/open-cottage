# 写文档 / PPT / 表格

<StoryLead label="适用范围">

**办公文档** 能力用于生成和修改 Word、PowerPoint、Excel/CSV。使用时说明读者、输出路径、结构和样式；生成后在预览区逐页或逐个 sheet 确认。

</StoryLead>

## 先为这次交付准备工具

打开工作区，在「模型与能力」中启用 **办公文档**。处理 Word、PPT、Excel/CSV 时，请使用这一能力，不要用普通文本工具硬读二进制文件。

![已打开「办公文档」能力](/images/pack-office-on.png)

## 先从一份周报开始

说明读者、篇幅、输出路径和需要的结构，使生成结果成为可直接打开、逐页检查的文件。

<StepList :items="[
  { title: '交代读者与篇幅', text: '例如给领导的一页纸周报，或给客户的 2000 字方案。' },
  { title: '指定输出路径', text: '如 reports/weekly-0312.docx，避免结果散在根目录。' },
  { title: '说出结构与样式', text: '标题层级、表格、语气与主题，避免只得到一页白纸。' },
  { title: '在预览里逐页验收', text: '检查标题、表格、页眉页脚与分页，再针对某一节继续修改。' },
]" />

<div class="oc-prompt">
  <span class="oc-prompt__label">把笔记变成周报</span>
  根据 @notes/raw.md 写一份正式周报 Word，输出到 reports/weekly.docx，theme 用 consulting-clean：本周完成、风险、下周计划各一节（用标题+要点列表），加页眉「周报」与页码。
</div>

## 当交付物是一份 PPT

先定页数和故事线，再要求内容页一页一个结论。可以使用时间线、指标卡、对比、流程、图文、图表洞察和仪表盘等语义版式，也可以明确要求形状、连接线、工作区图片、表格或图表。复杂 PPT 可以先走 [计划模式](./spec)，批准页结构后再生成。

好看的整套演示既要统一，也要有节奏：统一标题基线、页边距、字体和背景，把 2～3 个强调色固定映射给不同章节；主体构图则按信息变化。章节过渡可用大号编号，个人或产品定位可用“左主张 + 右指标”，核心成果可用“主指标 + 两项证据”，项目对照可用非对称双栏。连续内容页不要反复套同一种卡片网格；低对比水印、幽灵编号等纯装饰元素可以明确标记为装饰，避免被当成正文误报。

预览区展示的是浏览器近似排版，用于检查结构、越界、文字溢出、重叠、低对比和资源缺失；最终字体换行仍以 PowerPoint 打开的结果为准。复杂演示可以使用 V3 `pipeline: "html-layout"`：Agent 先生成受约束的 HTML/CSS，在浏览器中真实测量布局，再把带 `data-ppt-element` 的内容编译成原生可编辑 PPTX；HTML 只是内部设计稿与验收源，不是并行交付格式。也可以先用 `draftOnly: true` 在预览区检查设计稿，再用 `sourceDraftId` 提交生成。

参考既有 PPT 时，`referenceMode` 可选 `content-only`、`inspiration`、`match-style` 或 `native-template`。后两种会提取字体、色板、页面比例、版式和重复装饰；`native-template` 还会尽量复用母版、版式及未涉及的 SmartArt、媒体、动画等复杂对象。修改既有 PPT 时，Agent 会先读取元素结构，再按元素原位修改，也可以增删、复制或重排页面；会同步 Cottage V3 源稿，无法安全同步的操作会明确标记为 stale。复杂 PowerPoint 私有对象保持只读，预览为 SVG/HTML 近似渲染。

<div class="oc-prompt">
  <span class="oc-prompt__label">把简报变成演示</span>
  用 consulting-clean 风格做 10 页产品介绍 PPT，输出到 decks/product.pptx。首页封面，内容页一页一个结论；至少轮换 4 种与信息匹配的构图，不要连续重复卡片网格。保持标题基线与页边距统一，图表数据来自 @brief/metrics.csv，图片只使用 @assets/ 下的素材。
</div>

## 当需要改一张表

<div class="oc-prompt">
  <span class="oc-prompt__label">只改明确的部分</span>
  打开 @data/sales.xlsx，把「华东」地区 Q1 为 0 的行标红备注「待补数」，另存为 data/sales-reviewed.xlsx，不要改其它 sheet。
</div>

<StoryBeat title="生成后的检查">

Word、PPT 和表格的版式会随主题、页数与数据变化。生成后在预览区打开它们，确认每一页、每个 sheet 都仍然是你愿意交出去的样子。

</StoryBeat>

<NextReading to="./preview" title="在预览里完成最后验收">

检查路径、内容与版式；不满意时，直接围绕打开的文件继续说下一轮修改。

</NextReading>
