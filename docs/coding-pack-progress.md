# Coding Pack 增强进度

> 记录 2026-06 对 Coding Pack 的扩充：从"只有依赖分析"到"功能更全面的编码能力包"。
> 相关文档：[platform-vision-and-roadmap.md](./platform-vision-and-roadmap.md) §4.2 / Phase 4。

---

## 1. 背景与动机

原有 Coding Pack 只有 `searchSymbol` / `findReferences` 两个只读工具，`promptOverlay` 仅 3 行，没有任何"写代码工作流"约束。

由此暴露的痛点：agent 在改代码任务里**不停探索、把调研步骤写进计划、不知道何时停止查找开始动手**。这不是模型单方面问题，而是能力包缺少编码纪律的编码化。

本轮目标：让"写代码"成为平台的默认能力——**有界探索、任务分级、最小改动、改后自检**，并补齐路线图里 Coding Pack 的缺口。

## 2. 落地内容（三档 + AST 工具集）

### 第一档：编码工作流纪律（prompt overlay）

重写 `CODING_PACK.promptOverlay`，把五条纪律编码为默认行为：

1. **有界探索**：明确停止条件（已定位入口符号 + 已用 `analyzeImpact` 量化影响面即可动手）；探索阶段不写进 todo / plan items
2. **任务分级**：按 `analyzeImpact` 的 fileCount/referenceCount 分微改 / 小改 / 大改，只有大改才 `submitExecutionPlan`
3. **最小改动**：优先 `editFile`，结构性改动优先 `astEdit`，不整文件覆盖、不顺手重构
4. **改前自检**：动手前确认影响面与是否波及 public API / props / 路由 / store
5. **改后 DoD 自检**：引用同步、export/注册、props/类型一致、无遗留调试代码

附 **架构规则集**（Coding Policy 规则集，以 prompt 形式落地）：跨域 import 约束、新增工具三处同步登记、只读工具不得有写入副作用。

### 第二档：改前影响分析工具

新增 `analyzeImpact`：基于符号索引，按文件聚合引用点，返回受影响文件数、调用点总数、是否孤立。把"改前先看影响面"从口头建议变成可调用工具，并作为任务分级的事实依据。

### 第三档：AST 级编辑工具集（按需加载）

按"特定工具集 + 按语言懒加载"架构实现，详见 §3。

### 顺带修复

`coding.semantic.retrieve` 能力原错配到 RAG 工具 `searchWorkspaceSemantic`，导致 `searchSymbol`/`findReferences` 没有 capability 映射、Plan Gate/Policy 看不到它们。现拆分为三个清晰能力：

| 能力 id | 工具 | 风险 |
|---|---|---|
| `coding.semantic.retrieve` | `searchWorkspaceSemantic`（RAG） | read |
| `coding.symbol.index` | `searchSymbol` / `findReferences` | read |
| `coding.impact.analysis` | `analyzeImpact` | read |
| `coding.ast.edit` | `astEdit` | write |
| `coding.ast.inspect` | `astCapabilities` | read |

## 3. AST 编辑工具集架构

### 设计原则

- **对 LLM 工具面极简**：只暴露 `astEdit` + `astCapabilities` 两个工具，不随语言数量膨胀
- **按语言注册 adapter**：复用现有 `adapterRegistry` 模式，新增 `AstEditAdapter` 注册表
- **三级懒加载**，不用的解析器一个字节都不进 bundle：
  - L1：coding pack 启用时只登记 adapter 元信息（id / supports / declaredOps）
  - L2：首次对某语言调 `astEdit` 才 `dynamic import` 该语言的解析器
  - L3：纯 TS 会话不加载 JSX 依赖，反之亦然
- **可插拔**：新语言 = 加一个 adapter 文件 + 一行注册，不改工具 / capability / 工具列表
- **位置化编辑**：用 `magic-string` 区间 overwrite/remove/append，保留原格式、产出最小 diff，**不整文件 codegen 覆盖**
- **selector 用符号名定位**，绝不让 LLM 算 offset / 行号

### 当前 adapter

| adapter id | 路径 | 解析插件 |
|---|---|---|
| `ts-babel` | `.ts` `.mts` `.cts` `.js` `.mjs` `.cjs` | `typescript` |
| `jsx-babel` | `.tsx` `.jsx` | `typescript` + `jsx` |
| `vue-sfc` | `.vue` | 提取 `<script>` 块复用 `typescript` + `jsx` |

路径分区避免同一文件被两个 adapter 同时匹配。

### 操作集（5 个，两个 adapter 都支持）

| op | 说明 |
|---|---|
| `renameSymbol` | 作用域内重命名，含所有引用点（`@babel/traverse` binding 分析，非朴素替换） |
| `addImport` | 增 import，自动去重，插在现有 import 之后 |
| `removeImport` | 删 specifier 或整条 import |
| `insertStatement` | `afterSymbol` / `fileTop` / `fileEnd` 锚点插入 |
| `replacePropDefault` | React `Component.defaultProps.prop` 默认值替换 |

### 安全机制

- `astEdit` 默认 `dryRun: true`，仅返回 diff；`dryRun: false` 才落盘
- 解析失败 / 未命中 → `applied: 0` + note，提示回退 `editFile`
- `astEdit` 是 write，触发 Plan Gate 的 `submitExecutionPlan`
- 产出 unified diff（行级 LCS），便于人审与 trace

## 4. 涉及文件

### 新增

```
frontend/src/domains/coding/ast/
├── types.ts              # AstEditAdapter / AstOps / AstOperation / AstEditResult
├── diff.ts               # 极简 unified diff（行级 LCS）
├── adapterRegistry.ts    # adapter 注册表 + 懒加载 + astCapabilitiesForPath
├── operations.ts         # 共享 op 工厂（babel + magic-string）
├── astCottageTools.ts  # astEdit + astCapabilities 工具
├── index.ts
└── adapters/
    ├── tsAdapter.ts      # TS/JS adapter
    ├── jsxAdapter.ts     # React JSX/TSX adapter
    └── vueAdapter.ts     # Vue SFC adapter（提取 script 块复用 babel ops）
```

### 修改

| 文件 | 改动 |
|---|---|
| `domains/coding/query.ts` | 新增 `analyzeSymbolImpact` |
| `domains/coding/codingCottageTools.ts` | 注册 adapter、装载 AST 工具、接收 `onWorkspaceMutate` |
| `domains/coding/index.ts` | 导出 ast 子模块 |
| `agent/toolCatalog.ts` | `CODING_SYMBOL_TOOL_NAMES` → `CODING_TOOL_NAMES`，加 `analyzeImpact` / `astEdit` / `astCapabilities`；更新分组文案 |
| `agent/toolDescriptions.ts` | 新工具描述 / 别名 / 风险 |
| `agent/constants.ts` | "代码符号索引" → "代码改造" |
| `platform/capabilities/builtins.ts` | 修正 `coding.semantic.retrieve`、新增 `coding.symbol.index` / `coding.impact.analysis` / `coding.ast.edit` / `coding.ast.inspect` |
| `platform/packs/builtins/coding.ts` | 重写 promptOverlay、更新包名/描述/capabilityIds/intentKeywords、riskLevel 升为 `write`、传递 `onWorkspaceMutate` |
| `docs/platform-vision-and-roadmap.md` | 同步 §4.1 / §4.2 / §5 / Phase 4 现状 |
| `frontend/package.json` | 加入 `@babel/parser` `@babel/traverse` `@babel/types` `magic-string` |

## 5. 部署前提

> 本轮开发时 shell 不可用，未能运行 `npm install`。

`package.json` 中四个新依赖使用 `latest` 标签占位（未臆造版本号）。部署前需在 `frontend/` 执行：

```bash
npm install
# 建议把 latest 替换为锁定的具体版本
```

随后跑 tsc / lint / test 验证。

## 6. 已知限制

- **rename 单文件作用域**：跨文件 rename 需配合 `findReferences` 对每个引用文件分别 `astEdit`（promptOverlay 已写明），一键批量留待 A3
- **replacePropDefault 仅 `defaultProps` 写法**：不支持 hooks / 解构默认值的 props 改写
- **Vue SFC 仅操作 `<script>` 块**：template / style 块不受 AST 编辑影响；script 块需为合法 TS/JSX
- **DoD / 架构规则以 prompt overlay 落地**：尚未进入 `platform/verify` 与 `platform/policy` 的真实引擎

## 6.1 规则与 DoD 文档索引（人读版）

权威文案在 `frontend/src/platform/packs/builtins/coding.ts` 的 `CODING_PROMPT`；产品说明见 [doc-site/packs/coding.md](../doc-site/packs/coding.md)。

### Coding Policy（架构规则集 · prompt）

| 规则 | 意图 |
|------|------|
| 跨域 import 约束 | 避免 `components/` 绕过边界、`platform/` 反向依赖 `domains/` |
| 只走 Cottage tools 入口 | `agent/` / `orchestrator/` 不得直调 domain 内部实现 |
| 三处同步登记 | 新工具必须同时出现在 catalog / capabilities / descriptions |
| 只读无写入副作用 | `riskLevel: read` 的工具不得落盘或改配置 |

### Coding DoD（改后自检 · prompt）

| 检查项 | 说明 |
|--------|------|
| 引用同步 | `analyzeImpact` 列出的文件均已处理 |
| 注册完整 | 新符号已 export / 路由 / store / 组件登记 |
| 签名一致 | props / 类型 / 调用点对齐 |
| 无残留 | 无调试日志、临时代码、注释掉的旧实现 |

引擎化路径：DoD → `platform/verify` 断言模板；Policy → `platform/policy` 细粒度规则（见 §7「平台核心」）。

## 7. 下一步

| 阶段 | 内容 | 状态 |
|---|---|---|
| A1 ✅ | babel + magic-string，TS/JSX adapter，5 op，dryRun/diff | 已完成 |
| A2 ✅ | Vue SFC adapter（提取 <script> 块复用 babel ops，template/style 不受影响） | 已完成 |
| A3 | rename 联动 `findReferences` 跨文件批量改 + 影响面预览 | 待做 |
| A4 ✅ | 解析移入 `ast.worker`（已接通，工具层通过 `applyAstForPath` 走 Worker，失败时自动回退主线程） | 已完成 |
| B | `typescript` compiler 类型感知 rename / 签名变更（重，按需） | 待做 |
| 平台核心 | Coding DoD 引擎（`platform/verify`）+ 架构规则引擎（`platform/policy` 细粒度规则） | 待做 |

## 8. 与路线图的对应

本轮兑现了 [platform-vision-and-roadmap.md](./platform-vision-and-roadmap.md) Phase 4 的三项：

- ✅ 符号索引（已存在，本轮补 capability 映射）
- ✅ 影响分析（`analyzeImpact`）
- ✅ 编码工作流纪律（prompt overlay）

推进两项至 🚧：

- 🚧 Coding Policy 规则集（prompt 形式已落地，引擎待补）
- 🚧 Coding DoD 模板（自检清单已落地，引擎待补）

仍待做：

- ⬜ AST 编辑工具的跨文件 rename（A3）
- ⬜ 平台级 DoD / Policy 引擎

---

*文档版本：v1 · 2026-06-30*
