# 工具目录

本页说明当前产品会提供给 Agent 的**公开能力类别**，不把内部实现、已隐藏工具或未接入 UI 的流程当作产品功能。实际可用工具还会受工作区、当前能力包、模型和 Cottage Service 连接状态影响。

## 基础能力（始终可用）

| 类别 | 常用工具 | 说明 |
|------|----------|------|
| 浏览与读取 | `listFiles` `listDirectory` `findFiles` `searchFiles` `readFile` | 在工作区内定位和读取内容 |
| 文件变更 | `editFile` `patchFile` `applyPatch` `writeFile` `createFile` `rename` `copy` | 修改、创建、移动或复制文件 |
| 文件管理 | `mkdir` `compress` `extract` `deleteFiles` | 目录、压缩包与删除操作；删除支持批量（文件/文件夹递归），会按治理策略请求确认 |
| 联网 | `webSearch` `fetchWebPage` | 搜索和读取网页内容 |
| 协作 | `askUser` `loadTools` | 询问用户，或按需加载低频工具 |

## 按能力包启用

| 能力包 | 工具 |
|--------|------|
| 办公文档 | `readSpreadsheet` `writeSpreadsheet` `readWord` `writeWord` `readPresentation` `writePresentation` `editPresentation` `renderOfficeTemplate` `batchGenerateOfficeDocs` |
| 代码改造 | `searchSymbol` `findReferences` `analyzeImpact` `astEdit` `astCapabilities` |
| PDF 处理 | `readPdf` `mergePdfs` `splitPdf` `createPdf` `createPdfFromHtml` |
| 图表可视化 | `renderMermaid` `renderChart` |
| 图片生成 | `generateImage` `editImage` |
| 深度研究 | `saveResearchReport` |
| 工作区整理 | `applyTidyPlan` |
| 网页自动化 | `screenshotPage` `extractPage` `openBrowserPage` `clickElement` `typeText` `selectOption` `browserNavigate` `captureBrowserPage` `closeBrowserPage` |

网页自动化依赖已连接且具备相应能力的 Cottage Service；图片生成依赖已配置的生图厂商。

`writePresentation` 默认兼容历史输入和 V2 语义版式；V3 通过 `version: 3` + `pipeline: "html-layout"` 启用“HTML/CSS 浏览器测量 → `PresentationScene` → 原生 PPTX”的编译流水线。支持动态页面尺寸、6 套主题、基础组件与矩阵/漏斗/路线图/层级/图文拼版等常用模块；只有显式标记的装饰元素允许局部 SVG/PNG 降级，核心内容保持原生可编辑。`draftOnly` 会把 HTML、CSS、binding、测量 Scene 和警告保存到 `.cottage/presentations/<draftId>/`，随后可用 `sourceDraftId` 生成最终文件。

`readPresentation(includeElements=true)` 返回稳定元素 ID、边界、文字以及表格/图表摘要；按需打开 `includeStyleProfile/includeLayouts/includeMasters/includeSourceManifest` 可读取参考 PPT 的页面尺寸、主题、母版/版式和源稿状态。`referenceMode` 支持 `content-only`、`inspiration`、`match-style`、`native-template`。`editPresentation` 原位修改常用对象并保留未涉及的 OOXML 部件，同时返回 `sourceManifestStatus`；复杂 PowerPoint 私有对象保持只读，预览为设计稿/元素结构/导出结构三种近似视图。

## 计划模式

| 工具 | 说明 |
|------|------|
| `suggestPlanMode` | 建议用户确认切换到统一计划模式 |
| `submitPlan` | 提交带路径范围、步骤依赖、预算和验收标准的版本化计划 |
| `completePlanStep` / `blockPlanStep` | 提交步骤证据，或记录阻塞并暂停 |
| `requestPlanRevision` | 请求新的 revision，并等待用户重新批准 |
| `completePlanRun` / `failPlanRun` | 汇总验证并请求完成，或保留现场并记录失败 |
| `dispatchPlanResearch` | 在研究或验证步骤中派生最多 3 个临时只读研究执行器 |

旧 `Spec` 消息只作为历史记录显示，并可复制为新的 Plan；`suggestSpec`、`submitSpec` 等旧工具不属于当前公开计划流程。

工具风险和参数以产品运行时提示为准。想了解怎么开启能力，请看 [能力总览](/packs/)；想按任务跟做，请看 [使用指南](/guide/introduction)。
