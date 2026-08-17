# 网页抓取与自动化

<StoryLead label="使用范围">

网页处理分为正文检索与抓取，以及截图、动态页面提取、点击或填表等自动化。后者需要 **网页自动化** 能力和 Cottage Service；涉及外部副作用时，由你确认每一步。

</StoryLead>

## 先确认你需要哪一层能力

- **基础联网**：搜索、抓取较静态的页面正文。
- **网页自动化**：截图、动态页提取、点击或填表等多步操作；需打开能力并连接 Cottage Service。

需要截图或交互时，先连接 [Cottage Service](/concepts/cottage-service-concepts)，并打开 **网页自动化**。它依赖本机 Chrome 或 Edge；未连接时，不要把截图、动态提取或网页交互当作可用能力。

## 如果你只想读页面

先让它搜索和提取正文，结果应落在工作区，而不是停在一次回答里：

<div class="oc-prompt">
  <span class="oc-prompt__label">留下一份可回看的笔记</span>
  搜索「OpenAI API rate limits」官方文档，抓取正文，总结限流规则到 notes/rate-limits.md，并附上来源 URL。
</div>

## 如果你需要截图留证

<div class="oc-prompt">
  <span class="oc-prompt__label">让证据也落盘</span>
  打开 https://example.com/pricing ，整页截图保存到 screenshots/pricing.png，再把价格表要点写到 notes/pricing.md。
</div>

截图完成后，在工作区文件树中确认目标 PNG 真实存在，再继续引用或交付。

## 如果任务包含多步交互

<StepList :items="[
  { title: '说明网站和目标状态', text: '例如进入文档中心、选中版本、复制目录结构。' },
  { title: '让过程保持可见', text: '可要求每步后截图；完成后应关闭浏览器会话。' },
  { title: '登录或验证码时接手', text: '不要让它盲目重试；你完成人工步骤后再继续。' },
  { title: '验收截图和落盘结果', text: '确认没有误点提交、购买等危险按钮。' },
]" />

<Callout kind="warn">
自动化会真实操作网页。涉及账号、支付、删除数据时，务必自己盯住审批与过程。
</Callout>

<NextReading to="./governance" title="把网页操作也放进你的确认范围">

无论结果来自本地文件还是网页，危险操作前都应该由你决定是否继续。

</NextReading>
