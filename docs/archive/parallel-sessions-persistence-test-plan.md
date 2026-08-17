# 并行会话 · 中途落盘 · 状态提示 —— 测试计划

本文件覆盖本次「并行会话、中途落盘与状态提示」改造的验收测试。目标是保证：
每一轮流式回复结束即落盘且可恢复；后台会话可并行运行并被追踪；进行中/已中断的
会话在 UI 有明确提示；关闭/刷新有拦截；多会话下的交互闸门互不串扰。

## 涉及模块

- 多实例注册表：`frontend/src/stores/agent.ts`（`agents: Map<sessionId, AgentEntry>`）
- 每会话运行时状态：`sessionRuntimeStatus`（`{ busy, inFlight, updatedAt }`）
- 中途落盘：`CottageAgent.getPersistableSnapshot()` + `schedulePersist`（节流 800ms）
- 交互闸门隔离（InteractionHub）：`frontend/src/platform/interaction/interactionScope.ts`
  + 审批 / 计划审批 / 暂存审批 / askUser / 规格审批五处闸门按 `sessionId` 隔离
- 状态提示：历史列表角标、历史按钮后台活跃圆点、后台完成 toast、`beforeunload` 拦截

## 名词与状态语义

- **运行中（running）**：`busy === true`，Agent 正在流式回合中。
- **已中断（interrupted）**：`busy === false && inFlight === true`，上次回合在刷新/关闭
  前未正常收尾（展示级恢复：可看到中断前内容并标注「已中断」，不自动续跑）。
- **后台会话**：非当前活跃、但实例仍存活于注册表（通常因 `busy` 被保活）。

---

## 一、中途落盘与逐轮持久化

1. **单轮落盘**：新建会话，发送一条会触发多轮工具调用的指令。
   - 期望：每一轮 `assistantComplete` 后，`.cottage` 下该会话历史文件即时更新；
     流式过程中约每 800ms 有一次轻量草稿落盘（`persistSessionDraft`）。
2. **流式中途快照**：回合进行中（未结束）时读取快照。
   - 期望：`getPersistableSnapshot().history` 末尾包含一条 `interrupted: true` 的
     assistant 草稿（仅当最后一条为 user 时补入，避免与已 push 的 assistant 重复）。
3. **标题生成**：首轮完成后。
   - 期望：`persistSession` 生成标题（原标题为「新对话」时），并刷新会话索引。

## 二、展示级恢复（刷新/重启）

1. **运行中刷新**：会话 A 正在流式回复时刷新页面。
   - 期望：重新挂载后，A 展示中断前的内容，历史列表 A 标注「已中断」；不自动续跑。
   - 校验点：`mountChatInner` 读 `snapshot.runtime.inFlight` → `sessionRuntimeStatus[A].inFlight`。
2. **正常完成后刷新**：会话完成后刷新。
   - 期望：完整历史恢复，无「已中断」标注。
3. **工具调用中断修复**：中断发生在工具调用未闭合处。
   - 期望：`repairToolCallHistory` 为缺失的 tool 结果补占位（`[已中断或缺失]`），
     重新发送时不触发 LLM 的 tool_call 校验错误。

## 三、并行后台会话

1. **后台保活**：会话 A 运行中，切到会话 B。
   - 期望：A 的实例保留在注册表继续运行（`switchChat` 默认不 teardown busy 实例）；
     A 完成时按 A 的 `sessionId` 落盘。
2. **后台完成 toast**：在 B 停留期间 A 完成。
   - 期望：右上角弹出「后台对话完成 ·『A 标题』」通知（`notifyBackgroundComplete`，
     `sessionId !== activeChatId` 才弹）。
3. **切回复用实例**：从 B 切回 A。
   - 期望：走 `mountChatInner` 的 reuse 分支，直接复用 A 实例，不重建、不丢失在途状态。
4. **idle 会话回收**：A 已空闲（非 busy），切走。
   - 期望：`teardownCurrentChat` 走 `!busy` 分支 → `teardownEntry` 彻底销毁（内存有界）。
5. **强制 teardown**：切换模型/工具组/密钥重载（`force: true`）。
   - 期望：即使 busy 也 abort + teardown；`initAgentForWorkspace` 无 ws 分支走 `teardownAll`。

## 四、状态提示与拦截

1. **历史列表角标**：打开历史面板。
   - 期望：运行中会话显示「运行中」（含 spin），已中断会话显示「已中断」角标。
2. **历史按钮圆点**：存在后台运行会话时。
   - 期望：历史按钮右上角显示小圆点，`title` 提示「N 个后台对话进行中」
     （`backgroundBusyCount` 排除当前活跃会话）。
3. **关闭/刷新拦截**：任一会话 busy 时尝试关闭标签/刷新。
   - 期望：`beforeunload` 触发浏览器确认弹窗；离开前对所有 busy 会话执行
     `persistSessionDraft`。无 busy 会话时不拦截。

## 五、交互闸门按会话隔离（InteractionHub）

对以下五类闸门分别验证：**审批**（policy）、**计划审批**、**暂存审批**（默认写审阅）、
**askUser**、**规格审批**。

1. **后台不劫持**：会话 A（后台）触发某闸门，当前停留在会话 B。
   - 期望：B 的 UI **不**弹出 A 的待处理项；A 的 promise 挂起、A 在历史列表显示「运行中」。
2. **切回可见**：从 B 切回 A。
   - 期望：A 的待处理项在 UI 正常呈现并可响应（依赖 `activeInteractionSessionId`
     + `interactionRevision` 驱动 UI 计算属性刷新）。
3. **响应投递正确**：在 A 的 UI 点击「允许/拒绝/批准/回答」。
   - 期望：仅 A 的 promise 被 resolve；B 不受影响。
4. **同时待处理**：A、B 各自都有待处理项。
   - 期望：两者按 `sessionId` 独立存储，互不覆盖；切换会话分别看到各自的项。
5. **销毁清理**：`teardownEntry`（force/abort 或 idle 回收）。
   - 期望：该会话在五类闸门的待处理项被 `cancelPending*(reason, sessionId)` 全部拒绝，
     无悬挂 promise。

## 六、工作空间切换与清理

1. **切换工作空间**：`prepareWorkspaceSwitch`。
   - 期望：`teardownAll({ abort: true })` 中断并销毁所有实例；清空 `sessionRuntimeStatus`；
     `setActiveInteractionSession(null)`。
2. **无残留**：切换后回到原工作空间。
   - 期望：从磁盘重新加载会话；无跨工作空间的内存残留（实例/闸门/运行时状态）。

---

## 回归清单（不应破坏）

- 单会话正常聊天、工具调用、审批/暂存审阅、计划/规格模式仍工作如常。
- 历史列表切换、新建会话、trace 面板正常。
- 密钥缺失 / 无模型时的占位与提示逻辑不变。

## 验证方式

- 以手动交互为主（涉及流式、刷新、多会话切换、浏览器拦截等运行期行为）。
- `tsc` / `lint` / `build` / 单测由开发者按需自行执行（本仓库约定不自动执行）。
