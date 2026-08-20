# Cottage 平台愿景与路线图

> 本文档汇总 Cottage 作为**通用 Agent 平台**的指导思想、架构定位与历史迭代路线。
> 它回答三个问题：**我们为什么做这件事**、**我们和其他 Agent 有何不同**、**接下来按什么顺序建设**。
>
> **维护说明（2026-08）**：本文的能力盘点和阶段进度以 2026-06 为基线，仅作设计与决策背景；当前实现以 [`frontend/ARCHITECTURE.md`](../frontend/ARCHITECTURE.md)、`doc-site/` 及代码为准。隐藏能力的产品状态见 [`hidden-features.md`](./hidden-features.md)。
>
> 相关文档：
>
> - [本地历史 + RAG 演进计划（归档）](./archive/plan-local-history-and-rag.md)
> - [Coding Pack 增强进度](./coding-pack-progress.md)（符号索引 / 影响分析 / AST 编辑 / 编码工作流纪律）
> - [`frontend/ARCHITECTURE.md`](../frontend/ARCHITECTURE.md)（当前实现概览）

---

## 1. North Star：平台的目的

与「把卫星送上天」这类**单一、可庆祝的物理终点**不同，通用 Agent 平台的目标是**持续存在的运载能力**——不是完成某一件具体事，而是让用户能**反复、可靠地**把意图变成结果。

### 1.1 一句话

> **在用户自己的环境里，把自然语言意图稳定地变成可验证的结果。**

英文收束：**Trustworthy work completion in your own environment.**

### 1.2 四个可检验命题


| 命题        | 含义                                 |
| --------- | ---------------------------------- |
| **自己的环境** | 本地文件夹、Office 文档、表格、多媒体、API——不是只能聊天 |
| **真实工作**  | 交付物是文件、报告、数据、配置变更——不是只有对话摘要        |
| **可核对**   | 有 DoD、有 diff、有交付清单——不是「模型说完成了」     |
| **可回放**   | 出错能定位到检索 / 计划 / 工具 / 验证哪一步——可持续优化  |


### 1.3 与 Cursor 等产品的差异


| 维度       | Cursor 等代码助手 | Cottage                     |
| -------- | ------------ | --------------------------- |
| 主战场      | 代码仓库         | **任意本地工作区**（文档、表格、媒体、脚本、集成） |
| 核心承诺     | 改对代码         | **做完工作且可证明做完了**             |
| 信任模型     | IDE 内嵌       | **数据在本地、过程可审计、权限在用户**       |
| Agent 载体 | 桌面 IDE       | **浏览器作为第一层容器**（见 §2）        |


「通用」不等于「无边界」。Cottage 的边界是：**任务类型可以多样，但「完成 + 验证 + 本地控制」这三件事不可妥协。**

---

## 2. 指导思想

### 2.1 Agent 是容器，LLM 是大脑

Agent 是 LLM 的**躯体**，能力上限不先天固定，而取决于注册了哪些工具与服务。但躯体的设计目标不是让大脑踩油门更爽，而是让人**好开、好看、好信任**。

```
人
 ↓  舒适、可理解、可核对、可审批
Agent 容器（浏览器里的 Cottage）
 ↓  结构化能力、策略、交付物、编排
本地 / 远程服务（可选的第二层能力平面）
 ↓  专业执行、重计算、系统权限
原始工具（shell、裸 IO、regex patch）  ← 默认不让 LLM 直接碰
```

### 2.2 方便人，而不是方便 LLM

部分 Agent 把 shell、写代码、跑脚本当作「万能工具」——这确实展现了可能性，但本质是把**执行环境的不确定性**和**失败的可解释性**甩给了模型和用户。这是一种偷懒的扩展方式。


| 维度   | 方便 LLM（应避免为默认）           | 方便人（Cottage 默认）                            |
| ---- | ------------------------ | ------------------------------------------ |
| 工具粒度 | `runShell("ffmpeg ...")` | `convertVideo({ from, to, quality })` + 预览 |
| 失败形态 | stderr 一坨                | 结构化错误 + 建议下一步                              |
| 结果   | 「我执行完了」                  | 交付物清单 + diff + 可回滚                         |
| 权限   | 模型自行 chmod / curl        | Policy 审批 + 能力白名单                          |
| 扩展   | 再注册 20 个原始工具             | 注册 1 个服务连接器，服务内封装操作目录                      |


**方便 LLM**：工具少、通用、让模型自己拼。  
**方便人**：工具语义化、可预览、可验收，人不必懂模型怎么拼的。

### 2.3 浏览器是第一层容器，不是上限

选择浏览器，不是因为它能力最强，而是因为它是 **Agent 与人的主界面和控制平面**：

- 有 UI：预览、diff、文件选择、确认框、历史回放
- 有沙箱：FSA、Worker、可控权限
- 有扩展路径：MCP、Companion Service、云端 Connector

完整能力栈：

```
Browser Cottage（控制平面 + 人机界面）
    ↔  Local Companion（能力平面：ffmpeg、git、大文件、系统 API）
    ↔  Cloud Connectors（集成平面：飞书、Notion、企业 API）
    ↔  MCP Servers（插件平面：领域能力包）
```

Agent **始终住在浏览器这层容器里**；下面各层是**为人设计好的能力接口**，而不是让 LLM 直接摸操作系统。

这与「在本地服务里跑 Agent，顺便开个 Web UI」相反：

- 后者：执行中心在本地，人是旁观者
- 前者：**交互与信任中心在浏览器**，本地服务是无头能力提供者

### 2.4 原始工具的定位：逃生舱，不是高速公路

`runPython`、受控 script worker 可以存在，但是：

- **默认高速公路**：语义化工具 + 服务连接器 + Policy
- **应急小路**：明确授权后的脚本执行
- **禁区**：无审批的任意 shell、无预览的破坏性批量操作

### 2.5 不可妥协的设计原则


| 原则           | 含义                                      |
| ------------ | --------------------------------------- |
| **浏览器为第一容器** | Agent 交互、编排、策略、验收在浏览器内完成；不桌面化 Agent 本体  |
| **数据本地优先**   | 工作区、历史、索引、trace 落在 `.cottage/` 或用户控制的存储 |
| **语义化能力**    | 默认暴露人话 API，不暴露 shell 别名                 |
| **先计划后执行**   | 破坏性 / 外部调用前产出可校验计划，受文件与调用预算约束           |
| **可验证交付**    | 任务结束必须有结构化 verdict，不只靠模型自述              |
| **可配置降级**    | 策略在 `CottageConfig` 中声明，不在业务代码硬编码       |
| **领域可插拔**    | 编程、办公、多媒体、集成是 Domain Pack，共享平台核心        |


---

## 3. 架构定位：Platform Core + Domain Packs

Cottage 不应是「加强版 Cursor」，而是 **Platform Core + 可插拔 Domain Pack**。

```
┌─────────────────────────────────────────────────────────┐
│  Platform Core（与任务类型无关）                          │
│  Capability Registry · Policy Engine · Context Builder  │
│  Plan Gate · DoD Verifier · Trace/Replay                │
│  Connector Hub · Artifact / Deliverable Pipeline        │
└─────────────────────────────────────────────────────────┘
         ↑ 注册                              ↑ 注册
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ Coding Pack  │ │ Office Pack  │ │ Media Pack   │ │ Integration  │
│ 符号索引/AST │ │ 文档结构化   │ │ OCR/转码     │ │ REST/OAuth   │
│ 架构规则     │ │ 模板生成     │ │ 视觉理解     │ │ MCP 增强     │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
```

原先讨论的「8 类工程化中间层」在此重新归类：


| 能力           | 平台通用            | Coding 专用    |
| ------------ | --------------- | ------------ |
| 代码语义索引       | —               | ✅            |
| 变更规划器        | ✅ Plan Gate     | 文件打分与影响分析    |
| AST 级编辑器     | —               | ✅            |
| 架构规则引擎       | ✅ Policy Engine | 规则集          |
| 结果判定（DoD）    | ✅               | 各 Pack 的检查模板 |
| 上下文打包器       | ✅               | 各 Pack 的打包策略 |
| 工具可靠性（MCP 等） | ✅               | —            |
| 可观测与回放       | ✅               | —            |


---

## 4. 当前基线与关键缺口

### 4.1 已有能力（2026-06 基线）

平台已从「工具散落」演进到 **Platform Core + Capability Pack** 的雏形：能力被显式建模、按基础/领域分层、策略可执行、领域包可装配。


| 层级    | 模块                                       | 路径                                                  |
| ----- | ---------------------------------------- | --------------------------------------------------- |
| 平台核心  | **Capability Registry**（能力模型 + domain 分组，可重置）  | `platform/capabilities/`                            |
| 平台核心  | **Policy Engine**（风险分级 + 审批闸门 + 治理配置）         | `platform/policy/`                                  |
| 平台核心  | **Capability Pack**（内置包 + 外部包安装/加载/校验）        | `platform/packs/`、`platform/packs/builtins/`        |
| 内容层   | **Content Model**（ContentRef、结构化存储、Office 抽取） | `content/`                                           |
| 工具层（基础） | 文件读写、patch、搜索、压缩解压、runScript、Web 搜索/抓取、askUser | `agent/cottageTools.ts`、`agent/webSearch.ts`      |
| 领域包   | 办公：表格读写、Word/PPT 读 **+ 写**、模板渲染、批量生成        | `agent/officeWriteCottageTools.ts`、`domains/office/` |
| 领域包   | 编程：符号定义/引用查询、改前影响分析、编码工作流纪律（TS/Vue 解析、索引）        | `domains/coding/`、`platform/packs/builtins/coding.ts`  |
| 领域包   | 数据分析：Pyodide Python（受 `python.enabled` 门控）  | `agent/pythonCottageTool.ts`                      |
| 提示词层  | 基础 prompt + 能力包 overlay（按启用动态注入）            | `agent/constants.ts`                                |
| 编排层   | Planner + Orchestrator + Sub-agent（继承包/策略） | `orchestrator/*`                                    |
| 检索层   | 文本检索、文件名检索、向量 RAG                          | `workspace/runWorkspaceSearch.ts`、`rag/retrieve.ts` |
| 扩展    | MCP、Skills（含包内 skills）、History checkpoint     | `mcp/*`、`agent/workspaceSkills.ts`、`history/*`      |
| 任务    | TaskRunner + 基础 verify                     | `task/*`                                            |
| 设置 UI | 能力包管理 + 内置包概览 + 治理（审批级别）配置                  | `components/Settings/CapabilityPacksTab.vue`        |


### 4.2 关键缺口

**已落地（原缺口 → 已补齐）**

- ✅ **Capability Registry** — 见 §5.1，`BUILTIN_CAPABILITIES` 统一建模、按 domain 分组、可热重置
- ✅ **Policy Engine** — 见 §5.3，工具调用前按 riskLevel + `requireApprovalFor` 放行/拒绝/弹审批
- ✅ **Content Model（基础）** — `ContentRef` + 结构化存储 + Office 抽取已就位
- ✅ **Office 写入** — Word/PPT 写入与 docx/pptx 模板引擎、批量生成
- ✅ **Coding 符号索引（基础）** — 符号定义/引用查询 + 改前影响分析（analyzeImpact）+ 编码工作流纪律 prompt overlay；尚无 AST 编辑
- ✅ **Generic DoD** — `platform/verify` 引擎：fileExists / contentContains / contentMatches / jsonField / manifestCoverage 五类结构化断言，输出 `{ verdict, checks[], uncovered[] }`，落 `.cottage/tasks/{id}/verify.json`

**平台层（仍待建）**

1. **Plan Gate** — Orchestrator 偏通用拆解，缺「先计划后修改」与预算约束
2. **Generic DoD** — verify 偏弱（文件存在 + 交付清单 + 可选 JS 脚本），缺需求覆盖矩阵与结构化断言 → ✅ 已抽离到 `platform/verify`，支持五类结构化断言与逐条结果
3. **Context Builder** — 缺按 token 预算的智能上下文调度
4. **Trace / Replay** — 缺全链路记录与失败回放 → ✅ 已落地 `platform/trace`：`.cottage/trace/{sessionId}/trace.jsonl` 记录工具调用（参数/结果/前后 diff/耗时/状态）、计划、验收、轮次起止；聊天面板有 trace 查看器
5. **Integration Pack** — 缺一等公民 HTTP / OAuth Connector（现仅 web 搜索/抓取）
6. **Deliverable Pipeline** — artifact 偏泛，缺面向用户的交付物模型与交付 UI

**Coding Pack（编程深度）**

1. AST 级编辑（替代纯文本 patch）
2. 前端代码改造专用打分器（影响分析已落地 analyzeImpact，专用打分待补）
3. 平台级 Coding DoD 引擎与架构规则引擎（当前以 prompt overlay 形式落地，未进入 platform/verify 与 platform/policy）

**Office / Media Pack**

1. PDF 结构化处理
2. 多媒体工具链（OCR、ASR、转码——经 Companion 或 MCP）

---

## 5. 平台核心能力说明

### 5.1 Capability Registry（已实现）

统一描述「平台能做什么」，供 Agent 组装、Planner 选型、Policy 判定、Settings UI 展示。`BUILTIN_CAPABILITIES` 集中声明，`resetCapabilityRegistry()` 可在能力包启停时热重置，把内置能力与包能力合并。

```typescript
interface Capability {
  id: string;                    // 'core.file.read', 'office.document.write', 'data.python'
  domain: 'core' | 'coding' | 'office' | 'media' | 'integration';
  tools: string[];
  inputTypes: ContentType[];
  outputTypes: ContentType[];
  riskLevel: 'read' | 'write' | 'external' | 'destructive';
  requiresApproval?: boolean;
  plannerHints?: string;
}
```

实现位置：`platform/capabilities/`（`builtins.ts` 声明、`registry.ts` 查询/重置）。

### 5.1.1 Capability Pack（已实现）

把「开发一个领域 Agent」的产物——**工具 + 提示词 + 技能 + 能力声明 + MCP 配置**——打包为可启停的能力包，是当前架构落地的核心抽象。

- **基础能力（始终可用）**：文件系统读写/管理、Web 搜索/抓取、`runScript`、`askUser`。在 `createCottageAgent` 中固定装配，不可关闭。
- **领域能力包（按需启用）**：
  - **内置包**（`platform/packs/builtins/`）：办公文档（office）、代码改造（coding，含符号索引、改前影响分析与编码工作流纪律）、数据分析（python）。由聊天框「模型与能力」面板开关，启用后注入该包的工具与领域 prompt overlay，并据关键词支持意图识别建议。
  - **外部包**（`platform/packs/`）：通过 `manifest.json` 安装到 `.cottage/packs/{id}/`，可携带 `capabilities`、`promptOverlay`、`skills`、`mcpServers`、`suggestedTools`，经 `validate.ts` 校验后并入 Registry 与 prompt。

```typescript
interface BuiltinCapabilityPack {
  id: string; name: string; domain: CapabilityDomain;
  groupId: OptionalToolGroupId;        // 对应聊天框开关分组
  toolNames: readonly string[];
  capabilityIds: readonly string[];
  promptOverlay: string;               // 启用后注入 system prompt
  riskLevel: CapabilityRiskLevel;
  intentKeywords: readonly string[];   // 意图识别建议
  createTools: (ctx) => StructuredToolInterface[];
}
```

实现位置：`platform/packs/`（loader / install / resolve / validate / paths）+ `platform/packs/builtins/`。

### 5.2 Content Model（基础已实现）

办公与多媒体任务的中间层，连接 RAG、预览、工具与验收。`ContentRef`、结构化存储与 Office 抽取已落地（`content/`），PDF / 媒体抽取待补。

```typescript
interface ContentRef {
  path: string;
  mime: string;
  type: ContentType;
  structure?: 'plain' | 'document' | 'spreadsheet' | 'slides' | 'pdf' | 'media';
  extractedTextPath?: string;    // .cottage/extract/{hash}.txt
  structuredPath?: string;       // .cottage/structured/{hash}.json
}
```

### 5.3 Policy Engine（已实现 MVP）

可执行策略，在**工具调用前**强制执行。当前实现基于能力风险级别 + 治理配置：

- `evaluateToolPolicy(toolName)`：查 Registry 取该工具关联能力的最高 riskLevel；若命中 `requiresApproval` 或治理配置 `requireApprovalFor`，则返回 `confirm`，否则 `allow`。
- `createPolicyGate({ requireApprovalFor })`：组装闸门；无需审批时返回 `null`（零开销）。
- `CottageAgent` 在每次 `tool.invoke()` 前调用闸门：`confirm` 时挂起并在对话中渲染「允许 / 拒绝」按钮（复用 pending 单例，类似 `askUser`），拒绝则把「被策略阻止」结果回传给模型而非真正执行。
- 默认 `governance.requireApprovalFor = ['destructive']`（删除等破坏性操作需确认），可在设置页调整。

```typescript
type PolicyDecision =
  | { action: 'allow' }
  | { action: 'deny'; reason: string }
  | { action: 'confirm'; message: string; riskLevel: CapabilityRiskLevel };
```

实现位置：`platform/policy/`（policyEngine / createPolicyGate / approvalGate）。

**后续演进**：从「风险级别驱动」扩展到「细粒度规则」（按 path / connector / domain 匹配、白名单域名、dryRunOnly），形如：

```typescript
interface PolicyRule {
  id: string;
  scope: 'tool' | 'path' | 'connector' | 'domain';
  when: PolicyCondition;
  action: 'allow' | 'deny' | 'requireApproval' | 'dryRunOnly';
}
```

### 5.4 Plan Gate（已实现 MVP）

在首批 write / external / destructive 工具前，强制 Agent 调用 `submitExecutionPlan` 提交可校验计划，并按预算约束执行：

```typescript
interface ExecutionPlan {
  goal: string;
  domain?: string;
  items: Array<{
    requirement: string;
    actions?: string[];
    confidence?: number;
  }>;
  budget?: { maxFiles?: number; maxApiCalls?: number; maxTurns?: number };
}
```

- **聊天模式**默认启用（任务模式仍用 `taskSetPlan`）
- 只读工具（read/search 等）无需先提交计划
- 超预算时阻止工具执行，将原因回传给模型
- 配置：`platform.planGate`（enabled、requirePlanFor、defaultBudget）
- 实现：`platform/plan/` + `CottageAgent` 工具循环拦截

### 5.5 DoD Verifier（通用）

扩展 `task/verify.ts`，支持需求覆盖矩阵与多类型检查：

- 文件存在 / 内容包含
- 结构化断言（路由注册、配置字段、表格列）
- 可选脚本（保留现有 Worker 路径）
- 输出：`{ verdict: 'pass' | 'fail', uncovered: string[], checks: CheckResult[] }`

### 5.6 Context Builder

按优先级与 token 预算打包上下文：

**硬规则 > 目标代码/文档 > 依赖符号 > 参考代码 > 历史摘要**

各 Domain Pack 提供自己的「相关性打分」插件。

### 5.7 Trace / Replay

全链路记录：检索命中、计划决策、工具调用、修改前后 diff、判定结果。支持失败任务一键回放，对比不同 prompt / 规则效果。

### 5.8 Companion Service 协议

浏览器 Agent 发现、认证、调用本地服务的标准接口。服务暴露**操作目录**（如 `transcribeAudio`、`mergePdf`），不暴露 shell。传输优先考虑 Streamable HTTP / MCP。

---

## 6. 目标目录结构（演进目标）

图例：✅ 已实现 · 🚧 部分实现 · ⬜ 规划中

```
frontend/src/
├── platform/                    # 平台核心
│   ├── capabilities/            # ✅ Registry、domain 定义
│   ├── policy/                  # ✅ 策略引擎 + 审批闸门
│   ├── packs/                   # ✅ 能力包（内置 builtins/ + 外部安装）
│   ├── context/                 # ⬜ Context Builder
│   ├── plan/                    # ✅ Plan Gate、submitExecutionPlan、预算
│   ├── verify/                  # ⬜ 通用 DoD（从 task/verify 抽离）
│   └── trace/                   # ✅ Trace + Replay
│
├── content/                     # 🚧 统一内容层
│   ├── extractors/              # ✅ office（PDF/媒体待补）
│   ├── structuredStore.ts       # ✅
│   └── contentRegistry.ts       # ✅
│
├── domains/                     # 领域包
│   ├── coding/                  # 🚧 符号索引/引用（AST、arch rules 待补）
│   ├── office/                  # ✅ docx/pptx 模板、batch 生成
│   ├── media/                   # ⬜
│   └── integration/             # ⬜ REST connector、OAuth
│
├── integration/                 # ⬜ 外部 API
│   ├── connectorRegistry.ts
│   ├── httpTool.ts
│   └── oauth/
│
├── rag/                         # ✅ 向量索引 + 检索 + Office 抽取
├── agent/                       # 🚧 已接入 platform（base + 能力包装配 + policyGate）
├── orchestrator/                # 现有：domain-aware planner（Plan Gate 待补）
└── task/                        # 现有：委托 platform/verify（待抽离）
```

**现有文件改动进度**


| 文件                            | 改动方向                                          | 状态   |
| ----------------------------- | --------------------------------------------- | ---- |
| `agent/createCottageAgent.ts` | base 工具 + 能力包装配 + policyGate                  | ✅    |
| `agent/constants.ts`          | base prompt + 能力包 overlay，去 coding 硬编码        | ✅    |
| `agent/toolCatalog.ts`        | 演进为包级 capability 分组（office/coding/python）      | ✅    |
| `agent/CottageAgent.ts`       | 工具执行前挂 policyGate + planGate hook              | ✅    |
| `orchestrator/planner.ts`     | 输入 `detectedDomains` + capability 列表          | ⬜    |
| `orchestrator/executor.ts`    | Plan Gate hook                                | ⬜    |
| `task/types.ts`               | `domain`、`deliverables`、`acceptance.checks[]` | ⬜    |
| `task/verify.ts`              | 委托 `platform/verify`                          | ⬜    |
| `mcp/toolAdapter.ts`          | oneOf/allOf/anyOf/ref、结构化结果、重试分级              | ⬜    |


---

## 7. 路线图

### Phase 0 — 基线巩固（当前 → 已完成大部分）

- [x] 浏览器 Workspace（FSA）
- [x] Agent 工具循环 + 任务模式
- [x] Orchestrator + Sub-agent
- [x] 本地 RAG + 历史 checkpoint
- [x] MCP 基础接入
- [x] Office 只读 + 表格读写 + Pyodide
- [x] Skills 工作区注入

### Phase 1 — 平台化骨架（进行中，约完成 80%）

**目标**：确立「容器」边界，让编排与验收不再绑死在 coding 假设上。


| 事项                  | 产出                                      | 状态   |
| ------------------- | --------------------------------------- | ---- |
| Capability Registry | `platform/capabilities/`，Settings UI 分组 | ✅    |
| Capability Pack     | 内置包 + 外部包安装/校验/加载，基础/领域能力分层               | ✅    |
| 分层 prompt           | `constants.ts` → base + 能力包 overlay     | ✅    |
| Policy MVP          | 工具 riskLevel + 破坏性操作 requireApproval + 审批 UI | ✅    |
| Plan Gate MVP       | 修改前输出 plan JSON，超预算 abort；`submitExecutionPlan` 工具 + 预算闸门 | ✅    |
| Trace 基础            | `.cottage/trace/{sessionId}/` 事件流       | ✅    |


**验收**：同一套 Orchestrator 可跑「整理 Excel」与「改前端组件」两类任务，且均有 plan + trace。
**当前进度**：能力分层、能力包装配、Policy 审批、Plan Gate 已具备；剩 Trace 一项即可达成 Phase 1 验收。

### Phase 2 — 办公闭环（部分完成）

**目标**：证明「非编程任务」可完成、可交付、可验收。


| 事项             | 产出                                  | 状态   |
| -------------- | ----------------------------------- | ---- |
| Content Model  | extractors + structuredStore        | ✅    |
| Office Pack    | writeWord / writePresentation、模板填变量、批量生成 | ✅    |
| PDF 提取         | 纳入 RAG 与 content 索引                 | ⬜    |
| Deliverable UI | 任务结束展示交付物清单与预览                      | 🚧    |
| Generic DoD    | checks 模板：文件、内容包含、结构化字段             | ✅    |


**验收**：「读 Excel → 生成摘要 docx → 用户预览 → verify 通过」端到端闭环。
**当前进度**：内容层与办公写入/模板已就位；剩 Deliverable UI 与 Generic DoD 即可打通闭环。

### Phase 3 — 外部世界（约 2 周）

**目标**：API 调用成为一等能力，不靠 shell 绕路。


| 事项                     | 产出                   |
| ---------------------- | -------------------- |
| HTTP Connector         | 声明式 REST + schema 校验 |
| OAuth / secrets        | 令牌管理与 Policy 白名单     |
| MCP 可靠性                | schema 补全、结构化结果、超时重试 |
| Companion Service 协议草案 | 本地服务注册与发现            |


**验收**：配置一次 Connector 后，Agent 可拉取 API 数据写入表格，全程有 Policy 与 trace。

### Phase 4 — 编程深度（持续）

**目标**：在平台骨架上叠加 Coding Pack，逼近「类 Cursor」稳定性。


| 事项                | 产出                        | 状态   |
| ----------------- | ------------------------- | ---- |
| 符号索引              | 函数/组件/类型 定义-引用查询（TS/Vue）    | ✅    |
| 影响分析              | analyzeImpact：受影响文件数与调用点总数   | ✅    |
| 编码工作流纪律            | 有界探索/任务分级/最小改动/DoD 自检（prompt overlay） | ✅    |
| AST 编辑工具          | import / props / 类型 / 调用点 | ⬜    |
| Coding Policy 规则集 | 架构约束自动检查（当前为 prompt 规则，引擎待补）  | 🚧    |
| Coding DoD 模板     | 路由注册、store 联动等（当前为自检清单，引擎待补） | 🚧    |


**优先级说明**：Coding Pack 放在 Phase 4，不是因为不重要，而是因为 **Phase 1–3 建立的 Plan / Policy / Verify / Trace 对全领域通用**；先铺平台轨道，再装编程专载车厢。

### Phase 5 — 多媒体与自动化（按需）


| 事项         | 产出                          |
| ---------- | --------------------------- |
| Media Pack | OCR、ASR、转码（Companion 或 MCP） |
| Memory     | `.cottage/memory/` 跨会话偏好与事实 |
| Playbook   | 固化流程，可重复触发                  |
| Scheduler  | 定时 / 文件夹 watch 触发任务         |


---

## 8. 成功指标

平台也需要像「入轨」一样的可观测里程碑：

### 一级指标（平台是否成立）


| 指标     | 说明                           |
| ------ | ---------------------------- |
| 任务完成率  | 用户 goal → `verify` 通过的比例     |
| 一次成功率  | 无需人工补救的比例                    |
| 交付可核对率 | 用户能在 UI 看到明确 deliverable 的比例 |


### 二级指标（平台是否在进步）


| 指标      | 说明                                    |
| ------- | ------------------------------------- |
| 计划偏离率   | 实际改动 vs 计划的一致性                        |
| 回放可用率   | 失败任务能否定位到具体环节                         |
| 跨领域复用率  | 同一套 plan/verify/policy 服务多 domain 的比例 |
| 原始工具依赖率 | shell/script 类工具调用占比（应随语义工具完善而下降）     |


---

## 9. 决策记录（ADR 摘要）


| 决策          | 选择                          | 理由                 |
| ----------- | --------------------------- | ------------------ |
| Agent 载体    | 浏览器为第一容器                    | 人机界面、沙箱、预览与信任闭环    |
| 能力扩展        | Companion + MCP + Connector | 不直接把 OS 交给 LLM     |
| 默认工具风格      | 语义化 API                     | 方便人理解与验收           |
| shell / 裸脚本 | 逃生舱，非默认                     | 避免不确定性外包给模型        |
| 架构风格        | Platform + Domain Pack      | 通用平台不与 coding 深度耦合 |
| 数据          | 本地 `.cottage/` 优先           | 随工作区迁移、可审计         |


---

## 10. 总结

Cottage 的目的不是「再做一个什么都能聊的 Agent」，而是：

> **做一个以人为中心的 Agent 容器：让 LLM 的能力通过结构化、可扩展、可验证的服务接口作用到真实工作上，而不是通过原始工具把复杂度和风险直接暴露给人。**

发动机（LLM）越强，越需要车身（Cottage）——传动系统的目标是人好开，不是发动机好踩油门。

迭代顺序：**平台轨道（Plan / Policy / Verify / Trace）→ 办公闭环 → 外部集成 → 编程深度 → 多媒体与自动化**。每一阶段都应有可演示的端到端场景和可度量指标，避免能力堆叠却没有「入轨时刻」。

**当前状态（2026-06）**：平台轨道已铺好 Capability Registry / Capability Pack / Policy 三段；办公闭环已具备内容层与写入/模板能力。下一步聚焦 **Plan Gate + Trace**（补全平台轨道）与 **Deliverable UI + Generic DoD**（打通办公闭环）。

---

*文档版本：v2 · 2026-06 · 基于 Capability Pack + Policy Engine 落地更新（v1：2025-06 架构讨论）*
