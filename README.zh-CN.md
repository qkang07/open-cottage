# Open Cottage

[English](README.md) · [简体中文](README.zh-CN.md)

> **直接开始聊天，或在已有本地文件夹里运行一个浏览器优先的 Agent。**

Open Cottage 可以直接创建浏览器内的聊天工作区，也可以在你授权后把本地文件夹变成 Agent 工作区。配置模型、按任务开启能力，再在结果写入前完成审阅。

**[打开官方 Demo](https://cottage.swimlions.com/) · [阅读官方文档](https://doc.cottage.swimlions.com/) · [Read in English](https://doc.cottage.swimlions.com/en/)**

不需要额外桌面客户端、迁移项目，也不强制依赖后端服务。聊天工作区把会话和生成文件保存在当前浏览器的 IndexedDB；本地文件夹工作区则把状态保存在所选目录的 `.cottage/` 下。两种模式的 API Key 都只保留在浏览器本地。

---

## 一套很小的本地工作流

|  | 组成 | 作用 |
|---|---|---|
| 01 | **浏览器** | 提供应用界面，以及无需选择目录即可使用的 IndexedDB 聊天工作区。 |
| 02 | **可选本地文件夹** | 授权后作为已有项目、资料和生成结果的工作区。 |
| 03 | **模型与能力** | 按任务选择，随后完成读写、生成和已开启工具的调用。 |

当任务确实需要更强的网页能力时，再连接可选的 Cottage Service，用于搜索、动态网页抓取、截图和浏览器自动化；普通本地文件、办公和编码工作不需要它。

### 一次任务如何进行

1. **选择工作区**：直接进入浏览器聊天工作区，或打开文件夹作为 Agent 的读写边界。
2. **配置模型与能力**：从基础文件能力开始，仅在需要时开启专项能力包。
3. **说明目标与限制**：用 `@` 引用工作区文件，明确输出路径和不能改动的范围。
4. **审阅结果**：查看工具活动、文件预览和暂存 diff；敏感操作会等待明确选择。

遇到跨多个文件或步骤的任务，可用计划模式先对齐范围、步骤、风险和验收，再批准执行；小问题和局部改动则直接使用对话模式。

---

## 让工作留在该在的位置

Open Cottage 的核心是明确的本地边界，而不是把项目迁移到远程平台。

- **文件留在你授权的目录中**：一个 Git 仓库、一组资料或一份客户交付物，都可以分别成为一个工作区。
- **不选文件夹也能开始**：固定聊天工作区把会话和生成文件保存在本站点的 IndexedDB，左下角会持续显示当前大小。
- **改动始终可核对**：预览文件、审阅暂存 diff、选择性应用写入，并明确允许或拒绝敏感动作。
- **你的选择清晰可见**：当前模型与能力集会显示在任务界面中；连接或模型列表加载失败时，不会静默替换已保存的配置。
- **工作区状态随工作保存**：重要项目备份时连同 `.cottage/` 一起复制，即可保留会话、附件和工作区配置。

版本历史 Beta 可按工作区显式开启，用于查看差异并恢复单个文件或较早的工作区状态。它默认关闭，是常规备份的补充，而不是替代。

---

## 能力按需开启

基础本地文件工作流始终可用。Capability Pack 只为当前任务开放专项工具；开启它不会移动或删除已有文件。

| 任务 | 按需开启 |
|---|---|
| 文档、PPT 与表格 | 办公文档 |
| 代码改造 | 代码改造 |
| 调研报告 | 深度研究；需要时搭配 PDF 处理和图表可视化 |
| PDF 与图表 | PDF 处理和图表可视化 |
| 工作区图片 | 图片生成 |
| 文件整理 | 工作区整理 |
| 动态网页、截图或浏览器流程 | 网页自动化 + Cottage Service |

也可按任务在工作区中安装外部 Capability Pack，或连接 MCP。先阅读[能力包说明](https://doc.cottage.swimlions.com/concepts/capability-packs)，了解其使用方式与安全边界。

---

## 直接开始，或打开真实文件夹

1. 在 Chrome 或 Edge 桌面版打开[官方 Demo](https://cottage.swimlions.com/)，或运行自行部署的实例。
2. 选择“直接开始聊天”进入浏览器工作区，或选择已有本地文件夹并确认浏览器授权。
3. 在 **设置 → 模型配置** 中添加模型提供商与 API Key。
4. 说明任务、目标输出和边界，再在同一工作区中审阅结果文件。

需要逐步完成第一项任务，请看[五分钟配置](https://doc.cottage.swimlions.com/guide/first-setup)。按场景可继续阅读[文档与表格](https://doc.cottage.swimlions.com/guide/use-office)、[代码改造](https://doc.cottage.swimlions.com/guide/use-coding)、[调研](https://doc.cottage.swimlions.com/guide/use-research)和[网页自动化](https://doc.cottage.swimlions.com/guide/use-web)。

---

## 自部署与开发

日常使用直接打开官方 Demo 即可。需要自行部署、扩展产品或运行可选伴随服务时，再使用本仓库。

| 目录 | 作用 | 技术栈 |
|---|---|---|
| [`frontend/`](frontend/) | 浏览器内的 Agent 容器与用户界面 | Vue 3 + Vite + Element Plus + AI SDK Core + Cottage Agent Runtime |
| [`cottage-service-go/`](cottage-service-go/) | 可选伴随服务：搜索、抓取、浏览器自动化与 LLM 代理 | Go + rod |
| [`doc-site/`](doc-site/) | 官方文档站点源码 | VitePress |

### 前置要求

- Node.js 20+ 与 pnpm（前端）
- Go 1.23+（仅运行 Cottage Service 时需要）
- 支持 IndexedDB 的现代桌面浏览器；打开本地文件夹时需使用支持 [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API) 的 Chrome 或 Edge
- HTTPS 安全上下文；开发服务器已配置 `basic-ssl`

### 启动前端

```powershell
# Windows
.\start.ps1
```

```bash
# macOS / Linux
bash start.sh
```

也可手动启动：

```bash
cd frontend
pnpm install
pnpm dev
```

默认访问地址为 `https://localhost:5176`；浏览器首次可能需要信任自签名证书。

### 仅在任务需要时启动 Cottage Service

```bash
cd cottage-service-go
go run .
```

默认监听 `https://127.0.0.1:8787`。启动后，在 **设置 → Cottage Service** 中连接；证书和部署细节见[部署 Cottage Service](https://doc.cottage.swimlions.com/architecture/cottage-service-deploy)。

---

## 安全、贡献与许可证

- 开始前确认打开的是正确工作区；Agent 只在该授权目录内工作。
- 将预览、暂存审阅、敏感操作确认和计划批准视为可靠 Agent 工作流的正常部分。
- 保留常规备份与版本控制；版本历史 Beta 不能替代它们。
- API Key 不会写入工作区；更换浏览器或设备后需重新配置，或在代理侧管理。

安全模型与漏洞报告方式见 [SECURITY.md](SECURITY.md)。欢迎贡献，开始前请阅读[贡献指南](https://doc.cottage.swimlions.com/architecture/contributing)。

Open Cottage 采用 [MIT License](LICENSE) 发布；0.x 阶段的公开功能、API 与数据格式仍可能演进。
