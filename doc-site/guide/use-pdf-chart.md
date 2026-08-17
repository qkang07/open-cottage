# PDF 与图表

<StoryLead label="处理范围">

使用 **PDF 处理** 能力读取、合并、拆分或生成 PDF；使用 **图表可视化** 能力生成结构图与数据图。明确输出格式和路径后，结果会以 PDF、HTML 或 Markdown 留在工作区里。

</StoryLead>

## 从一份 PDF 里读出要点

打开 **PDF 处理** 能力，再说明是读取、合并、拆分还是新建：

<div class="oc-prompt">
  <span class="oc-prompt__label">读一篇材料</span>
  用 PDF 工具阅读 @papers/whitepaper.pdf 前 15 页，总结论点到 notes/whitepaper-summary.md。
</div>

<div class="oc-prompt">
  <span class="oc-prompt__label">把两个文件合成一个交付物</span>
  把 scans/a.pdf 与 scans/b.pdf 按顺序合并为 output/merged.pdf。
</div>

复杂 CSS 版式的 PDF 需要经本地 Cottage Service 无头打印；简单中文正文可使用 `createPdf`。

![已打开 PDF 处理能力](/images/pdf-usage.png)

## 把一个结论画出来

打开 **图表可视化** 能力，并先说清是结构图还是数据图：流程、架构、时序和关系适合 Mermaid；柱状、折线、饼图等数值适合 ECharts。

<div class="oc-prompt">
  <span class="oc-prompt__label">让架构变得可读</span>
  根据 @notes/architecture.md 画一张系统架构示意图，输出到 charts/architecture.html，我要在预览里打开。
</div>

<div class="oc-prompt">
  <span class="oc-prompt__label">让比较有一张图</span>
  用这组数据做对比柱状图（A 120、B 80、C 150），输出到 charts/compare.html，标题写成「三组转化对比」。
</div>

![纯 SVG 静态柱状图预览](/images/chart-preview.png)

<StoryBeat title="生成后的检查">

图表 HTML 通常依赖在线脚本，完全离线环境可能无法渲染；复杂 PDF 和动态图表也各有服务或网络要求。先在预览区确认结果能正常打开，再把它交给下一位读者。

</StoryBeat>

<NextReading to="./preview" title="回到预览区检查最终文件">

无论是 PDF 还是图表，最后都应在结果旁边确认内容、版式和路径。

</NextReading>
