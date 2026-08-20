# Open Cottage 架构与实现文档

本文档描述 **Open Cottage（本仓库）** 的当前架构与实现，便于贡献者理解代码组织，也便于用其他技术栈重新实现同等能力。

> 实现栈以 `frontend/package.json` 与本文为准。设计思想与路线图见 [docs/platform-vision-and-roadmap.md](../docs/platform-vision-and-roadmap.md)。

---

## 1. 产品定位

Open Cottage 是一个 **基于本地文件夹的 Agent 工作平台**：

- 用户通过浏览器 **File System Access API** 选定一个本地目录作为「工作空间」。
- Agent 在该目录内读写文件、执行脚本、联网搜索、生成/改造文档与代码，完成用户或「任务编排层」下发的目标。
- 所有项目数据（对话历史、任务状态、配置、索引、trace）保存在工作空间内的 **`.cottage/`** 隐藏目录，与工作区文件一起可备份、可迁移。

**两种使用模式：**

| 模式 | 说明 |
|------|------|
| **对话模式（chat）** | 用户手动发消息，Agent 按需调用工具；多会话、可切换历史。 |
| **任务模式（task）** | 用户定义目标与验收条件后，由 **TaskRunner** 自动多轮驱动 Agent，直至完成、失败、暂停或取消。 |

**设计原则（不可妥协）：**

- 浏览器为第一层容器：交互、编排、策略、验收在浏览器内完成。
- 数据本地优先：工作区、历史、索引、trace 落在 `.cottage/`。
- 语义化能力：默认暴露人话 API，不暴露 shell 别名。
- 先计划后执行：破坏性 / 外部调用前产出可校验计划，受预算约束。
- 可验证交付：任务结束有结构化 verdict，不只靠模型自述。
- 领域可插拔：编程、办公、数据分析是 Domain Pack，共享平台核心。

---

## 2. 技术栈

| 层级 | 选型 |
|------|------|
| 构建 | Vite 6 + TypeScript 5.8 |
| UI | Vue 3.5 + Element Plus 2.11 |
| 状态管理 | Pinia 3 |
| 富文本编辑 | TipTap 3（对话输入框） |
| 代码编辑 | Monaco Editor |
| Agent 运行时 | AI SDK Core 7（`ai`、`@ai-sdk/openai`、`@ai-sdk/openai-compatible`、`@ai-sdk/anthropic`、`@ai-sdk/google`）+ Cottage Agent Runtime |
| 结构化校验 | Zod + zod-to-json-schema |
| Markdown | markdown-it + markdown-it-multimd-table |
| Office | docx / pptxgenjs / mammoth / xlsx |
| 本地存储 | File System Access API + IndexedDB（目录句柄与密钥）+ localStorage（最近目录元数据） |
| 脚本沙箱 | Web Worker + `new Function` 执行用户/Agent 脚本 |
| 数据分析 | Pyodide（WASM Python，受 `python.enabled` 门控） |
| 本地向量 | `@huggingface/transformers`（嵌入式 RAG） |
| Git 工作区 | isomorphic-git |
| 包管理 | pnpm（frontend） / Go（Cottage Service） |

**开发环境要求：**

- HTTPS（`@vitejs/plugin-basic-ssl`），默认 `https://localhost:5176`
- 支持 `showDirectoryPicker` 的 Chromium 系浏览器

**环境变量（见 `.env.example`）：**

- 模型服务在设置中逐项配置 Base URL、模型和 API Key；对于无需鉴权的自定义 OpenAI 兼容 API，Key 可留空。

---

## 3. 系统架构总览

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Vue UI (三栏 + Header)                            │
│  FileBrowser │ Preview │ ChatPanel (对话 / 任务 Segmented)               │
└─────────────────────────────────────────────────────────────────────────┘
         │                    │                         │
         ▼                    ▼                         ▼
┌─────────────────┐  ┌──────────────────────┐  ┌──────────────────────────┐
│ WorkspaceStore  │  │  AgentStore          │  │  TaskStore               │
│ FileSystemWS    │  │  createCottageAgent  │  │  TaskRunner + persistence│
└─────────────────┘  └────────┬─────────────┘  └─────────────┬────────────┘
         │                     │                              │
         │                     ▼                              │
         │         ┌──────────────────────────────┐           │
         │         │ CottageAgent (AI SDK Core)     │           │
         │         │  system prompt + pack overlay│           │
         │         │  tool loop + PolicyGate      │           │
         │         │             + PlanGate       │           │
         │         └──────────────┬───────────────┘           │
         │                        │                           │
         ▼                        ▼                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Platform Core                                                          │
│  Capability Registry · Policy Engine · Capability Pack · Plan Gate      │
└─────────────────────────────────────────────────────────────────────────┘
         │ 注册                          │ 注册                    │ 注册
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐
│ Coding Pack  │ │ Office Pack  │ │ DataAnalysis │ │  外部 Pack / MCP      │
│ 符号/AST/影响│ │ docx/pptx/xlsx│ │ Pyodide      │ │  .cottage/packs/{id} │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Native Tools（浏览器内实现）                                            │
│  fileTools · webTools · taskTools · runScript(Worker) · askUser          │
│  officeRead/Write · coding(query/ast) · rag · history · mcp              │
└─────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  用户选定的本地目录 + .cottage/ 元数据                                    │
│  IndexedDB: FileSystemDirectoryHandle 持久化 + ProviderSecrets           │
└─────────────────────────────────────────────────────────────────────────┘
         │ (联网)
         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  LLM 厂商公开 API（OpenAI / Anthropic / Google / DeepSeek / Moonshot …）  │
│  可选：Cottage Service（网页搜索、浏览器自动化等本地能力）                 │
└─────────────────────────────────────────────────────────────────────────┘
```

**关键边界：** Agent 始终住在浏览器这一层；下面的 Cottage Service / MCP 都是**为人设计好的能力接口**，而不是让 LLM 直接摸操作系统。

---

## 4. 目录结构与模块职责

```
frontend/src/
├── main.ts                       # 入口：Vue app 挂载、Element Plus、Pinia
├── App.vue                       # 布局壳
├── platform/                     # 平台核心（与任务类型无关）
│   ├── capabilities/             # Capability Registry：能力模型 + domain 分组
│   ├── policy/                   # Policy Engine：风险分级 + 审批闸门
│   ├── packs/                    # Capability Pack：内置 builtins/ + 外部包安装/校验/加载
│   │   └── builtins/             #   office / coding / dataAnalysis / base
│   └── plan/                     # Plan Gate：submitExecutionPlan + 预算闸门
├── content/                      # 统一内容层：ContentRef + 结构化存储 + Office 抽取
├── domains/                      # 领域包实现
│   ├── coding/                   #   符号索引、引用查询、影响分析、AST 编辑
│   │   └── ast/                  #   AST 操作 + tsAdapter / jsxAdapter + diff
│   └── office/                   #   docx/pptx 模板、批量生成
├── agent/                        # Agent 组装与工具
│   ├── createCottageAgent.ts     #   base 工具 + 能力包装配 + policyGate + planGate
│   ├── CottageAgent.ts           #   工具循环，执行前挂 policy/plan hook
│   ├── constants.ts              #   base prompt + 能力包 overlay
│   ├── cottageTools.ts         #   文件/Web/任务基础工具
│   ├── officeReadCottageTools.ts / officeWriteCottageTools.ts
│   ├── codingCottageTools.ts   #   编码工具（委托 domains/coding）
│   ├── pythonCottageTool.ts    #   Pyodide
│   ├── runPython.ts / pyodide.worker.ts
│   ├── scriptWorkerHost.ts / script.worker.ts   # runScript 沙箱
│   ├── patchFile.ts / parsePatchArgs.ts
│   ├── webSearch.ts / browserFetch.ts
│   ├── askUserTool.ts            #   人机确认
│   ├── toolCatalog.ts            #   包级 capability 分组
│   └── workspaceSkills.ts        #   工作空间 SKILLS 注入
├── orchestrator/                 # 编排层：Planner + Sub-agent
├── task/                         # TaskRunner + verify + 持久化
├── rag/                          # 向量索引 + 检索 + Office 抽取
├── history/                      # 历史 checkpoint + fsaGitAdapter
├── mcp/                          # MCP 接入与工具适配
├── workspace/                    # FileSystemWorkspace、搜索、持久化
├── config/                       # CottageConfig、llmProviders、secrets、chatSessions
├── chat/                         # 对话组合、附件、引用解析
├── stores/                       # Pinia stores（workspace/agent/task/preview/...）
└── components/                   # FileBrowser / Preview / Chat / Task / Settings / Skills
```

> 设计思想与路线图见 [docs/platform-vision-and-roadmap.md](../docs/platform-vision-and-roadmap.md)。

---

## 5. 工作空间（Workspace）

### 5.1 打开与恢复

1. **首次打开**：`window.showDirectoryPicker({ mode: 'readwrite' })` → `FileSystemWorkspace.attachDirectory`。
2. **记住目录**：`FileSystemDirectoryHandle` 存入 **IndexedDB**，并在 **localStorage** 维护最近目录元数据。
3. **启动恢复**：读取上次工作区 id → 从 IndexedDB 取 handle → `requestPermission('readwrite')`。

若用户拒绝授权或 handle 失效，保持未打开状态，显示欢迎页。

### 5.2 路径约定

- 工具与 UI 使用**相对工作空间根目录**的路径，正斜杠 `/`，例如 `src/foo.ts`。
- `normalizePath`：去首尾斜杠、合并 `..`、统一分隔符。
- 遍历文件时跳过以 `.` 开头的名字；`.cottage/` 通过专用 API 访问。

### 5.3 预览

按扩展名返回：`text` / `markdown` / `html` / `image` / `video` / Office（Word、PPT、表格）等。可编辑类型保存走 `writeFile`。

---

## 6. `.cottage` 数据模型

工作空间根下自动创建 `.cottage/`：

```
.cottage/
├── config.json              # CottageConfig：提供商、模型、temperature 等
├── chats-index.json         # { activeId, sessions[] }
├── chat-{uuid}.json         # 单会话历史
├── tasks-index.json         # { activeId, tasks[] }
├── tasks/{taskId}/
│   ├── spec.json            # TaskSpec
│   ├── state.json           # TaskState
│   ├── plan.json            # TaskPlan
│   ├── manifest.json        # 交付清单
│   ├── deliverable.zip      # 完成后压缩交付物
│   └── events.jsonl         # 事件流
├── packs/{id}/              # 外部能力包安装目录
├── rag/                     # 向量索引
├── trace/{sessionId}/       # 链路追踪（规划中）
└── memory/                  # 跨会话偏好与事实（规划中）
```

**刷新恢复**：所有 `running` 状态的任务在重启时改为 `paused`，避免误以为仍在执行。

---

## 7. Platform Core

### 7.1 Capability Registry

统一描述「平台能做什么」，供 Agent 组装、Planner 选型、Policy 判定、Settings UI 展示。`BUILTIN_CAPABILITIES` 集中声明，`resetCapabilityRegistry()` 在能力包启停时热重置。

```typescript
interface Capability {
  id: string;                    // 'core.file.read', 'office.document.write'
  domain: 'core' | 'coding' | 'office' | 'media' | 'integration';
  tools: string[];
  inputTypes: ContentType[];
  outputTypes: ContentType[];
  riskLevel: 'read' | 'write' | 'external' | 'destructive';
  requiresApproval?: boolean;
  plannerHints?: string;
}
```

实现：`platform/capabilities/`。

### 7.2 Capability Pack

把「开发一个领域 Agent」的产物——**工具 + 提示词 + 技能 + 能力声明 + MCP 配置**——打包为可启停的能力包。

- **基础能力（始终可用）**：文件系统读写、Web 搜索/抓取、`runScript`、`askUser`，在 `createCottageAgent` 中固定装配。
- **内置包**（`platform/packs/builtins/`）：办公、编程、数据分析，由聊天框开关控制，启用后注入该包工具与 prompt overlay。
- **外部包**（`platform/packs/`）：通过 `manifest.json` 安装到 `.cottage/packs/{id}/`，经 `validate.ts` 校验后并入 Registry 与 prompt。

```typescript
interface BuiltinCapabilityPack {
  id: string; name: string; domain: CapabilityDomain;
  groupId: OptionalToolGroupId;        // 对应聊天框开关分组
  toolNames: readonly string[];
  capabilityIds: readonly string[];
  promptOverlay: string;               // 启用后注入 system prompt
  riskLevel: CapabilityRiskLevel;
  intentKeywords: readonly string[];   // 意图识别建议
  createTools: (ctx) => CottageTool[];
}
```

### 7.3 Policy Engine

在**工具调用前**强制执行。基于能力风险级别 + 治理配置：

- `evaluateToolPolicy(toolName)`：查 Registry 取关联能力的最高 riskLevel；命中 `requiresApproval` 或治理配置 `requireApprovalFor` 则返回 `confirm`，否则 `allow`。
- `createPolicyGate({ requireApprovalFor })`：组装闸门；无需审批时返回 `null`（零开销）。
- `CottageAgent` 在每次 `tool.invoke()` 前调用闸门：`confirm` 时挂起并渲染「允许 / 拒绝」按钮，拒绝则把「被策略阻止」结果回传模型。
- 默认 `governance.requireApprovalFor = ['destructive']`。

```typescript
type PolicyDecision =
  | { action: 'allow' }
  | { action: 'deny'; reason: string }
  | { action: 'confirm'; message: string; riskLevel: CapabilityRiskLevel };
```

实现：`platform/policy/`。

### 7.4 Plan Gate

在首批 write / external / destructive 工具前，强制 Agent 调用 `submitExecutionPlan` 提交可校验计划，并按预算约束执行：

```typescript
interface ExecutionPlan {
  goal: string;
  domain?: string;
  items: Array<{ requirement: string; actions?: string[]; confidence?: number }>;
  budget?: { maxFiles?: number; maxApiCalls?: number; maxTurns?: number };
}
```

- 聊天模式默认启用（任务模式仍用 `taskSetPlan`）。
- 只读工具无需先提交计划。
- 超预算时阻止工具执行，原因回传模型。
- 配置：`platform.planGate`；实现：`platform/plan/`。

---

## 8. Agent 集成

### 8.1 模型创建

`createChatModel` 按所选 provider 显式创建 AI SDK direct provider instance，并统一返回框架无关的 `CottageModelDriver`。API Key 从 `config/secrets`（IndexedDB）读取，请求可经 Cottage Service HTTP 代理转发；运行时不使用 AI Gateway。

### 8.2 创建 Agent

`createCottageAgent` 装配：

1. base 工具（文件 / Web / 任务 / `askUser` / `runScript` / history / rag / mcp / orchestrator）
2. 已启用能力包的工具与 prompt overlay
3. `policyGate`（工具执行前风险闸门）
4. `planGate`（首批写操作前计划闸门）
5. system prompt = base + 能力目录 + 包 overlay + workspace skills

**模式差异：**

| | chat | task |
|---|------|------|
| system prompt | `buildCottageSystemPrompt` | `buildCottageTaskSystemPrompt` |
| 额外工具 | file + web | file + web + task |
| Plan Gate | 默认启用 | 用 `taskSetPlan` |

### 8.3 工具循环

`CottageAgent` 每轮：

1. 调用模型获取 `tool_calls`。
2. 对每个工具：`policyGate.evaluate` → `planGate.check` → `tool.invoke`。
3. `confirm` 时挂起等待用户审批；`deny` 时把拒绝原因回传模型。
4. 结果回灌模型，直到无 `tool_calls`。

### 8.4 Native Tools 清单

| 分类 | 工具 |
|------|------|
| 文件 | `listFiles` / `readFile` / `writeFile` / `createFile` / `patchFile` / `deleteFile` / `deleteEntry` / `deletePaths` / `mkdir` / `rename` / `compress` / `extract` |
| 脚本 | `runScript`（Web Worker） |
| Web | `webSearch` / `fetchWebPage` |
| 任务 | `taskSetPlan` / `taskComplete` / `taskFail` / `submitExecutionPlan` |
| Office 读 | Word / PPT / 表格抽取 |
| Office 写 | `writeWord` / `writePresentation` / 表格写入 / 模板渲染 / 批量生成 |
| Coding | 符号定义/引用查询 / `analyzeImpact` / AST 编辑（import / props / 类型 / 调用点） |
| 数据分析 | `runPython`（Pyodide） |
| 人机 | `askUser` |
| 检索 | RAG 检索 / 文件名检索 |
| 历史 | history checkpoint |
| 编排 | `startOrchestration`（触发 sub-agent） |

### 8.5 patchFile 语义

应用顺序：**lines → columns → regex**。行编辑按**行号从大到小**应用，避免行号漂移。

- **行**：1-based；`action`: `replace` | `delete` | `insert_before` | `insert_after`。
- **列**：1-based 含首含尾，单行内替换。
- **正则**：`pattern` / `replacement` / `flags`（默认 g） / `maxReplacements`。

保留原文件换行风格与末尾换行。

### 8.6 runScript 架构

```
主线程 runScriptInWorker(code)
  → Worker: new Function('api', 'return (async () => { code })()')
  → api.* 通过 postMessage RPC 回主线程
  → 主线程调用 workspace.* 实际读写磁盘
```

Worker 内禁止直接访问 DOM / 主线程变量；所有 IO 经 RPC。脚本应 `return` 可 JSON 序列化对象。验收脚本约定：`return { ok: true }` 表示通过。

---

## 9. 任务编排（TaskRunner）

### 9.1 状态机

```
draft ──start──► running ◄──resume── paused
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
   completed     failed     cancelled
```

### 9.2 主循环

1. `mountTaskSession(chatSessionId, taskId)`：同一 Chat 实例切到 task 模式。
2. `while (status === 'running')`：检查 cancel / pause / fail / complete；超 `maxTurns` 则 fail；`buildTaskPrompt` → `chat.next`；持久化 + 写 `events.jsonl`。
3. **完成路径**：Agent 调用 `taskComplete` → `verifyAcceptance`（检查验收文件、交付清单、可选脚本）→ 通过则 `compress` 交付物并 `completed`，失败则带 `verifyError` 再发一轮。

### 9.3 控制信号

| 机制 | 用途 |
|------|------|
| `TaskRunControl` | `pauseRequested` / `cancelRequested`；`abort()` |
| `TaskSignalState` | Agent tool 触发的 complete / fail |
| `shouldStop()` | 轮询打断 `waitUntilChatIdle` |

---

## 10. RAG 与历史

- **RAG**（`rag/`）：嵌入式向量索引（`@huggingface/transformers`），支持文本与 Office 抽取，按工作空间构建。
- **历史**（`history/`）：对话 checkpoint，`fsaGitAdapter` 基于 isomorphic-git 提供工作区快照与回滚能力。

---

## 11. MCP 与扩展

- **MCP**（`mcp/`）：注册 MCP server，把动态工具适配为 `CottageTool`，并入 Policy 与 Plan 闸门；AI SDK 仅接收工具 schema，不执行本地工具。
- **Skills**（`agent/workspaceSkills.ts`）：扫描工作空间 `SKILLS/` 目录，注入到 system prompt。
- **外部 Pack**：`manifest.json` 可携带 `mcpServers`，随包启用。

---

## 12. 安全与限制

| topic | 说明 |
|--------|------|
| 脚本执行 | Worker + Function，同源主线程 RPC；**非强隔离**，恶意脚本可耗尽资源，仅适合受信 Agent 生成代码 |
| 文件访问 | 仅限用户授权目录；无法读工作区外路径 |
| API Key | 仅存浏览器 IndexedDB（`open-cottage-secrets`），不上传 |
| Policy | 破坏性操作默认需用户审批；可配置 `requireApprovalFor` |
| Plan Gate | 首批写/外部调用前必须提交计划，超预算阻止 |
| HTTPS | File System Access API 要求安全上下文 |
| CORS | 浏览器直连抓网页常失败，可经 Cottage Service 聚合 |
| 并发任务 | 全局仅允许一个 `runningTaskId` |

详见仓库根 [SECURITY.md](../SECURITY.md)。

---

## 13. 用其他技术栈复现的检查清单

### 13.1 必须实现

- [ ] 用户选择/持久化单一工作目录（Web 用 FSA + IndexedDB；桌面用对话框 + 本地 DB）。
- [ ] `.cottage/` 元数据布局与 JSON 结构。
- [ ] AI SDK Core（或等价）Chat + 工具调用循环。
- [ ] 全部 native tools 及 patch 语义。
- [ ] 多会话索引与历史。
- [ ] TaskRunner 多轮编排、验收、deliverable zip。
- [ ] runScript 沙箱（语言可换，需暴露相同文件 API）。
- [ ] Platform Core：Capability Registry / Policy / Pack / Plan Gate。

### 13.2 可替换方案

| 当前 | 替代思路 |
|------|----------|
| Vue 3 + Element Plus | 任意 UI 框架 |
| AI SDK Core provider/stream adapter | Cottage Agent 循环 + 工具治理与调度器 |
| Browser Worker 脚本 | 子进程（Electron）、WASM、服务端 sandbox |
| File System Access API | Electron `fs`、Tauri、服务端 git workspace |
| IndexedDB 句柄持久化 | 桌面端路径字符串 |

---

## 14. 关键常量速查

```typescript
DEFAULT_MAX_TURNS = 30
MAX_CHAT_SESSIONS = 50
MAX_RECENT_WORKSPACES = 8
DEFAULT_GOVERNANCE_REQUIRE_APPROVAL_FOR = ['destructive']
```

---

## 15. 参考文件索引

| 主题 | 源文件 |
|------|--------|
| Agent 组装 | `src/agent/createCottageAgent.ts` |
| 工具循环 | `src/agent/CottageAgent.ts` |
| 基础工具 | `src/agent/cottageTools.ts` |
| 系统提示词 | `src/agent/constants.ts` |
| Capability Registry | `src/platform/capabilities/` |
| Policy Engine | `src/platform/policy/` |
| Capability Pack | `src/platform/packs/` |
| Plan Gate | `src/platform/plan/` |
| Coding Pack | `src/domains/coding/`、`src/domains/coding/codingCottageTools.ts` |
| Office Pack | `src/domains/office/`、`src/agent/officeWriteCottageTools.ts` |
| 任务循环 | `src/task/TaskRunner.ts` |
| 验收 | `src/task/verify.ts` |
| 文件系统 | `src/workspace/` |
| MCP 适配 | `src/mcp/` |
| 设计白皮书 | `docs/platform-vision-and-roadmap.md` |

---

*文档版本：v4 · 2026-08 · 对齐 Vue 3 + AI SDK Core + Cottage Agent Runtime + Platform Core/Pack 实现。*
