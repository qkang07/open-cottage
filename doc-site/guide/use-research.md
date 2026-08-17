# 做调研报告

<StoryLead label="调研报告的要求">

使用 **深度研究** 能力进行多轮检索，并生成带来源的 Markdown 报告。报告应能说明结论来自哪里，以及哪些事实仍不确定。

</StoryLead>

## 先准备这次取证

打开 **深度研究**。需要更稳定的搜索时，可连接 [Cottage Service](/concepts/cottage-service-concepts)；要读 PDF 文献，再打开 **PDF 处理**；要附图，再打开 **图表可视化**。

![已打开深度研究及相关能力](/images/pack-research-on.png)

## 让报告从一个好问题展开

<StepList :items="[
  { title: '说明研究问题和读者', text: '例如给产品经理的竞品对比，还是给自己的技术选型。' },
  { title: '约定输出路径', text: '如 research/competitor-2026.md，让结论有固定归处。' },
  { title: '要求来源和不确定性', text: '关键事实附链接；出现冲突时，写明取舍。' },
  { title: '落盘后通读', text: '在预览中打开报告，抽查 2～3 个链接是否站得住。' },
  { title: '针对薄弱处补强', text: '例如“第三节证据不足，再找两个一手来源”。' },
]" />

<div class="oc-prompt">
  <span class="oc-prompt__label">把问题和验收一起说清楚</span>
  调研国内三家主流大模型 API 的按量计费差异（输入/输出、上下文长度、免费额度）。输出到 research/llm-pricing.md：背景、对比表、结论与建议，每条关键数字都要带来源链接。
</div>

![带表格和待办清单的 Markdown 报告预览](/images/research-report-preview.png)

<StoryBeat title="范围较大时使用计划模式">

如果结论要跨多个子问题，先用 [计划模式](./spec) 列出研究问题和交付结构，再批准检索。这样你能在证据变多之前，先决定报告最终要回答什么。

</StoryBeat>

<NextReading to="./use-web" title="需要时，让网页材料留下可确认的证据">

当报告需要读动态页面、截图或完成明确的网页步骤，再按需使用网页抓取与自动化。

</NextReading>
