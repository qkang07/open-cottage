# Cottage 前端视觉与交互评审

> 本文档以“新接手项目的视角”，基于对 `platform-vision-and-roadmap.md`、设计 token（`frontend/src/index.css`）、主框架（`CottageContent.vue`）、聊天面板与消息渲染（`ChatPanel.vue` / `MessageView.vue`）、欢迎页（`WelcomePage.vue`）的通读，给出视觉与交互层面可调整的点。
>
> 评审标尺来自项目自身定下的调子：**方便人（而非方便 LLM）、可核对、可审批、可回放**。因此下面不少建议不是“好不好看”，而是“平台已经算出来、但 UI 没显形”的东西。
>
> 关联文档：
>
> - [平台愿景与路线图](../platform-vision-and-roadmap.md)（§2.2 方便人、§5.3 Policy、§5.4 Plan Gate、Phase 2 Deliverable UI）
> - [Coding Pack 进度](../coding-pack-progress.md)

---

## 0. 总体判断

整体视觉非常克制：中性灰 + 单一蓝色强调、4px 栅格、统一 7px 圆角、扁平、薄阴影。这套语言本身没问题，且 token 体系（`index.css`）已经把 light/dark 双主题、Element Plus 变量映射做得很整齐。

**核心落差不在美观，而在“可见性”**：文档反复强调“有 diff、有交付清单、有风险审批、可回放”，而聊天区当前几乎只有折叠的文本行 + 一个 plan 卡片。平台已经计算的 `riskLevel`、计划、写入内容、交付物，在界面上大多是“一行 muted 灰文本”。所以下面的建议优先围绕**把这些已有信息显形**，而非引入新装饰。

---

## 1. 视觉层面

### 1.1 工具调用没有“风险语义色”，与 Policy Engine 脱节 — ✅

`MessageView.vue` 已用 `toolRisk` + 左侧色条 / 风险标签；token 见 `--cottage-risk-*`。

### 1.2 文件写入是“裸流”，没有 diff

`tool-write-stream` 直接把新内容流式打印在一个 `<pre>` 里。这和文档核心承诺“有 diff、可核对、可回滚”矛盾——用户看到的是一整坨新文本，看不出改了哪几行。

**建议**：写完成后在折叠项内渲染一个 mini diff（增/删行高亮），并提供“在预览栏打开前后对比”的入口。这是当前性价比最高的一处改动，直接补 §4.2 “可核对”缺口。可复用 `domains/coding/ast/diff.ts`（已存在）。

### 1.3 Assistant 消息没有任何容器，扫读缺锚点 — ✅

`.message.assistant` 已加浅底 + 左侧引导线（克制、非卡片化）。

### 1.4 语义色未成体系，硬编码散落 — ✅

`--cottage-warning` / `--cottage-danger`（含 dark）已齐全，并映射到 `--el-color-warning` / `--el-color-danger`；diff / 风险边框等已改用 token。

### 1.5 空状态太“空”

`chat-empty-state` 用 `ElEmpty "暂无消息"` + 一行小字。对一个主打“把意图变成结果”的产品，这里应该是**可点击的示例任务**（“整理这个 Excel” / “给组件加一个 prop” / “生成周报 docx”），既引导又演示能力，也呼应“通用 Agent”定位下新用户不知道能干嘛的痛点。

### 1.6 Plan 卡片的视觉范式可以推广

`plan-tool-card` 的 todo 点 + 预算 tag + 置信度做得很好，是当前唯一“丰富”的组件。但 `taskComplete` 只剩一行文字。未来的 Deliverable UI（Phase 2 ⬜）完全可以沿用同一范式：一个“交付清单”卡片，每项一个文件 chip + 预览按钮 + 校验状态点。视觉一致性由此延展。

---

## 2. 交互层面

### 2.1 Plan Gate 只“告知”不“审批”

聊天模式下 plan 自动提交、自动执行，用户没有“批准这个计划再开始写”的动作。文档把 Plan Gate 列为已实现 MVP（§5.4），但当前它更像进度条而非闸门。

**建议**：在 plan 卡片上加“开始执行 / 调整 / 取消”，把 `confirm` 决策也接进 plan（而不只是 destructive 工具）。这样能把“先计划后执行”从 prompt 纪律变成 UI 纪律，与 §2.2 的审批统一。

### 2.2 审批 / askUser 闸门会被折叠吃掉

`awaitingApproval(section)` 与 `getPendingAsk()` 渲染在 `ElCollapseItem` 内容区里，而折叠项在完成后会自动收起。如果用户没在看，审批按钮就“藏”在折叠里。

**建议**：**需要人介入的状态脱离折叠、pin 在消息底部或聊天区顶部**，配轻度高亮（与 §1.1 风险色联动），处理完再下沉为普通折叠项。这是“可审批”原则最直接的 UI 体现。

### 2.3 历史会话是全覆盖 overlay，切换很重

`chat-history-overlay` 占满整个 chat panel，没有常驻会话列表。切个会话就把当前对话盖掉。

**建议**：历史做成侧边抽屉或顶部下拉，避免全覆盖；或保留 overlay 但加 ESC 关闭与键盘上下选。

### 2.4 没有键盘快捷键

发送 / 新对话 / 收起侧栏 / 聚焦输入 / 全部展开工具调用——在一个“高频对话”产品里几乎必备。当前只有 tiptap 编辑器自身的行为。

**建议**：补一套全局快捷键（Cmd/Ctrl+Enter 发送、Cmd/Ctrl+N 新对话、Cmd/Ctrl+B 收起侧栏、Cmd/Ctrl+Shift+E 全部展开工具调用等），并在 UI 上可发现。

### 2.5 工具调用“完成后即收起”，失去审计性

`groupedCallActiveKeys` 在 running 时展开、结束后收起，降噪是对的，但**没有“展开全部 / 时间线视图”**。文档把 Trace/Replay 列为缺口（§4.2 平台层 4），在它落地前，至少给每条 assistant 消息加一个“展开全部工具调用”入口，让用户能回看这一轮读了什么、写了什么。

### 2.6 上下文 token 只是一行小字

`chat-context-tokens` 是 12px 文本，红黄阈值靠颜色。建议做成输入框上沿的一根 2px 细进度条，临近上限时变色——比文字更一眼，也更适合“可观测”主线。

### 2.7 “修改过的文件”折叠条位置尴尬

`chat-modified-files-wrap` 夹在消息区和输入框之间，且默认收起。它其实是“这次对话的产出”之一。

**建议**：和未来的 Deliverable UI 合并，做成输入框上方常驻的 chips 条（点 chip 跳预览），而不是可折叠区。产出“始终可见”与“可核对”一致。

### 2.8 分隔条缺少 double-click 复位 / 吸附

`splitter-floating` 只有拖拽。常见做法是双击复位到默认宽度、拖到阈值吸附。低成本可用性提升。

### 2.9 欢迎页引导是静态三步

`STEPS` 是纯说明文字。可加一个“加载示例工作区 / 试跑一个示例任务”入口，降低第一次“我该让它干嘛”的摩擦——尤其因为产品定位是“通用 Agent”，新用户不知道它能干啥。

### 2.10 无障碍小项

`chat-session-item`、`chat-modified-files-item` 是裸 `<button>`，没有 `aria-label`，仅靠 `title`。既然视觉克制，a11y 可以补回来；focus-visible 样式也建议统一一套。

---

## 3. 优先级建议

按“直接对应文档缺口 + 纯前端可达”排序，每一步都标注对应文档条目：

| 顺序 | 事项                         | 对应文档缺口                       | 改动范围                         |
| -- | -------------------------- | ---------------------------- | ---------------------------- |
| 1  | 文件写入 diff 视图               | §4.2 可核对 / Phase 2 Deliverable | `MessageView.vue` + 复用 `ast/diff.ts` |
| 2  | 工具调用风险色 + 审批/ask 闸门 pin 出来 | §2.2 方便人、§5.3 Policy          | `MessageView.vue` + `App.css` + 语义色 token |
| 3  | Plan 卡片加批准动作              | §5.4 Plan Gate                | `MessageView.vue` + planGate 交互 |
| 4  | Deliverable 卡片            | Phase 2 ⬜ Deliverable UI      | 新组件 + `taskComplete` 渲染      |
| 5  | 空状态示例任务 / token 进度条 / 快捷键 / 会话抽屉 | 通用可用性                      | 多处小改                         |

前两项不需要后端改动，纯前端就能把“可核对 / 可审批”立刻可见化，建议作为下一轮迭代的第一步。

---

## 4. 不建议动的部分

- **整体克制的中性灰 + 单蓝强调**：与“信任、可审计”气质一致，不必为了“好看”引入多强调色。
- **统一 7px 圆角与 4px 栅格**：token 已收敛，继续遵守即可。
- **扁平薄阴影**：符合“内容为主、chrome 退后”的定位，避免回退到卡片化堆叠。

---

*文档版本：v1 · 2026-06 · 新接手视角的前端视觉/交互评审，作为路线图 §4.2 缺口在 UI 层的落地清单。*
