# 隐藏功能清单

系统中已实现但暂时对用户隐藏的功能，待产品策略明确后可快速恢复。

## 编译时裁剪

前端采用 `public` / `full` 两种构建档位：

| 命令 | 行为 |
|---|---|
| `pnpm build` / `pnpm build:public` | 默认公开发行构建；隐藏功能入口解析到 `frontend/src/build/public-stubs/`，实现模块、Worker 与专用依赖不进入 Rollup 模块图 |
| `pnpm build:full` | 保留隐藏功能实现，用于内部验证或未来恢复 |
| `pnpm dev` | 开发服务器保留完整实现，但产品入口仍按本文所述保持隐藏 |

裁剪入口维护在 `frontend/vite.config.ts` 的 `publicBuildFeatureStubs`。当前 public 构建裁剪 Python 数据分析、旧 Plan Gate、旧任务模式/子任务、编排模式和本地 RAG；公开的统一 Plan Mode、版本历史 Beta 与 Vision 不参与裁剪。构建插件还会检查最终模块图，如果隐藏实现或其专用依赖重新泄漏进 public 构建，会直接终止构建并报告来源。

`__COTTAGE_INCLUDE_HIDDEN_FEATURES__` 是编译期常量。任务模式与 Plan Gate 的核心分支会在 public 构建中被死代码消除；其余仍被公共 UI 或 store 引用的边界由无副作用 stub 接管。因此，仅修改 `.cottage/config.json` 不能在 public 构建中重新启用这些能力；恢复时除完成下文对应步骤外，还需使用 `pnpm build:full`，或调整构建档位后再发布。

---

## 1. 版本历史 Beta（已公开）

**状态**：原本地 Git/Checkpoint 实现已废弃并从运行链路移除。新版以 `.cottage/history/v2/` 下的字节对象池、基线和增量版本重建，作为 public 构建中的公开 Beta 提供。

**启用边界**：设置页签公开可见，但每个工作区默认关闭；只有打开工作区后，用户才能明确启用。配置只保存到 folder 层。关闭状态不会创建 v2 目录，文件区也不显示版本历史入口。

**数据隔离**：旧 `.cottage/history/git` 及旧历史元数据不会被新版读取、迁移、统计、写入或删除。`.cottage/**` 永久排除在捕获范围外。

**相关模块**：

- `frontend/src/history/storage.ts` — v2 原始字节对象存储
- `frontend/src/history/historyService.ts` — 版本链、配额、清理、删除和事务恢复
- `frontend/src/history/autoCheckpoint.ts` — 工作区变更合并与 Agent 回合捕获
- `frontend/src/components/History/HistoryPanel.vue` — 时间线与历史管理面板

本节保留在隐藏功能文档中，用于记录从隐藏能力到公开 Beta 的状态变化；它不再属于 public 构建裁剪项。

---

## 2. Python 数据分析（builtin.data-analysis）

**隐藏原因**：Pyodide 运行时较大，当前阶段不主动向用户宣传；能力仅在 full 构建中保留，public 构建不包含其工具与 Worker。

**涉及代码位置**：

| 位置 | 隐藏方式 |
|---|---|
| `frontend/src/components/Settings/CapabilityConfigTab.vue` | `HIDDEN_BUILTIN_PACK_IDS` 集合包含 `'builtin.data-analysis'`，从 UI 卡片列表中过滤；「执行脚本」面板内 Python/Pyodide 只读配置用 `v-if="false"` 隐藏（侧栏 `script` 与 JS `runScript` 说明保留） |
| `frontend/src/components/Preview/Preview.vue` | 欢迎页能力入口过滤掉 `python` group |
| `frontend/src/config/constants.ts` | `disabledBuiltinPacks` 默认包含 `'builtin.data-analysis'` |

**相关模块（代码保留，未删除）**：

- `frontend/src/platform/debug/workerMonitor.ts` — runPython Worker 监控
- Agent Cottage 工具链中的 `runPython` 实现
- `CapabilityConfigTab.vue` 中「执行脚本」面板内的 Python 配置块（`v-if="false"`）

**恢复方法**：
1. `CapabilityConfigTab.vue` 从 `HIDDEN_BUILTIN_PACK_IDS` 移除 `'builtin.data-analysis'`，并将执行脚本面板内 Python 配置块的 `v-if="false"` 去掉；按需恢复 `scriptLead` 中关于 Python 的说明文案
2. `Preview.vue` 移除 `python` 过滤条件
3. `constants.ts` 从 `disabledBuiltinPacks` 默认值移除 `'builtin.data-analysis'`

---

## 3. 计划闸门（Plan Gate）

**状态**：旧的文本型 Plan Gate 保留为 full 构建兼容模块，不再属于公开统一 Plan Mode 的运行链路。公开 Plan Mode 使用 `frontend/src/plan/` 下的版本化计划、路径范围闸门、步骤预算和检查点；它不依赖 `platform.planGate.enabled`。

**涉及代码位置**：

| 位置 | 隐藏方式 |
|---|---|
| `frontend/src/config/constants.ts` | 默认配置 `platform.planGate.enabled = false` |
| `frontend/src/components/Settings/CapabilityConfigTab.vue` | 治理策略面板中无 Plan Gate 开关（仅有暂存审阅） |
| `frontend/src/agent/createCottageAgent.ts` | 仅旧 chat 治理分支可能创建 PlanSession；`mode === 'plan'` 使用新的 PlanToolGuard |

**相关模块（代码保留，未删除）**：

- `frontend/src/platform/plan/` — 完整实现：planEngine、createPlanGate、submitPlanTool、planApprovalGate
- `frontend/src/components/Chat/MessageView.vue` — 计划审批卡片 UI（`submitExecutionPlan` 工具渲染）
- `frontend/src/agent/constants.ts` — 计划闸门系统提示词注入

**恢复旧 Plan Gate 的方法**：
1. `CapabilityConfigTab.vue` 治理策略区块增加 Plan Gate 开关
2. `constants.ts` 将 `platform.planGate.enabled` 默认值改为 `true`（或由用户手动开启）

---

## 4. 任务模式内部工具（taskHandoff / dispatchSubtask）

**隐藏原因**：属于任务系统内部基础设施，非用户可选能力，仅在任务模式下由 Agent 自动使用。

**涉及代码位置**：

| 位置 | 隐藏方式 |
|---|---|
| `frontend/src/agent/cottageTools.ts` | `taskHandoff` 和 `dispatchSubtask` 工具已实现 |
| `frontend/src/agent/toolDescriptions.ts` | 未注册到 `TOOL_DESCRIPTIONS` / `TOOL_LOCALE_ALIASES` / `TOOL_RISK`，设置面板不展示 |
| `frontend/src/task/buildPrompt.ts` | `taskHandoff` 在最后一轮被强制要求调用 |
| `frontend/src/task/subtask.ts` | `dispatchSubtask` 支持前台/后台两种执行模式 |

**说明**：这些工具不需要用户感知，属于正常的内部隐藏，无需恢复。

---

## 5. 任务模式与任务面板（Task Mode / TaskPanel）

**隐藏原因**：旧任务系统（自主多回合执行 + 验收 + 子任务派生）为半成品，已由统一 Plan Mode 取代，暂不向用户开放；聊天引擎对外只提供 `chat | plan`。

**现状**：旧 `task` 模式仍未接入 UI。公开产品使用同聊天的 `chat | plan`，由 `frontend/src/plan/` 的 Plan v1 repository/runner 提供不可变 commit/head、DAG 步骤、Web Locks、实际 MutationReport、浏览器验证和恢复。旧 `.cottage/tasks/` 不自动迁移；TaskPanel 仍未挂载。旧 Spec 只保留只读消息渲染和“复制为新 Plan”，其审批、自动启动和执行入口不再从 store 公开。

**涉及代码位置**：

| 位置 | 隐藏方式 |
|---|---|
| `frontend/src/components/Task/TaskPanel.vue` | 组件已实现，但无任何上层组件引用/挂载，UI 无入口 |
| `frontend/src/stores/task.ts` | `useTaskStore`（含 `createTask` / `startTask`）已实现，仅被未挂载的 TaskPanel 使用 |
| `frontend/src/agent/createCottageAgent.ts` | 仅内部恢复路径可使用 `mode === 'task'`；公开聊天入口只创建 `chat | plan` |

**相关模块（代码保留，未删除）**：

- `frontend/src/task/` — 完整任务系统：TaskRunner（自主回合循环）、persistence（spec/state/plan/events 等分文件持久化）、subtask、taskControl、verify、buildPrompt
- `frontend/src/stores/task.ts` — 任务生命周期与 `recoverInterruptedTasks`（工作区打开时恢复被中断任务）
- 任务模式内部工具 `taskHandoff` / `dispatchSubtask` — 见上文第 4 节

**恢复旧 TaskPanel 的方法**：
1. 在主布局（如聊天/侧栏容器）中挂载 `TaskPanel.vue`，提供任务入口
2. 打通 `taskStore.createTask` / `startTask` 的调用路径与任务列表展示
3. 确认 `mountTaskSession` 以 `task` 模式创建 Agent，并串联 TaskRunner 与验收流程

---

## 6. 图片设置 Tab（Vision Settings）——已恢复

**状态**：已恢复上线。多模态图片能力打通后，设置页「图片」tab 已取消隐藏，表单控件去除 `disabled` 并通过 `patchVision` 写回分层配置（`vision.*`）。

**当前相关模块**：

- `frontend/src/components/Settings/FeatureSettingsTabs.vue` — `vision` tab 与可编辑表单（enabled / requireModelCapability / storage / maxImageBytes / maxDimensionPx）
- `frontend/src/config/constants.ts` — `VisionConfig` / `DEFAULT_COTTAGE_CONFIG.vision`
- `frontend/src/chat/attachments.ts` — 图片附件与 `isVisionEnabled()`
- `frontend/src/chat/attachmentStorage.ts` — workspace-file 附件落盘（`.cottage/attachments/`）
- `frontend/src/components/Chat/ChatComposer.vue` — 粘贴/拖拽/上传/图片链接入口（受 `vision.enabled` 与模型能力门控）

---

## 7. 编排模式（Orchestration）

**隐藏原因**：编排每步冷启动全新子 Agent、串行调度、上下文按字符截断，执行慢且大型任务常常跑不完；其定位已由公开的统一 **Plan Mode**（单会话内版本化计划、范围批准、DAG 步骤和验证）取代。

**现状**：chat 模式不再注入编排启动工具 `cottage_startOrchestration`，模型无法再触发编排；`OrchestrationFloating.vue` / `OrchestrationPanel.vue` 本就未被任何组件挂载（仅 `components.d.ts` 有自动生成的类型声明）；`OrchestrationCard.vue` 仅在消息存在 `orchestration` 分段时渲染，新流程不会再产生该分段。

**涉及代码位置**：

| 位置 | 隐藏方式 |
|---|---|
| `frontend/src/agent/createCottageAgent.ts` | import 与 chat 模式 `else if` 注入分支已 `// [HIDDEN]` 注释，编排工具不再注入；复杂任务建议由 `suggestPlanMode` 承担 |
| `frontend/src/stores/agent.ts` | `onStartOrchestration` 回调仍传入（仅为保留 `startOrchestration` 引用），但 Agent 端不再消费、不会调用 |
| `frontend/src/agent/toolDescriptions.ts` | `cottage_startOrchestration` / `orch_*` 标签保留，仅用于历史消息中已有编排工具调用的渲染 |

**相关模块（代码保留，未删除）**：

- `frontend/src/orchestrator/` — 完整编排实现：`Orchestrator`、`orchestratorTools`、`persistence`、`types`
- `frontend/src/components/Orchestrator/` — `OrchestrationCard.vue`（消息内渲染）、`OrchestrationPanel.vue` / `OrchestrationFloating.vue`（均未挂载）
- `frontend/src/stores/agent.ts` — `startOrchestration` / `recoverOrchestration` / `resumeOrchestration` / `cancelOrchestration` / `answerOrchestrationHuman` / `handleOrchestrationEvent` / `detachActiveOrchestrator`
- `frontend/src/components/Chat/MessageView.vue` — `orchestration` 分段渲染分支与 `sectionKey`
- `frontend/src/components/Chat/ChatPanel.vue` — `answerOrchestrationHuman` 人工问答回传

**恢复方法**：
1. `createCottageAgent.ts` 取消 import 与 chat 模式 `else if` 分支的注释，恢复注入 `createStartOrchestrationTool`（可与 `suggestSpec` 调整优先级或二选一）
2. 如需悬浮进度面板，在主布局挂载 `OrchestrationFloating.vue`
3. `recoverOrchestration` 已保留在 `mountChatInner` 会话恢复流程中，无需额外改动

---

## 标记约定

## 8. 本地 Embedding / 向量索引（Local RAG）

**隐藏原因**：本地小型 embedding 模型在工作区代码检索中的收益有限，而启动时加载模型和全量建索引会带来明显的时间与资源成本。当前产品默认采用文本搜索与文件名/路径搜索。

**隐藏方式**：

| 位置 | 隐藏方式 |
|---|---|
| `frontend/src/config/constants.ts` | `rag.enabled`、自动建库、自动增量索引与 Agent 语义工具默认关闭 |
| `frontend/src/stores/workspace.ts` / `frontend/src/stores/agent.ts` | 打开工作区及文件改动后不再调度向量建库 |
| `FeatureSettingsTabs.vue` / `DebugPanel.vue` | 移除 RAG 设置页和向量索引调试页入口 |
| `FileSearchToolbar.vue` / `runWorkspaceSearch.ts` | 搜索界面只提供文本与文件名/路径搜索，不再导入或调用语义检索 |
| `createCottageAgent.ts` | 不向 Agent 注册 `searchWorkspaceSemantic` |

**相关模块（代码保留，未删除）**：

- `frontend/src/rag/`：embedding provider、切块、向量存储、索引与检索实现
- `frontend/src/components/Rag/`：索引管理 UI
- `frontend/src/rag/ragCottageTools.ts`：Agent 语义检索工具

**恢复方法**：重新开放设置/调试/搜索/Agent 入口（恢复设置 tab 时同时重新导入 `ServerOutline` 图标），并恢复工作区打开与文件变更时的索引调度；恢复前应评估本地模型体积、首次建库时机与检索质量。

代码中使用 `// [HIDDEN]` 前缀注释标记隐藏点，便于全局搜索定位：

```
grep -r "\[HIDDEN\]" frontend/src
```
