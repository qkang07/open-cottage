# Open Cottage 任务执行与检索架构

> **文档性质**：架构设计 & 实现参考（原「完成率与检索提升方案」，已于 2026-07-04 全部交付）。
> **来源**：对照 opencode（任务完成率）与 Cursor 客户端骨架（执行/检索）设计，在 Open Cottage 浏览器内架构下自行实现。
> **约束**：`opencode/` 仅作研究参考，禁止提交与 import（见根目录 `AGENTS.md`）。

---

## 1. 设计目标

Open Cottage 的核心承诺是：把自然语言意图稳定地变成**可验证**的结果。

| 能力域 | 目标 | 关键机制 |
|--------|------|----------|
| **任务完成率** | 少静默失败、可续跑、长任务不爆上下文 | wake 续跑、finish reason、handoff、compaction、子任务 |
| **计划遵循** | Agent 不无视预算与计划 | plan reminder 合成注入、planGate |
| **稳健执行** | 少空转、中断可恢复 | doom-loop 闸、孤儿 tool 补全 |
| **检索质量** | 语义召回准、索引不卡 UI | AST 切块、per-chunk 向量、Merkle 跳过、index worker |
| **执行体验** | 长输出可见、大文件编辑不卡 | 工具流式 delta、diff/AST worker |
| **交付形态** | 文件清单 + 结构化摘要 | manifest + canvas 交付物 |

**红线**（全程遵守）：

- 浏览器内运行；隔离单元为 **Web Worker**，非扩展进程。
- 不引入 native napi；原生能力走 `local-agent` 或 WASM。
- coding 专属优化落在 `domains/coding` 能力包，不污染核心。
- 状态与索引落 `.cottage/`，本地优先。

---

## 2. 总体架构

### 2.1 执行链路（任务模式）

```
用户 / Agent
    │
    ▼
TaskRunner.run ──while──► hasPendingAgentTurn?
    │                         │
    │    control.wake ◄───────┤ verify-fail / instruction / subtask-done / stalled-recovery
    │                         │
    ├─► buildPromptForTurn (plan reminder + handoff + verify 回灌 + 目标)
    ├─► CottageAgent.next(prompt)
    │       ├─ maybeCompact (超阈值压缩历史)
    │       └─ while tool_calls:
    │             policyGate / planGate / doomLoopDetector
    │             invokeToolStream | invoke  (流式 or 同步)
    │             diffWorker (写入快照 diff)
    ├─► signals (complete / fail / handoff)
    └─► tryComplete → verify engine → completed | wake(verify-failed)
```

### 2.2 模块分层

```
┌─────────────────────────────────────────────────────────────┐
│  UI：TaskPanel · MessageView · TracePanel · Deliverable*    │
├─────────────────────────────────────────────────────────────┤
│  Store：task.ts (TaskRunner) · agent.ts (CottageAgent)      │
├─────────────────────────────────────────────────────────────┤
│  任务：TaskRunner · taskControl · buildPrompt · subtask     │
│  Agent：CottageAgent · compaction · doomLoop · toolStream   │
│  闸门：planEngine · policyEngine · verify engine            │
├─────────────────────────────────────────────────────────────┤
│  RAG：indexCore · indexer · merkle · chunker · retrieve     │
│  Worker：index.worker · script.worker · diff.worker ·       │
│           ast.worker                                        │
├─────────────────────────────────────────────────────────────┤
│  持久化：.cottage/tasks/* · .cottage/index/* · chat history │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 关键文件索引

| 域 | 路径 | 职责 |
|----|------|------|
| 外层循环 | `task/TaskRunner.ts` | 多轮驱动、验收、handoff、wake 消费 |
| 续跑信号 | `task/taskControl.ts` | `wake` / `consumeWake` / pause / cancel |
| Prompt | `task/buildPrompt.ts` | 目标/验收/handoff/plan reminder 拼装 |
| 子任务 | `task/subtask.ts` | 前台同步 + 后台回投主会话 |
| Agent | `agent/CottageAgent.ts` | 流式 LLM、工具循环、compaction、trace |
| Finish reason | `agent/finishReason.ts` | stalled / content_filter / empty |
| Compaction | `agent/compaction.ts` | 历史摘要压缩 |
| Doom loop | `agent/doomLoop.ts` | 循环检测 → 软提醒模型 → 多次后 policy 审批 |
| 工具流式 | `agent/toolStream.ts` | runScript、fetchWebPage 增量输出 |
| Diff | `agent/diffWorkerHost.ts` | 写入前后 unified diff |
| RAG 建库 | `rag/indexCore.ts` | 全量/增量核心（Worker 共用） |
| Merkle | `rag/merkle.ts` | 目录树 hash，跳过未变子树 read |
| 向量 | `rag/chunkVectorStore.ts` | per-chunk 持久化 + legacy 迁移 |
| AST 编辑 | `domains/coding/ast/astWorkerHost.ts` | astEdit dryRun/apply |
| Canvas | `components/Chat/DeliverableCanvasCard.vue` | 表格/待办/Markdown 交付物 |
| Trace | `platform/trace/types.ts` | 全链路事件模型 |

---

## 3. 任务完成率子系统（Part A）

### A1. Drain 循环 + wake 续跑

**问题**：verify 失败、运行中追加指令等场景需统一续跑，而非散落特殊分支。

**实现**：

- `TaskRunControl.wake(reason)` 置位 `pendingWake`；主循环 `consumeWake()` 后注入对应 prompt 片段。
- `hasPendingAgentTurn`：`pendingWake`、verify 未通过、未触顶 maxTurns 等条件统一判断。
- `stores/task.addInstruction` → `wake('operator-instruction')`。
- verify fail → `wake('verify-failed')`，不再在 `tryComplete` 内重复发 prompt。

**Wake 原因枚举**：`verify-failed` · `operator-instruction` · `stalled-recovery` · `subtask-done`

### A2. Finish reason 显式化

**问题**：content-filter / 空输出被当成正常完成，白白消耗 turn。

**实现**：

- `normalizeFinishReason` / `classifyLlmError` 同层处理厂商差异。
- `stalled`：无 tool_calls 且无实质内容 → `TaskRunner` 首次回灌追问，连续 2 次 → `failTask`。
- `content_filter` / `refusal` → `rewind` + 用户可见错误，trace `endReason` 记录。

### A3. 优雅 maxTurns 收尾（handoff）

**问题**：触顶硬 fail，无法交接续跑。

**实现**：

- 倒数第二轮：`buildHandoffPrompt`，禁用除 `taskHandoff` 外工具。
- `taskHandoff` 工具 → `TaskState.handoff` + 事件 `handoff` → 状态 `paused`（非 failed）。
- `resume` 重置 `turnCount`，handoff 内容拼入后续 prompt。

### A4. 自动 compaction

**问题**：长任务上下文爆满导致硬失败。

**实现**：

- `maybeCompact`：token 占比 ≥ 阈值（默认 0.8）时摘要旧历史，保留近 N 轮。
- 强制保留：计划、manifest、verify 相关消息不进摘要。
- `StoredMessage.synthetic` + `compaction` 标记；trace `TraceCompactionEvent`。

**配置**：`cottageConfig` compaction 段（阈值、保留轮数、摘要模型）。

### A5. Plan 合成 reminder

**问题**：计划与预算信号弱，超预算后 Agent 反复撞闸。

**实现**：

- `buildPlanReminder`：每轮 user 消息前置 `<system-reminder>`（步骤状态、预算用量、上次 blocked 原因）。
- `PlanSession.isOverBudget` / `lastBlockedReason` 驱动文案强化。

### A6. 子任务

**问题**：单会话单 Agent，无法并行子目标。

**实现**：

| 模式 | 行为 |
|------|------|
| `background=false` | `dispatchSubtaskForeground` 同步阻塞至完成 |
| `background=true` | 立即返回；完成后 `appendSyntheticUserMessage` + `wake('subtask-done')` |

- 子 Agent：`isSubtask: true`，仅 `subtaskComplete` / `taskFail`，禁止嵌套与 `taskComplete`。
- 状态：`TaskState.subtasks[]` 落盘；`TaskPanel` 展示列表（含「后台」标签）。
- 接线：`stores/agent.buildSubtaskRunnerDeps` → `createCottageAgent` 多实例（子会话独立 history）。

### A7. Doom-loop 闸

**问题**：同参重复调用、同工具连续失败漏检。

**实现**：

- `DoomLoopDetector`：argsHash 重复、同 name 连续失败、窗口内 args 高重复。
- 命中 → 本回合前 2 次仅向模型返回软提醒（跳过本次调用）；第 3 次起 → `policyGate({ toolName: 'doom_loop' })` → trace `doom_loop`。
- 配置：`autoRejectDoomLoop`（无人值守可默认拒绝）。

### A8. 孤儿 interrupted tool

**问题**：abort 后 assistant 含 tool_calls 但无 ToolMessage，部分 provider 报错。

**实现**：

- `finalizeInterruptedToolCalls`：补 `[已中断]` ToolMessage。
- `StoredMessage.interrupted`；`historyAdapter` 原样送回模型。

---

## 4. 检索与执行骨架（Part B）

### B1. 索引 Worker

- `rag/index.worker.ts` + `indexWorkerHost.ts`：建库在 Worker，FSA `rootHandle` 跨线程传递。
- Office 文本抽取 RPC 回主线程（`readOfficeText`）。
- 失败回退主线程 `buildIndexCore`；工作区切换 `resetIndexWorker`。

### B2. AST 切块（coding pack）

- `chunkByAst` / `chunkFile`：有 adapter 时按顶层符号切块，过大再 char 二级切。
- 配置：`rag.indexing.chunkStrategy: 'char' | 'ast'`（默认 `char`）。

### B3. Per-chunk 向量 + Merkle 目录树

**Per-chunk 向量**：

- `chunkVectorStore`：向量按 `chunkId` 单文件存储；`incrementalIndex` 只增删变更 chunk。
- `migrateLegacyVectors()`：旧 `vectors.bin` 自动迁移。

**Merkle**：

- `merkle.json`：目录子树聚合 hash。
- `planFileReads`：root/子目录 hash 未变则跳过 `readFile`，仅读变更子树。
- 配置：`rag.indexing.useMerkle`（默认 true）。

### B4. 工具结果流式 delta

- `toolStream.ts`：`invokeToolStream` 产出 `delta` | `done` chunk。
- 已接入：`runScript`（Worker log 流）、`fetchWebPage`（进度 + 正文分块；支持 local-agent fetch）。
- UI：`callSection.result` 增量 append；trace `streamed` + `chunkCount`。

### B5. Diff / AST Worker

| Worker | 路径 | 用途 |
|--------|------|------|
| diff | `agent/diff.worker.ts` | 写入类工具 before/after → unified diff |
| ast | `domains/coding/ast/ast.worker.ts` | `astEdit` babel 解析与 patch apply |

- `FileWriteDiff.vue` 优先渲染预计算 `diff`，不在主线程算 LCS。
- 失败回退主线程；工作区切换 `terminateDiffWorker` / `terminateAstWorker`。

### B6. Canvas 结构化交付物

- 工具：`submitDeliverableCanvas`（与 `taskComplete` 独立，可并存）。
- Schema：`table` · `todo-list` · `markdown`（见 `task/types.ts` `TaskCanvasPayload`）。
- 落盘：`.cottage/tasks/{id}/canvas.json`。
- UI：`DeliverableCanvasCard`（对话 + TaskPanel）；事件 `deliverable_canvas`。

---

## 5. 横切能力

### 5.1 Trace 事件模型

`platform/trace/types.ts` 扩展（均向后兼容 JSONL 回放）：

| 类型 | 说明 |
|------|------|
| `tool_call` | + `streamed`、`chunkCount`、`diffSnippet` |
| `turn_end` | + `stalled`、`content_filter`、`empty` |
| `compaction` | 压缩摘要元数据 |
| `handoff` | 触顶交接 |
| `verify` | 验收结果 |

### 5.2 Task 状态与事件

`TaskState` 扩展字段：`handoff`、`subtasks`、`verifyReport`（已有）。

`TaskEventType` 扩展：`handoff`、`subtask`、`deliverable_canvas`。

### 5.3 消息与历史

`StoredMessage`：`synthetic`、`interrupted`、`compaction`。

合成消息用途：compaction 摘要、子任务回投 `<subtask>`、plan reminder（经 prompt 注入）。

### 5.4 配置入口（摘录）

```typescript
// config/constants.ts — RagIndexingConfig
chunkStrategy?: 'char' | 'ast';
useWorker?: boolean;      // 默认 true
useMerkle?: boolean;      // 默认 true

// compaction、planGate、doomLoop 等见 cottageConfig.platform / rag
```

---

## 6. 数据落盘（任务 + 索引）

```
.cottage/
├── tasks/{taskId}/
│   ├── spec.json
│   ├── state.json          # status, turnCount, handoff, subtasks, …
│   ├── plan.json
│   ├── manifest.json       # 文件路径交付清单
│   ├── canvas.json         # 结构化 canvas 交付物
│   ├── verify.json
│   ├── events.jsonl
│   └── deliverable.zip
└── index/
    ├── manifest.json
    ├── files.json
    ├── chunks.json
    ├── merkle.json
    └── vectors/{chunkId}.bin   # per-chunk
```

---

## 7. 里程碑与交付状态

| 里程碑 | 范围 | 状态 |
|--------|------|------|
| **M1** 完成率硬底线 | A1–A3 | ✅ |
| **M2** 长任务续命 | A4–A5, B1 | ✅ |
| **M3** 检索质量 | B2–B3 | ✅ |
| **M4** 稳健性收尾 | A7–A8, B4–B5 | ✅ |
| **M5** 并行与演进 | A6, B6 | ✅ |

---

## 8. 已知取舍与后续演进

| 项 | 取舍 | 后续可选 |
|----|------|----------|
| Compaction | 摘要可能丢细节 | 调摘要模型；trace 回放诊断 |
| 子任务 | 主 UI 仍单 active chat；子会话不挂载 Tab | 子任务对话预览 |
| AST 切块 | 仅 TS/JSX/Vue adapter | 新 adapter 注册即可扩展 |
| 流式工具 | 仅 runScript、fetchWebPage | webSearch、local-agent bash（若有） |
| Canvas | table / todo / markdown | chart、diff-view、与 verify 联动 |
| Merkle | 依赖 files.json 中 hash 一致 | mtime 快路径（未做） |

---

## 9. 与平台红线的相容性

| 红线 | 结论 |
|------|------|
| 浏览器 + FSA | ✅ Worker + DirectoryHandle 传参 |
| 本地 `.cottage/` | ✅ 任务、索引、向量、Merkle 均本地 |
| 通用 domain | ✅ B2 仅在 coding pack；核心无领域硬编码 |
| LangChain.js | ✅ 工具仍用 `tool()` + zod schema |
| 参考代码合规 | ✅ opencode 只读研究，实现均为本项目原创 |

---

*文档状态：已交付（2026-07-04）。维护时请同步更新 §2.3 文件索引与 §6 落盘结构。*
