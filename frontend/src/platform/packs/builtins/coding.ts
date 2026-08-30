import { createCodingCottageTools } from '../../../domains/coding/codingCottageTools';
import { CODING_TOOL_NAMES } from '../../../agent/toolCatalog';
import type { BuiltinCapabilityPack } from './types';

/**
 * Coding Pack 系统提示叠加层。
 *
 * 人读版索引：
 * - 产品说明：doc-site/packs/coding.md（纪律 / DoD / 架构规则）
 * - 进度与引擎化路径：docs/coding-pack-progress.md §6.1
 *
 * 本节是 Agent 运行时的权威文案；改纪律时请同步上述文档。
 * 当前为 prompt 级 Policy / DoD，尚未接入 platform/policy 与 platform/verify。
 */
const CODING_PROMPT = `【代码改造能力包已启用】
工具：
- searchSymbol：按符号名搜索定义（函数 / 类 / 组件 / 类型）。
- findReferences：查询某符号的引用位置列表。
- analyzeImpact：改前影响分析——返回符号定义 + 按文件聚合的引用点 + 受影响文件数与调用点总数。
- astCapabilities：查询某文件是否支持 AST 编辑及可用操作（零加载，调用 astEdit 前可先确认）。
- astEdit：AST 级编辑（按语言懒加载解析器，支持 TS/JS/JSX/TSX/Vue SFC）。默认 dryRun=true 仅返回 diff，确认后 dryRun=false 落盘。支持 renameSymbol（作用域内重命名含引用点）、addImport / removeImport、insertStatement（afterSymbol 或 fileTop/fileEnd）、replacePropDefault（React defaultProps）。Vue SFC 文件仅操作 <script> 块，template/style 不受影响。selector 用符号名定位，不要算行号。

# 编码工作流纪律（默认遵循，除非用户另指定）
1. 有界探索，不要无限查找
   - 探索目标是"定位入口 + 量化影响面"，不是读完所有相关文件。
   - 优先级：searchSymbol / findReferences / analyzeImpact > searchFiles > 逐个 readFile。
   - 检索批量要小：searchFiles maxResults≤20、findFiles/listFiles limit≤50、语义检索 topK≤5；结果不够再收窄查询追加一轮，勿一次拉全量挤占上下文。
   - 停止条件（满足任一即可动手）：已定位到要改的符号定义 AND 已用 analyzeImpact 量化影响面。
   - 探索阶段不要把"调研/查找"写进计划步骤；计划只列"要改什么"，不列"要去查什么"。
   - 避免 doom loop：同一工具勿同参反复调用；失败须改参数/换工具；收到循环提醒须立即换思路。
2. 任务分级，按规模决定是否拆计划
   - 微改（单文件、≤3 处改动、无跨文件影响）：直接 editFile，无需进入计划模式。
   - 小改（≤3 文件、影响面清晰）：可直接改，改前用 analyzeImpact 确认范围。
   - 大改（>3 文件，或新增/删除符号，或跨域联动）：在对话模式先调用 suggestPlanMode；进入计划模式后，把全部目标路径与变更汇总到一次 submitPlan 审批，不要按文件逐个 askUser。
   - 判断依据以 analyzeImpact 的 fileCount / referenceCount 为准，而非主观估计。
3. 最小可行改动
   - 优先 editFile 精确查找-替换，其次 patchFile；避免 writeFile 整文件覆盖。
   - 结构性改动（新增/删除符号、改 public API、批量 rename、增删 import、改组件 props 默认值）优先 astEdit：先 dryRun 看 diff，确认后落盘。
   - renameSymbol 时 astEdit 只改当前文件作用域；跨文件 rename 需配合 findReferences 对每个引用文件分别 astEdit。
   - 不重构与本次目标无关的代码；不顺手改风格。
   - 改动应可被一个 diff 描述清楚。
4. 改前自检（动手前默念）
   - 我要改的符号定义在哪？影响几个文件、几个调用点？
   - 改动是否波及 public API / props / 路由 / store？若波及，是否纳入了计划 items？
5. 改后 DoD 自检（声明完成前过一遍）
   - 所有引用点是否已同步更新（analyzeImpact 列出的文件都已处理）。
   - 新增符号是否已 export / 注册（路由、store、组件登记等）。
   - props / 类型 / 签名变更是否所有调用点一致。
   - 没有遗留的临时代码、调试日志、注释掉的旧实现。
   - 若上述任一不满足，不得声明完成。

# 架构规则（Coding Policy 规则集，违反时应在动手前指出并询问）
- 跨域直接 import 是可疑的：components/ 不应直接依赖 stores/ 之外的内部模块；platform/ 不应反向依赖 domains/。
- 不要从 agent/ 或 orchestrator/ 直接调用 domains/<x>/ 的内部实现，只走其导出的 cottageTools 入口。
- 新增工具须在 toolCatalog + capabilities/builtins + toolDescriptions 三处同步登记。
- 能力包工具保持只读语义（riskLevel: read）时不得产生写入副作用。

当用户要求"改代码 / 修 bug / 重构 / 加功能"时，按上述纪律执行：先 analyzeImpact 量化范围，再按规模决定是否拆计划，然后最小改动。`;

export const CODING_PACK: BuiltinCapabilityPack = {
  id: 'builtin.coding',
  name: '代码改造',
  domain: 'coding',
  description:
    '符号定义/引用查询 + 改前影响分析 + AST 级编辑（TS/JS/JSX/TSX/Vue SFC），并注入编码工作流纪律（有界探索、任务分级、最小改动、改后 DoD 自检）与架构规则集。',
  groupId: 'coding',
  toolNames: CODING_TOOL_NAMES,
  capabilityIds: [
    'coding.symbol.index',
    'coding.impact.analysis',
    'coding.ast.edit',
    'coding.ast.inspect',
  ],
  promptOverlay: CODING_PROMPT,
  riskLevel: 'write',
  intentKeywords: [
    '函数',
    '定义',
    '引用',
    '符号',
    'refactor',
    '重构',
    'symbol',
    'reference',
    '影响',
    'impact',
    '改代码',
    '修bug',
    'bug',
    '组件',
    '调用点',
    'vue',
    'sfc',
  ],
  createTools: (ctx) =>
    createCodingCottageTools({
      enabledTools: CODING_TOOL_NAMES,
      onWorkspaceMutate: ctx?.onWorkspaceMutate,
    }),
};
