# 五分钟配置

<StoryLead label="开始前">

本页按实际使用顺序完成工作区、模型和能力配置。配置完成后，你可以在浏览器虚拟工作区或指定本地目录内发起第一条任务，并通过预览和审阅确认结果。

</StoryLead>

## 先把工作区放到眼前

先选择一种方式进入应用：打开官方 Demo，或运行你自行部署的实例。

<ProjectLinks />

然后：

1. 想立即开始时，点击 **直接开始聊天**，应用会创建并复用浏览器内的聊天工作区。
2. 想处理已有文件时，点击 **打开本地工作区**，再在系统对话框里选择目录并允许浏览器访问。

![欢迎页：打开本地工作区](/images/open-workspace.png)

<Callout>
聊天工作区的数据保存在当前站点的 IndexedDB，左下角会显示占用；本地文件夹则是 Agent 的明确读写范围，会话配置保存在目录里的 <code>.cottage/</code>，方便随工作备份。清除站点数据会删除虚拟工作区。
</Callout>

## 给这次任务选一个模型

你不用一次配置所有提供商。先接入一个你已经有 Key、愿意用于第一项任务的模型即可。

1. 点击右上角 **设置**，进入 **模型配置**。
2. 选择提供商（例如 DeepSeek、OpenAI、通义等；自定义网关选「自定义 OpenAI 兼容」并填写 API 地址）。
3. 填入 API Key，选择模型并保存。

![设置 → 模型配置：添加服务商入口](/images/settings-llm.png)

<Callout kind="tip">
Key 只保存在浏览器本地，不会写进工作区文件。若你使用代理，也可由代理侧保存 Key。
</Callout>

## 只打开这次真正需要的能力

现在回到聊天区，看看输入框上方的 **模型与能力**。写 PPT 时打开 **办公文档**，改项目时打开 **代码改造**，调研时打开 **深度研究**；不需要的能力先不碰。

![设置 → 能力配置：内置能力开关](/images/capability-toggle.png)

<StoryBeat title="按需连接 Cottage Service">

稳定搜索、动态网页抓取或网页自动化需要 Cottage Service。它不是开始对话的前提：等你确实需要这些能力时，再按 [Cottage Service](/concepts/cottage-service-concepts) 的说明连接即可。

</StoryBeat>

## 交代第一件小事

回到右侧输入框，直接说清楚结果应该落在哪里：

<div class="oc-prompt">
  <span class="oc-prompt__label">可以这样开始</span>
  把 README 里的快速开始一节总结成 5 条要点，写到 notes/quickstart.md。不要改其它文件。
</div>

当它显示询问、允许 / 拒绝或暂存审阅时，先看清楚再继续。文件出现后，打开预览核对内容；不满意就基于同一份结果继续追问。

## 出发前看一眼

- [ ] 工作区已打开。
- [ ] 模型可选且能发出消息。
- [ ] 这次需要的能力包已打开。
- [ ] （可选）网页任务所需的 Cottage Service 已连接。

<NextReading to="./ui" title="看看结果会出现在哪里">

认识文件、聊天、预览与审阅各自的位置；下一次你就知道该盯住哪里。

</NextReading>
