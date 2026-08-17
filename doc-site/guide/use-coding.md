# 改代码

<StoryLead label="适用范围">

使用 **代码改造** 能力在仓库中完成有界修改。建议从明确的现象、文件或符号开始，先查看入口与影响面，再决定是否执行修改。

</StoryLead>

## 先把边界放进对话

1. 打开代码所在文件夹作为工作区。
2. 打开 **代码改造** 能力。
3. 建议保持 [暂存审阅](./governance) 开启。

![已打开「代码改造」能力](/images/pack-coding-on.png)

## 跟着一次有界修改走

<StepList :items="[
  { title: '用 @ 指出入口', text: '引用组件、函数或直接说一个明确的功能区域。' },
  { title: '先要影响分析', text: '确认会动哪些文件、有哪些引用，再决定修改。' },
  { title: '提出最小目标', text: '说明想要的行为，也说明不要顺手重构什么。' },
  { title: '审阅 diff', text: '在暂存面板按文件看；大改先要求出计划。' },
  { title: '按自己的习惯验证', text: '应用后在本地运行你信任的验证流程。' },
]" />

<div class="oc-prompt">
  <span class="oc-prompt__label">可以这样说</span>
  找到函数 formatDate 的定义和引用。我想改成默认时区 Asia/Shanghai。先告诉我影响哪些文件；确认后再改，不要顺手格式化其它代码。
</div>

![新建文件的逐项差异与批量批准界面](/images/coding-impact-or-diff.png)

<StoryBeat title="复杂改动的处理方式">

预计会动超过 3 个文件、公共 API、路由或类型签名时，切到 [计划模式](./spec)。先把改动项和验收标准写出来，再批准执行，会比一边改一边猜更稳。

</StoryBeat>

<NextReading to="./spec" title="为复杂改动先写一份可批准的计划">

把范围、步骤与验收放到同一张计划卡上，再开始真正的写入。

</NextReading>
