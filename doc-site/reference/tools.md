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
| 办公文档 | `readSpreadsheet` `writeSpreadsheet` `readWord` `writeWord` `readPresentation` `writePresentation` `renderOfficeTemplate` `batchGenerateOfficeDocs` |
| 代码改造 | `searchSymbol` `findReferences` `analyzeImpact` `astEdit` `astCapabilities` |
| PDF 处理 | `readPdf` `mergePdfs` `splitPdf` `createPdf` `createPdfFromHtml` |
| 图表可视化 | `renderMermaid` `renderChart` |
| 图片生成 | `generateImage` `editImage` |
| 深度研究 | `saveResearchReport` |
| 工作区整理 | `applyTidyPlan` |
| 网页自动化 | `screenshotPage` `extractPage` `openBrowserPage` `clickElement` `typeText` `selectOption` `browserNavigate` `captureBrowserPage` `closeBrowserPage` |

网页自动化依赖已连接且具备相应能力的 Cottage Service；图片生成依赖已配置的生图厂商。

## 计划模式（Spec）

| 工具 | 说明 |
|------|------|
| `suggestSpec` | 建议进入计划模式 |
| `submitSpec` | 提交可审阅的计划 |
| `specUpdateTask` | 更新计划任务状态 |
| `specComplete` / `specFail` | 标记计划完成或失败 |

工具风险和参数以产品运行时提示为准。想了解怎么开启能力，请看 [能力总览](/packs/)；想按任务跟做，请看 [使用指南](/guide/introduction)。
