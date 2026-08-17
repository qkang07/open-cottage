import type { CapabilityRiskLevel } from '../platform/capabilities/types';

/**
 * 工具名 → 简短说明，仅用于设置界面（能力包详情）展示。
 * 与各工具实际 description 保持一致的精简版本。
 */
export const TOOL_DESCRIPTIONS: Record<string, string> = {
  // 基础文件操作
  listFiles: '递归列出工作空间内文件路径（相对路径，默认截断）。',
  listDirectory: '列出单个目录的直接子项（非递归）。根目录省略 path，勿传 "."。',
  exists: '检查路径是否存在，并返回 kind。',
  statFile: '获取文件/目录元信息（size、modified 等）。',
  hashFile: '计算文件内容的 SHA-256 hash，用于判断两个文件是否完全相同。',
  getDirectorySize: '统计目录递归总字节数与文件/子目录数。',
  readFile: '读取纯文本文件内容（支持 offset/limit 分段）。',
  readMany: '批量读取多个纯文本小文件。',
  findFiles: '按 glob 模式查找文件路径（支持 **、*、?、{a,b}）。',
  searchFiles:
    '在纯文本文件内按内容搜索（类似 grep）；支持 path/extensions 限定。',
  diffFiles: '对比两个纯文本文件，返回 unified diff。',
  patchFile: '局部修改文件（支持 lines / columns / regex）。',
  applyPatch: '应用 unified diff（可多文件；支持新建/删除）。',
  editFile: '通过“精确查找-替换”编辑已存在文件，行号无关、更可靠。',
  writeFile: '写入或覆盖工作空间中的文件。',
  createFile: '在工作空间中新建文件。',
  appendFile: '在文件末尾追加文本（不存在则创建）。',
  touch: '确保文件存在（不存在则创建空文件）。',
  deleteFiles: '删除文件或文件夹（递归），支持批量。',
  mkdir: '创建目录（支持嵌套路径）。',
  rename: '重命名或移动文件/文件夹。',
  move: '移动或重命名文件/文件夹。',
  copy: '复制文件或目录树（不删除源）。',
  copyPaths: '批量复制文件或目录。',
  compress: '将多个路径压缩为 zip。',
  extract: '解压工作空间内的 zip。',
  runScript: '在隔离 Worker 中执行 JS 脚本处理数据；脚本内可经 cottage.<工具名>() 调用其他 agent 工具做批量/组合操作。',
  loadTools: '加载延后工具的 skill 并在本回合启用（类似技能按需读取）。',

  // 联网
  webSearch: '在互联网上搜索信息，返回摘要与链接。',
  fetchWebPage: '抓取并解析指定 URL 的网页正文。',

  // 办公文档
  readSpreadsheet: '读取 xlsx/xls/csv 表格（可用 spreadsheetRange 限定区域）。',
  writeSpreadsheet: '写入表格单元格（patch 局部 / replace 整表，支持表头样式）。',
  readWord: '读取 Word 文档段落内容。',
  readPresentation: '读取 PPT 幻灯片文本内容。',
  writeWord: '写入带样式的 Word（blocks + theme；支持标题/列表/表格/图/页眉页脚）。',
  writePresentation: '写入或编辑 PPT 幻灯片（replace / patch），支持主题预设与版式配色。',
  renderOfficeTemplate: '按 {{变量}} 渲染办公模板生成文档。',
  batchGenerateOfficeDocs: '按变量集批量生成办公文档。',

  // 代码符号
  searchSymbol: '按符号名搜索定义（函数 / 类 / 组件 / 类型）。',
  findReferences: '查询某符号的引用位置列表。',
  analyzeImpact: '改前影响分析：按文件聚合符号引用，输出受影响文件数与调用点总数。',
  astEdit: 'AST 级编辑（rename/import/insert/props 默认值），dryRun 默认仅返回 diff。',
  astCapabilities: '查询某文件支持的 AST 操作（零加载）。',

  // 数据分析
  runPython: '在浏览器 Pyodide 中执行 Python（numpy / pandas 等）。',

  // 网页自动化
  screenshotPage: '对网页截图并保存到工作区（经无头浏览器渲染）。',
  extractPage: '结构化提取网页正文、标题、元数据与链接。',
  openBrowserPage: '打开交互式浏览器会话，返回 sessionId。',
  clickElement: '在浏览器会话内点击元素（CSS 选择器/文本兜底）。',
  typeText: '在浏览器会话内向输入框填写文本。',
  selectOption: '在浏览器会话内选择下拉框选项。',
  browserNavigate: '在浏览器会话内跳转到新 URL。',
  captureBrowserPage: '对当前会话页面截图并保存。',
  closeBrowserPage: '关闭浏览器会话释放资源。',

  // PDF 处理
  readPdf: '提取 PDF 每页文本、页数与元数据。',
  mergePdfs: '按顺序合并多个 PDF 为一个新文件。',
  splitPdf: '按页码区间拆分为一个或多个 PDF。',
  createPdf: '从标题与文本行创建简单 PDF（支持中文）。',
  createPdfFromHtml: '将 HTML/URL 经本地服务打印为 PDF。',

  // 图表可视化
  renderMermaid: '生成 Mermaid 示意图（流程图/时序图等），输出 HTML。',
  renderChart: '生成 ECharts 数据图表（柱状/折线/饼图等），输出 HTML。',

  // 图片生成
  generateImage: '根据文字描述生成图片（文生图），保存到工作区并注入对话。',
  editImage: '基于工作区已有图片做图生图/编辑，结果保存到工作区并注入对话。',

  // 深度研究
  saveResearchReport: '将带引用来源的研究报告落盘为 Markdown。',

  // 工作区整理
  applyTidyPlan: '批量落盘工作区整理方案（移动/新建目录），支持 dryRun 预检。',

  // 对话编排与任务
  askUser: '向用户提问并等待用户选择或文字回答。',
  submitExecutionPlan: '提交本回合执行计划（满足计划闸门后才可继续高风险工具）。',
  taskSetPlan: '更新任务执行计划步骤。',
  taskComplete: '声明任务完成并提交交付清单。',
  submitDeliverableCanvas: '提交结构化 canvas 交付物（表格/待办/Markdown）。',
  taskFail: '声明任务无法完成并说明原因。',
  cottage_startOrchestration: '启动编排模式，将复杂目标拆分为多步骤执行。',
  suggestSpec: '建议进入计划模式，先制定可批准计划再逐任务执行。',
  submitSpec: '提交五段式计划文档供用户批准。',
  specUpdateTask: '更新计划任务清单中某项的状态。',
  specComplete: '标记计划全部任务完成。',
  specFail: '声明计划执行失败并说明原因。',
  suggestPlanMode: '建议用户确认切换到统一计划模式。',
  submitPlan: '提交版本化计划、路径范围与验收标准供用户批准。',
  completePlanStep: '提交计划步骤的实现证据并运行可用验证器。',
  blockPlanStep: '记录步骤阻塞并暂停计划。',
  requestPlanRevision: '暂停执行并请求批准新的计划版本。',
  completePlanRun: '请求汇总验证并完成计划。',
  failPlanRun: '声明计划无法继续并保留现有修改。',
  dispatchPlanResearch: '并行派生临时只读研究执行器。',
  orch_reportArtifact: '向编排器上报当前步骤产物。',
  orch_completeStep: '声明编排步骤已完成。',
  orch_failStep: '声明编排步骤失败并说明原因。',
  orch_askHuman: '向用户提问以获取编排步骤所需信息。',

  // 其他内置能力
  searchWorkspaceSemantic: '按语义检索工作区中与查询“意思相近”的片段。',

  // 图片附件
  viewImage: '查看工作区内的图片文件，图片注入对话供模型直接观察。',
  saveChatAttachment: '把聊天中的图片附件保存到工作区指定路径。',
};

export const describeTool = (name: string): string | undefined =>
  TOOL_DESCRIPTIONS[name];

/**
 * 工具名 → 本地化别名（用于聊天窗口展示）。
 * 未配置时回退到原始工具名。
 */
export const TOOL_LOCALE_ALIASES: Record<string, string> = {
  // 基础文件操作
  listFiles: '列出文件',
  listDirectory: '列出目录',
  exists: '检查存在',
  statFile: '文件信息',
  hashFile: '文件哈希',
  getDirectorySize: '目录大小',
  readFile: '读取文件',
  readMany: '批量读取',
  findFiles: '查找文件',
  searchFiles: '搜索内容',
  diffFiles: '对比文件',
  patchFile: '补丁修改',
  applyPatch: '应用 Diff',
  editFile: '精准替换',
  writeFile: '写入文件',
  createFile: '新建文件',
  appendFile: '追加写入',
  touch: '确保存在',
  deleteFiles: '删除',
  mkdir: '创建目录',
  rename: '重命名/移动',
  move: '移动',
  copy: '复制',
  copyPaths: '批量复制',
  compress: '压缩文件',
  extract: '解压文件',
  runScript: '运行脚本',
  loadTools: '加载工具',

  // 联网
  webSearch: '网页搜索',
  fetchWebPage: '抓取网页',

  // 办公文档
  readSpreadsheet: '读取表格',
  writeSpreadsheet: '写入表格',
  readWord: '读取 Word',
  readPresentation: '读取 PPT',
  writeWord: '写入 Word',
  writePresentation: '写入 PPT',
  renderOfficeTemplate: '渲染办公模板',
  batchGenerateOfficeDocs: '批量生成文档',

  // 代码与数据
  searchSymbol: '搜索符号',
  findReferences: '查找引用',
  analyzeImpact: '影响分析',
  astEdit: 'AST 编辑',
  astCapabilities: 'AST 能力',
  runPython: '运行 Python',
  searchWorkspaceSemantic: '语义检索',

  // 网页自动化
  screenshotPage: '网页截图',
  extractPage: '提取网页',
  openBrowserPage: '打开浏览器',
  clickElement: '点击元素',
  typeText: '输入文本',
  selectOption: '选择选项',
  browserNavigate: '页面跳转',
  captureBrowserPage: '会话截图',
  closeBrowserPage: '关闭浏览器',

  // PDF 处理
  readPdf: '读取 PDF',
  mergePdfs: '合并 PDF',
  splitPdf: '拆分 PDF',
  createPdf: '创建 PDF',
  createPdfFromHtml: 'HTML 转 PDF',

  // 图表可视化
  renderMermaid: 'Mermaid 示意图',
  renderChart: 'ECharts 图表',

  // 图片生成
  generateImage: '文生图',
  editImage: '图生图/编辑',

  // 深度研究
  saveResearchReport: '保存研究报告',

  // 工作区整理
  applyTidyPlan: '执行整理方案',

  // 历史与交互
  askUser: '询问用户',
  submitExecutionPlan: '提交执行计划',

  // 任务
  taskSetPlan: '设置任务计划',
  taskComplete: '标记任务完成',
  submitDeliverableCanvas: 'Canvas 交付物',
  taskFail: '标记任务失败',

  // 编排
  cottage_startOrchestration: '启动编排',
  suggestSpec: '建议计划模式',
  submitSpec: '提交计划',
  specUpdateTask: '更新计划任务',
  specComplete: '计划完成',
  specFail: '计划失败',
  suggestPlanMode: '建议计划模式',
  submitPlan: '提交计划版本',
  completePlanStep: '完成计划步骤',
  blockPlanStep: '阻塞计划步骤',
  requestPlanRevision: '请求修订计划',
  completePlanRun: '完成计划',
  failPlanRun: '计划失败',
  dispatchPlanResearch: '并行只读研究',
  orch_reportArtifact: '上报产物',
  orch_completeStep: '完成步骤',
  orch_failStep: '步骤失败',
  orch_askHuman: '询问用户（编排）',

  // 图片附件
  viewImage: '查看图片',
  saveChatAttachment: '保存附件',
};

export const toolLocaleAlias = (name: string): string =>
  TOOL_LOCALE_ALIASES[name] ?? name;

/**
 * 工具名 → 风险等级，仅用于设置界面展示与治理参考。
 * read 只读 / write 写入 / external 外部访问 / destructive 破坏性。
 */
export const TOOL_RISK: Record<string, CapabilityRiskLevel> = {
  // 基础文件操作
  listFiles: 'read',
  listDirectory: 'read',
  exists: 'read',
  statFile: 'read',
  hashFile: 'read',
  getDirectorySize: 'read',
  readFile: 'read',
  readMany: 'read',
  findFiles: 'read',
  searchFiles: 'read',
  diffFiles: 'read',
  editFile: 'write',
  patchFile: 'write',
  applyPatch: 'write',
  writeFile: 'write',
  createFile: 'write',
  appendFile: 'write',
  touch: 'write',
  deleteFiles: 'destructive',
  mkdir: 'write',
  rename: 'destructive',
  move: 'destructive',
  copy: 'write',
  copyPaths: 'write',
  compress: 'write',
  extract: 'write',
  runScript: 'write',
  loadTools: 'read',

  // 联网
  webSearch: 'external',
  fetchWebPage: 'external',

  // 图片附件
  viewImage: 'read',
  saveChatAttachment: 'write',

  // 办公文档
  readSpreadsheet: 'read',
  writeSpreadsheet: 'write',
  readWord: 'read',
  readPresentation: 'read',
  writeWord: 'write',
  writePresentation: 'write',
  renderOfficeTemplate: 'write',
  batchGenerateOfficeDocs: 'write',

  // 代码符号
  searchSymbol: 'read',
  findReferences: 'read',
  analyzeImpact: 'read',
  astCapabilities: 'read',
  astEdit: 'write',

  // 数据分析
  runPython: 'write',

  // 网页自动化
  screenshotPage: 'external',
  extractPage: 'external',
  openBrowserPage: 'external',
  clickElement: 'external',
  typeText: 'external',
  selectOption: 'external',
  browserNavigate: 'external',
  captureBrowserPage: 'external',
  closeBrowserPage: 'external',

  // PDF 处理
  readPdf: 'read',
  mergePdfs: 'write',
  splitPdf: 'write',
  createPdf: 'write',
  createPdfFromHtml: 'write',

  // 图表可视化
  renderMermaid: 'write',
  renderChart: 'write',

  // 图片生成
  generateImage: 'external',
  editImage: 'external',

  // 深度研究
  saveResearchReport: 'write',

  // 工作区整理
  applyTidyPlan: 'destructive',
};

export const toolRisk = (name: string): CapabilityRiskLevel | undefined =>
  TOOL_RISK[name];
