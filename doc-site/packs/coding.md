# 代码改造

打开 **代码改造** 后可用。跟做教程见 [改代码](/guide/use-coding)。

源码：`frontend/src/platform/packs/builtins/coding.ts`（`promptOverlay` 即下列纪律的权威文案）；进度见仓库 `docs/coding-pack-progress.md`。

![代码与文件任务的差异审阅界面](/images/pack-coding-demo.png)

## 能做什么

- 按符号名找定义与引用  
- 改前影响分析（波及多少文件）  
- AST 级编辑（TS/JS/Vue 等），默认可先看 diff 再落盘  

## 你怎么用（最短路径）

1. 打开能力并保持暂存审阅  
2. 用 `@` 或符号名限定范围  
3. 先看影响面，再批准最小改动  

## 工具一览

| 工具 | 做什么 |
|------|--------|
| `searchSymbol` | 找定义 |
| `findReferences` | 找引用 |
| `analyzeImpact` | 影响分析 |
| `astCapabilities` / `astEdit` | 查询能力 / AST 编辑 |

## Agent 默认纪律（prompt overlay）

启用本包后，系统提示会注入下列纪律。用户另有说明时以用户为准；否则 Agent 应按此执行。

### 有界探索

- 目标是「定位入口 + 量化影响面」，不是读完相关文件。  
- 优先：`searchSymbol` / `findReferences` / `analyzeImpact`，再才是宽检索。  
- 满足「已定位符号定义 **且** 已 `analyzeImpact`」即可动手；探索步骤不要写进计划 todo。

### 任务分级

| 规模 | 依据（以 `analyzeImpact` 为准） | 做法 |
|------|--------------------------------|------|
| 微改 | 单文件、改动少、无跨文件影响 | 直接 `editFile` |
| 小改 | ≤3 文件、影响面清晰 | 可直接改，改前确认影响 |
| 大改 | >3 文件，或新增/删除符号，或跨域联动 | 先 `submitExecutionPlan` |

### 最小改动

- 优先精确编辑；结构性改动优先 `astEdit`（先 `dryRun` 看 diff）。  
- 不重构无关代码、不顺手改风格。

## 改后 DoD 自检清单

声明完成前 Agent 应自检（任一不满足则不得宣称完成）：

1. `analyzeImpact` 列出的引用点均已同步  
2. 新增符号已 export / 注册（路由、store、组件登记等）  
3. props / 类型 / 签名变更在所有调用点一致  
4. 无临时代码、调试日志、注释掉的旧实现  

> 当前为 **prompt 级 DoD**，尚未接入 `platform/verify` 引擎。

## 架构规则（Coding Policy，prompt 级）

动手前若发现冲突，应先指出并询问用户：

- `components/` 不宜直接依赖 `stores/` 以外的内部模块；`platform/` 不应反向依赖 `domains/`  
- 不要从 `agent/` / `orchestrator/` 直接调用 `domains/<x>/` 内部实现，只走其 Cottage tools 入口
- 新增工具须在 `toolCatalog` + `capabilities/builtins` + `toolDescriptions` **三处同步登记**  
- 声明为只读（`riskLevel: read`）的能力包工具不得有写入副作用  

> 当前为 **prompt 级 Policy**，细粒度规则引擎待补。
