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

先定页数和故事线，再要求一页一个结论句。复杂 PPT 可以先走 [计划模式](./spec)，批准页结构后再生成；得到文件后，逐页检查文字密度、对齐与配色。

<div class="oc-prompt">
  <span class="oc-prompt__label">把简报变成演示</span>
  用 consulting-clean 风格做 10 页产品介绍 PPT，输出到 decks/product.pptx。首页封面，其后每页一个结论句 + 最多 3 个要点。素材参考 @brief/product.md。
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
