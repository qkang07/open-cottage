import { getCapabilityRegistry, type Capability } from '../platform/capabilities';

export const SPREADSHEET_TOOL_NAMES = [
  'readSpreadsheet',
  'writeSpreadsheet',
] as const;

export const OFFICE_READ_TOOL_NAMES = ['readWord', 'readPresentation'] as const;
export const OFFICE_WRITE_TOOL_NAMES = [
  'writeWord',
  'writePresentation',
  'renderOfficeTemplate',
  'batchGenerateOfficeDocs',
] as const;

export const PYTHON_TOOL_NAMES = ['runPython'] as const;
export const CODING_TOOL_NAMES = [
  'searchSymbol',
  'findReferences',
  'analyzeImpact',
  'astEdit',
  'astCapabilities',
] as const;

/** 网页自动化能力包工具集合（截图 / 提取 / 会话式交互） */
export const WEB_AUTOMATION_TOOL_NAMES = [
  'screenshotPage',
  'extractPage',
  'openBrowserPage',
  'clickElement',
  'typeText',
  'selectOption',
  'browserNavigate',
  'captureBrowserPage',
  'closeBrowserPage',
] as const;

/** PDF 处理能力包工具集合 */
export const PDF_TOOL_NAMES = [
  'readPdf',
  'mergePdfs',
  'splitPdf',
  'createPdf',
  'createPdfFromHtml',
] as const;

/** 图表可视化能力包工具集合（Mermaid + ECharts） */
export const CHART_TOOL_NAMES = ['renderMermaid', 'renderChart'] as const;

/** 图片生成能力包工具集合（文生图 + 图生图/编辑） */
export const IMAGE_GEN_TOOL_NAMES = ['generateImage', 'editImage'] as const;

/** 深度研究能力包工具集合（方法论编排 + 报告落盘） */
export const DEEP_RESEARCH_TOOL_NAMES = ['saveResearchReport'] as const;

/** 工作区整理能力包工具集合（扫描 → 方案 → 确认 → 批量落盘） */
export const WORKSPACE_TIDY_TOOL_NAMES = ['applyTidyPlan'] as const;

/**
 * 基础文件操作工具集合（默认始终可用，无需开关）。
 * 仅用于「基础能力包」的展示，不参与可选工具的启用逻辑。
 */
export const BASE_FILE_TOOL_NAMES = [
  'listFiles',
  'listDirectory',
  'exists',
  'statFile',
  'hashFile',
  'getDirectorySize',
  'readFile',
  'readMany',
  'findFiles',
  'searchFiles',
  'diffFiles',
  'editFile',
  'patchFile',
  'applyPatch',
  'writeFile',
  'createFile',
  'appendFile',
  'touch',
  'deleteFiles',
  'mkdir',
  'rename',
  'move',
  'copy',
  'copyPaths',
  'compress',
  'extract',
  'runScript',
] as const;

/** 基础联网工具集合（默认始终可用，无需开关） */
export const BASE_WEB_TOOL_NAMES = ['webSearch', 'fetchWebPage'] as const;

/** 基础能力包工具集合（文件操作 + 联网） */
export const BASE_TOOL_NAMES = [
  ...BASE_FILE_TOOL_NAMES,
  ...BASE_WEB_TOOL_NAMES,
  'loadTools',
] as const;

/** 办公能力包工具集合（表格 + Word/PPT 读写与模板） */
export const OFFICE_TOOL_NAMES = [
  ...SPREADSHEET_TOOL_NAMES,
  ...OFFICE_READ_TOOL_NAMES,
  ...OFFICE_WRITE_TOOL_NAMES,
] as const;

export const OPTIONAL_TOOL_NAMES = [
  ...OFFICE_TOOL_NAMES,
  ...CODING_TOOL_NAMES,
  ...PYTHON_TOOL_NAMES,
  ...WEB_AUTOMATION_TOOL_NAMES,
  ...PDF_TOOL_NAMES,
  ...CHART_TOOL_NAMES,
  ...IMAGE_GEN_TOOL_NAMES,
  ...DEEP_RESEARCH_TOOL_NAMES,
  ...WORKSPACE_TIDY_TOOL_NAMES,
] as const;

const OPTIONAL_TOOL_NAME_SET = new Set<string>(OPTIONAL_TOOL_NAMES);

export const normalizeEnabledTools = (
  names: readonly string[] | undefined,
): string[] | undefined => {
  if (!names?.length) return undefined;
  return names.filter((n) => OPTIONAL_TOOL_NAME_SET.has(n));
};

export type SpreadsheetToolName = (typeof SPREADSHEET_TOOL_NAMES)[number];
export type OfficeReadToolName = (typeof OFFICE_READ_TOOL_NAMES)[number];
export type OfficeWriteToolName = (typeof OFFICE_WRITE_TOOL_NAMES)[number];
export type PythonToolName = (typeof PYTHON_TOOL_NAMES)[number];
export type CodingToolName = (typeof CODING_TOOL_NAMES)[number];
export type WebAutomationToolName = (typeof WEB_AUTOMATION_TOOL_NAMES)[number];
export type PdfToolName = (typeof PDF_TOOL_NAMES)[number];
export type ChartToolName = (typeof CHART_TOOL_NAMES)[number];
export type ImageGenToolName = (typeof IMAGE_GEN_TOOL_NAMES)[number];
export type DeepResearchToolName = (typeof DEEP_RESEARCH_TOOL_NAMES)[number];
export type WorkspaceTidyToolName = (typeof WORKSPACE_TIDY_TOOL_NAMES)[number];
export type OptionalToolName = (typeof OPTIONAL_TOOL_NAMES)[number];

/**
 * 可选「能力包」分组（与内置能力包一一对应）。
 * 每组即一个领域能力包，启用后注入该包的全部工具、提示词与技能。
 */
export const OPTIONAL_TOOL_GROUPS = [
  {
    id: 'office',
    label: '办公文档',
    description: '读写 Excel / Word / PPT，并支持模板变量渲染',
    toolNames: [...OFFICE_TOOL_NAMES],
  },
  {
    id: 'coding',
    label: '代码改造',
    description:
      '符号定义/引用查询、改前影响分析、AST 级编辑，并注入编码工作流纪律（有界探索、任务分级、最小改动、DoD 自检）',
    toolNames: [...CODING_TOOL_NAMES],
  },
  {
    id: 'python',
    label: '数据分析（Python）',
    description: '在浏览器 Pyodide 环境执行 Python，支持 numpy / pandas',
    toolNames: [...PYTHON_TOOL_NAMES],
  },
  {
    id: 'web',
    label: '网页自动化',
    description:
      '网页截图、结构化提取与会话式交互（点击/输入/选择/跳转），经 Cottage Service 无头浏览器执行',
    toolNames: [...WEB_AUTOMATION_TOOL_NAMES],
  },
  {
    id: 'pdf',
    label: 'PDF 处理',
    description: '读取 PDF 文本与元数据，合并 / 拆分 / 从文本或 HTML 创建 PDF',
    toolNames: [...PDF_TOOL_NAMES],
  },
  {
    id: 'chart',
    label: '图表可视化',
    description: '生成 Mermaid 示意图（流程图/架构图/时序图）与 ECharts 数据图表，输出可预览 HTML',
    toolNames: [...CHART_TOOL_NAMES],
  },
  {
    id: 'imagegen',
    label: '图片生成',
    description:
      '文生图与图生图/编辑，调用生图厂商模型（OpenAI / OpenRouter / 智谱 / 通义万相 / 硅基流动 / 豆包等），结果保存到工作区并在对话中展示',
    toolNames: [...IMAGE_GEN_TOOL_NAMES],
  },
  {
    id: 'research',
    label: '深度研究',
    description:
      '多轮检索取证、交叉验证，产出带引用来源的结构化研究报告并落盘（复用联网/PDF/图表能力）',
    toolNames: [...DEEP_RESEARCH_TOOL_NAMES],
  },
  {
    id: 'tidy',
    label: '工作区整理',
    description:
      'AI 扫描工作区后给出归类/批量重命名方案，经用户确认后批量调整文件排布（先方案后落盘，内置保护区与冲突校验）',
    toolNames: [...WORKSPACE_TIDY_TOOL_NAMES],
  },
] as const;

export type OptionalToolGroupId = (typeof OPTIONAL_TOOL_GROUPS)[number]['id'];

export const optionalToolNamesForGroups = (
  groupIds: readonly OptionalToolGroupId[],
): string[] => {
  const names = new Set<string>();
  for (const group of OPTIONAL_TOOL_GROUPS) {
    if (groupIds.includes(group.id)) {
      for (const name of group.toolNames) names.add(name);
    }
  }
  return [...names];
};

export const optionalToolGroupsFromNames = (
  toolNames: readonly string[] | undefined,
): OptionalToolGroupId[] => {
  const set = new Set(toolNames ?? []);
  return OPTIONAL_TOOL_GROUPS.filter((g) =>
    g.toolNames.every((n) => set.has(n)),
  ).map((g) => g.id);
};

export const isOptionalToolEnabled = (
  enabledTools: readonly string[] | undefined,
  name: OptionalToolName,
): boolean => (enabledTools ?? []).includes(name);

export const capabilitiesForEnabledTools = (
  enabledTools: readonly string[] | undefined,
): Capability[] => {
  if (!enabledTools?.length) return [];
  return getCapabilityRegistry().listForTools(enabledTools);
};
