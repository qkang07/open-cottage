# 和 Agent 对话

<StoryLead label="如何交代任务">

对话模式适合问答、小改动与边聊边试。说明目标、输出路径和不应修改的范围；对话会保存在工作区中，方便围绕已有结果继续修改。

</StoryLead>

## 发消息前，先给它一张地图

确认模型已配置、相关能力已打开；如果任务依赖某个文件，在输入框里用 `@` 引用它。这样你不必让它在整个目录里猜你的意图。

![输入 @ 后从当前工作区选择文件](/images/at-mention.jpeg)

## 看着它把事情做完

<StepList :items="[
  { title: '交代目标和边界', text: '说明输出到哪、不要改什么；越具体，结果越容易验收。' },
  { title: '观察它读了什么、写了什么', text: '消息里会展示工具调用。有疑问就立刻补充说明。' },
  { title: '回答询问与审批', text: '遇到 askUser 或允许 / 拒绝，先把你的决定说清楚。' },
  { title: '审阅暂存改动', text: '默认可能先进入暂存：看 diff，再应用或丢弃。' },
  { title: '回到预览验收', text: '打开生成文件；不满意，直接围绕这一份结果继续修改。' },
]" />

![只读探索与写入审批工具卡片](/images/chat-tool-calls.png)

<div class="oc-prompt">
  <span class="oc-prompt__label">一句清楚的交代</span>
  阅读 @docs/plan.md，把「本周目标」三节改成可执行 checklist，保存到 docs/plan.md，不要改其它章节。
</div>

<StoryBeat title="复杂任务使用计划模式">

如果会动多个文件、公共接口，或者你自己也还没想清边界，不要逼着对话一次做完。切到 [计划模式](./spec)，先一起把路径与验收写下来。

</StoryBeat>

## 把上下文留在这里

右侧可新建或切换会话。历史保存在工作区 `.cottage/` 下，下次打开同一文件夹还能接着看；图片等附件通常落在 `.cottage/attachments/`，视觉输入需要当前模型支持。

<NextReading to="./governance" title="学会在写入前确认改动">

当 Agent 要把结果写进文件夹时，你仍能逐项查看、批准或丢弃。

</NextReading>
