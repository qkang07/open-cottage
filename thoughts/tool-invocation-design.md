# 统一工具调用体系设计（agent / script / manual）

> 状态：**阶段 1、2 已实现**（统一执行器 + script 治理补齐 + DebugPanel 手工调用 tab）；阶段 3 待后续启动；实现过程中若有设计调整，需同步更新本文档。
>
> 阶段 1 实现备注：
> - `scriptToolBridge` 未注入 executor 时保留退化为直接 invoke 的兼容路径（verify 等无治理场景）。
> - 重复指纹按 `parentCallId`（宿主 runScript 的 callId）隔离作用域；`ToolStreamContext.currentCallId` 由 CottageAgent 在执行段前设置。
> - script/manual 的 trace `resultSnippet` 截断 8KB；manual 结果文本 64KB 截断。
>
> 阶段 2 实现备注：
> - 目录枚举在 `createCottageAgent` 的 `listInvokableCatalog`（已挂载含 MCP 按 `mcp__` 前缀分组 + 延后目录），经 executor 的 `listTools` 注入；`ToolCatalogEntry` 扩展了 `group` 与 `schema`（zod）字段，CottageAgent 新增 `getMountedTools()`。
> - `invokeManually` 前置失败（JSON / schema）抛 `ManualToolInvokeError`（stage 区分）；执行层失败不抛错，以 outcome.status 返回。
> - destructive 的 `ElMessageBox.confirm` 二次确认与 policyGate 独立（manual 来源 policyApproval 为 auto-allow，由 UI 承担确认）。
> - reuseAgent 路径复用旧 executor，其 `listTools` 闭包读到的延后目录为首次创建时的实例（与既有桥行为一致）。

## Context

当前"工具调用"有两条互不一致的路径：

- **agent 路径**：经 `CottageAgent.runAssistantTurn` 工具循环，具备完整治理——重复指纹、doom loop、planGate、policyGate 审批、trace、输出后处理。
- **script 路径**：runScript 脚本内 `cottage.*` 经 `scriptToolBridge` 直接 `tool.invoke()`，绕过全部闸门（审批安全口子、预算计数、trace 缺失、AbortSignal 不透传）。

同时缺少第三种入口：用户手工调用工具用于调试。

**目标**：抽出统一执行器 `UnifiedToolExecutor`，三类来源（`agent`/`script`/`manual`）走同一管线、按来源配置治理；补齐脚本治理；新增 DebugPanel 手工调用 tab；最终把 agent 工具循环收编到执行器。

**已确认的决策**：

- **脚本高危审批**：runScript 被 agent 调用时做一次统一审批（审批文案说明"脚本内可调用高危工具，本次批准一并授权"）；批准后脚本内 confirm 级子调用自动放行（deny 仍拦截），全部记 trace。
- **范围**：全部三阶段（含 agent 循环收编）。

## 现状关键事实（已调研核实）

- 工具循环：`src/agent/CottageAgent.ts` 约 L1571-2020。顺序：重复指纹（上限 2）→ doomLoop check（软提醒→policyGate）→ planGate（同步）→ policyGate（异步）→ 执行（askUser 特殊路径/流式/invoke）→ strip 输出后处理 → recordPlanToolOutcome + doomLoop record → trace → ToolMessage。
- `PolicyGate`：`src/platform/policy/types.ts:13-22`，`(input:{toolName,args,callId,signal,onAwaitingApproval}) => Promise<{allowed,reason?}>`；审批经 `chat/callInteractionGate.ts` `waitForCallInteraction`（键 `sessionId::callId`）；风险判定 `policyEngine.ts evaluateToolPolicy` 用 **capabilities registry**（`platform/capabilities/registry.ts findByToolName`），非 `TOOL_RISK` 表；默认 `requireApprovalFor:['destructive']`（config/constants.ts:593）。
- `PlanGate` 同步、纯计数（`PlanSession.counters`），`recordPlanToolOutcome` 成功后计数；豁免名单在 `planEngine.ts:30-33`。
- `DoomLoopDetector`：`src/agent/doomLoop.ts:14-22`，check/record/reset，纯内存；软提醒计数在 CottageAgent。
- Trace：`src/platform/trace/types.ts` `TraceToolCallEvent{type:'tool_call',id,round,name,args,status:TraceToolStatus(8种),resultSnippet,before/after/diffSnippet,durationMs,streamed}`；JSONL 追加，新字段兼容。
- 脚本桥（已实现）：`src/agent/scriptToolBridge.ts` `createScriptToolInvoker({getTool})`，黑名单 `BLOCKED_SCRIPT_TOOL_NAMES`，`sanitizeToolOutput`；`ScriptToolInvoker` 在 `src/agent/runScript.ts:18`；注入点 `createCottageAgent.ts:406-408`（agentRef 延迟回填，reuseAgent 热切换不重建闸门 → **executor 依赖必须全用 lazy getter**）。
- 手工入口：`components/DebugPanel/DebugPanel.vue` 现 3 个只读 tab；`stores/debugPanel.ts` 控开关；活跃 agent 取法参照 `ChatDebugTab.vue`（useAgentStore）。
- `platform/verify/engine.ts:212` `runScriptInWorker(script)` 不传桥（验收脚本禁 cottage.*，保持）。
- MCP 工具 `mcp__server__tool` 不在 capabilities registry → evaluateToolPolicy 默认放行（维持现状）。

## 设计

### 统一执行器（新文件 `src/agent/toolInvocation.ts`）

```ts
export type ToolInvocationSource = 'agent' | 'script' | 'manual';

export interface ToolInvocationRequest {
  toolName: string;
  args: unknown;
  source: ToolInvocationSource;
  callId?: string;        // 缺省生成 `${source}:${uuid}`
  signal?: AbortSignal;
  round?: number;         // agent 轮次；script/manual 为 0
  parentCallId?: string;  // script：宿主 runScript 的 callId
}

export interface ToolInvocationOutcome {
  callId: string;
  status: TraceToolStatus;   // 复用现有 8 种
  rawOutput?: unknown;
  resultText: string;        // 阻断/错误原因沿用「⛔/📋/🔁」文案
  imagePaths: string[];
  snapshot?: { before: string; after: string; created?: boolean };
  durationMs: number;
}

export interface SourceGovernancePolicy {
  blockedToolNames?: ReadonlySet<string>;
  maxIdenticalCalls: number;               // 0=不启用
  planGate: boolean;
  policyApproval: 'gate' | 'auto-allow';   // gate=挂审批等待；auto-allow=confirm 放行、deny 仍拦
  doomLoop: 'off' | 'record-only' | 'full';
  trace: boolean;
}

export interface CreateToolExecutorOptions {
  getTool: (name: string) => StructuredToolInterface | undefined;
  getPolicyGate?: () => PolicyGate | undefined;
  getPlanGate?: () => PlanGate | undefined;
  getPlanSession?: () => PlanSession | undefined;
  getDoomLoopDetector?: () => DoomLoopDetector | undefined;
  getTraceRecorder?: () => TraceRecorder | null;
  sessionId?: string | null;
  policyOverrides?: Partial<Record<ToolInvocationSource, Partial<SourceGovernancePolicy>>>;
}

export const createUnifiedToolExecutor: (o: CreateToolExecutorOptions) => UnifiedToolExecutor;
// UnifiedToolExecutor = { invoke(req): Promise<ToolInvocationOutcome>; listTools(): ToolCatalogEntry[] }
```

### 管线 × 来源生效表

| 阶段 | agent | script | manual |
|---|---|---|---|
| 黑名单 | 无 | BLOCKED_SCRIPT_TOOL_NAMES | 同 script |
| 重复指纹 | 上限 2 | 上限 5（per 脚本运行） | 关 |
| doomLoop | full | record-only（写入共享 detector） | 关 |
| planGate+计数 | ✓ | ✓（round 传 0；runScript 自身在 plan 引擎防双计） | 关 |
| policyGate | gate | **auto-allow**（前提：runScript 已统一审批，见下） | auto-allow（UI 对 destructive 加 ElMessageBox 二次确认） |
| askUser | 循环内特殊路径（不进 executor） | 黑名单 | 黑名单 |
| 流式 | ✓（3b 经 onStreamDelta hook） | 普通 invoke | 普通 invoke |
| signal | ✓ | ✓（需补） | ✓（tab 内 AbortController） |
| 输出净化 | strip→附件/diff 由调用方消费 | sanitize+JSON round-trip | 不剥离，原样展示（截断 64KB）+imagePaths 列表 |
| trace | round=N | round=0，source:'script'，parentCallId | round=0，source:'manual' |
| ToolMessage/历史 | CottageAgent 自持 | 无 | 无 |

执行器只做「闸门判定+执行+结构化 outcome+trace」；UI section、ToolMessage、附件注入、diff 卡片永远留在调用方。

### runScript 统一审批

- 在 `platform/capabilities/builtins.ts` 为 runScript 所在能力设 `requiresApproval: true`（或单列 capability），使 agent 每次调 runScript 都弹一次审批卡片；审批文案（createPolicyGate 的 message 或工具描述层）说明："脚本可经 cottage.* 调用工具，含高危工具，本次批准一并授权"。
- 脚本能执行 = 统一审批已通过，故 script 来源 `policyApproval:'auto-allow'`（deny 级仍拦）。全局关闭审批时行为一致（用户自担）。
- `RUN_SCRIPT_TOOL_DESCRIPTION` 同步说明此语义。

### 其他决策

- callId 前缀 `script:`/`manual:`，trace/审批键天然可辨来源。
- Trace 扩展：`TraceToolCallEvent` 加可选 `source?: 'agent'|'script'|'manual'` 与 `parentCallId?: string`（向后兼容；实现时扫一遍 Trace/ 读端组件确认无 exhaustive switch）。
- 图片归属：脚本内产图工具的图片留在工作区文件，`cottageImages` 附件通道剥离（scriptToolBridge 注释说明）；outcome 仍带 imagePaths。
- `ScriptToolInvoker` 加可选第三参 `options?: { signal?: AbortSignal }`（向后兼容）；`executeScriptWorker` onMessage 转发时传 `{ signal }`。

## 实施阶段

### 阶段 1：执行器 + script 治理补齐

| 文件 | 动作 |
|---|---|
| `src/agent/toolInvocation.ts` | 新增：类型 + `createUnifiedToolExecutor` + 三份默认 SourceGovernancePolicy |
| `src/agent/toolInvocation.test.ts` | 新增单测 |
| `src/agent/scriptToolBridge.ts` | 重写内部为薄封装：构造 `{source:'script'}` 请求调 executor，outcome 做 sanitize；导出签名兼容 |
| `src/agent/runScript.ts` | ScriptToolInvoker 加可选 signal 参；executeScriptWorker 透传 |
| `src/agent/CottageAgent.ts` | 加 getter：`getPolicyGate()`/`getPlanGate()`/`getDoomLoopDetector()`/`getToolExecutor()`（构造参数收 executor） |
| `src/agent/createCottageAgent.ts` | 创建 executor（全 lazy getter `() => agentRef?.getXxx()`），传给 scriptToolInvoker 与 CottageAgent |
| `src/platform/trace/types.ts` | TraceToolCallEvent 加 source/parentCallId |
| `src/platform/capabilities/builtins.ts` | runScript 能力 requiresApproval:true |
| `src/agent/scriptWorkerProtocol.ts` | RUN_SCRIPT_TOOL_DESCRIPTION 补统一审批语义说明 |
| `src/platform/plan/planEngine.ts` | runScript 防双计（files 计数） |

parentCallId：`ToolStreamContext` 加 `currentCallId`，CottageAgent 调 invokeToolStream 前设置（可选优化，若侵入大可后置）。

### 阶段 2：DebugPanel 手工调用 tab

| 文件 | 动作 |
|---|---|
| `src/platform/debug/manualToolInvoke.ts` | 新增：`listInvokableTools(agent)`（已挂载+延后+MCP 分组；schema 经 zod-to-json-schema）；`invokeManually(agent,name,argsJson,signal)`（JSON 解析→zod safeParse 预校验→executor.invoke({source:'manual'})） |
| `src/components/DebugPanel/ToolInvokeTab.vue` | 新增：分组下拉→schema 只读展示→JSON 参数 textarea（schema 骨架预填）→执行/停止→结果 pre+imagePaths+状态/耗时；destructive 先 ElMessageBox.confirm；无活跃 agent 显空态 |
| `src/stores/debugPanel.ts` | tab 联合类型加 'tools' |
| `src/components/DebugPanel/DebugPanel.vue` | 注册第 4 个 tab |

### 阶段 3：agent 循环收编（渐进两步，各自可独立回滚）

- **3a 闸门段收编**：把循环内三闸判定（doom check→plan→policy，约 L1623-1757）替换为 executor 的 `evaluateGates(req, hooks)` 纯判定入口；hooks 注入 `onAwaitingApproval`（→setCallInteraction）与 `onPreRiskyCheckpoint`；`policyApproval:'gate'` 在此启用。逐行等价替换，不改行为。
- **3b 执行段收编**：「执行+strip 输出+doom record+recordPlanToolOutcome+trace append」替换为 `executor.invoke`，executor 加 `onStreamDelta` hook 承接流式（callSection.result 累积）；**askUser 特殊路径保留在循环内**（交互不是工具执行）；`finalizeInterruptedToolCalls`/checkpoint/staging 逻辑不动。
- 每步跑现有全部测试 + 手工回归清单（见验证）。

## 验证

- 单测（`toolInvocation.test.ts`）：script 黑名单拒绝/deny 拦截/confirm 放行（统一审批语义）/planGate 计数与防双计/重复第 6 次拦/doom record 被调/trace 收到 source:'script'/signal abort；manual confirm 放行+trace。
- 现有测试回归：`verify/engine.test.ts`（不传桥路径零改动）等应全绿。
- 手工回归清单：
  1. agent 调 runScript → 弹一次统一审批；批准后脚本内 cottage.writeFile 等正常执行且 trace 有 script 事件；拒绝则脚本不执行。
  2. 脚本执行中点停止 → Worker 与主线程子调用一起停。
  3. DebugPanel→工具调用 tab：枚举含延后+MCP 工具；非法 JSON 行内报错；readFile 成功；deleteFiles 弹二次确认；聊天 transcript 无新增消息；timeline 出现 manual 事件。
  4. 阶段 3 后：审批允许/拒绝、doom loop 触发、计划闸门拦截、runScript 流式 logs、写文件 diff 卡片、中途停止、askUser 全路径行为与改前一致。

## 风险点

1. **组装顺序/热切换**：scriptToolInvoker 创建时 agentRef 为 null、reuseAgent 不重建闸门 → executor 依赖全 lazy getter（最易踩）。
2. **脚本行为收紧属 breaking**：destructive 子调用从静默成功变为需 runScript 统一审批；runScript 每次调用多一次审批弹窗（已确认接受）。
3. **planGate 计数放大**：批量脚本可能打爆默认预算（maxApiCalls:10/maxFiles:20）；保留 `policyOverrides.script` 调参口，并在 plan 引擎对 runScript 防双计。
4. **signal best-effort**：能否真中断取决于工具是否消费 config.signal。
5. **阶段 3 回归面大**：审批/停止/流式/diff/askUser 全路径；靠 3a/3b 拆步 + 手工回归清单兜底。
6. MCP 工具无 capability 登记 → 脚本/手工调 MCP 不触发审批（与 agent 现状一致，后续可补 mcp__* 默认 external 登记）。
