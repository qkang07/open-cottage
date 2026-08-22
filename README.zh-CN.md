# Open Cottage

[English](README.md) · [简体中文](README.zh-CN.md)

> **在你自己的文件夹里，把自然语言意图变成可查看、可审批、可验收的结果。**

Open Cottage 是一个浏览器优先的本地文件夹 Agent。使用 Chrome 或 Edge 选择已有文件夹作为工作区，配置模型后，便可在这个边界内阅读材料、生成或修改文件，并在预览、diff 和确认步骤中核对结果。

**官方入口：[在线 Demo](https://cottage.swimlions.com/) · [官方文档](https://doc.cottage.swimlions.com/)**

它不要求把项目或资料迁移到云端平台：浏览器负责界面和目录授权，原有本地文件夹仍是工作区；会话、附件和工作区配置保存在该文件夹的 `.cottage/` 目录中，方便随项目一起备份。

---

## 它如何工作

1. **打开一个本地文件夹**：该目录就是 Agent 的读写边界。
2. **选择模型与所需能力**：先接入可用模型，再只打开本次任务需要的能力包。
3. **说明目标和限制**：可以用 `@` 引用工作区文件，明确输出路径与不应改动的范围。
4. **审阅并验收结果**：查看工具调用、暂存 diff 和文件预览；危险操作会等待你的确认。

小任务可以直接在对话模式中完成。跨多个文件、步骤或能力的任务可切换到计划模式，先生成并批准计划，再在同一会话中继续执行。

---

## 当前公开功能

| 能力 | 说明 |
|------|------|
| 本地文件夹工作区 | 通过浏览器目录授权在指定文件夹内工作；会话、附件、工作区配置与外部能力包随 `.cottage/` 保存，API Key 保留在浏览器本地。 |
| 对话与计划模式 | 对话模式适合问答和小改动；计划模式用于先对齐范围、步骤和验收，再批准执行复杂任务。 |
| 文件、预览与上下文 | 文件树、文本/文档预览、`@` 文件引用和附件，让已有材料与交付结果都留在同一工作区。 |
| 暂存审阅与确认 | 写入可先进入暂存区供你查看 diff、逐项应用或丢弃；删除等危险动作会暂停等待允许或拒绝。 |
| 版本历史 Beta | 可为单个工作区显式开启，查看差异、恢复文件或较早的工作区状态；默认关闭，重要内容仍应自行备份。 |
| 能力包与扩展 | 基础文件能力始终可用；领域能力可按任务开启，也可安装外部 Capability Pack 或按需连接 MCP。 |

### 内置能力包

| 场景 | 可按需开启的能力 |
|------|------|
| 文档与资料 | 办公文档、PDF 处理、图表可视化、图片生成、深度研究 |
| 代码与工作区 | 代码改造、工作区整理 |
| 网页任务 | 网页自动化；需要连接 Cottage Service 才可进行截图、动态页面提取和多步交互 |

能力包只是为下一轮对话开放对应工具，不会移动或删除既有文件；不需要时可以关闭。完整说明与操作示例请见[官方文档的能力包介绍](https://doc.cottage.swimlions.com/concepts/capability-packs)。

### Cottage Service（可选）

Open Cottage 的 Agent 和工作区仍在浏览器中。需要更稳定的搜索与抓取、无头浏览器、网页截图或自动化时，可以连接本机或指定机器上的 Cottage Service；普通本地文件、办公和编码任务不以它为前提。详见 [Cottage Service 说明](https://doc.cottage.swimlions.com/concepts/cottage-service-concepts)。

---

## 开始使用

1. 在 Chrome 或 Edge 桌面版打开[官方 Demo](https://cottage.swimlions.com)，或运行自行部署的实例。
2. 选择一个已有的本地文件夹，并授予浏览器访问权限。
3. 在设置中配置模型和 API Key；按任务打开所需能力包。
4. 用自然语言说明目标、输出位置与边界，然后预览并确认生成或修改的文件。

需要逐步指引、场景示例和安全说明，请访问[官方文档](https://doc.cottage.swimlions.com)。

---

## 仓库结构

| 目录 | 说明 | 技术栈 |
|------|------|--------|
| [`frontend/`](frontend/) | 浏览器内的 Agent 容器与用户界面 | Vue 3 + Vite + Element Plus + AI SDK Core + Cottage Agent Runtime |
| [`cottage-service-go/`](cottage-service-go/) | 可选伴随服务：搜索、抓取、浏览器自动化与 LLM 代理 | Go + rod |
| [`doc-site/`](doc-site/) | 官方文档站点源码 | VitePress |

开发实现可从 [frontend 架构说明](frontend/ARCHITECTURE.md)、[frontend 子包说明](frontend/README.md) 和 [Cottage Service README](cottage-service-go/README.md) 开始。

---

## 本地开发与启动

本节面向需要自行部署、连接配套服务或参与开发的用户；日常使用可以直接打开官方 Demo。

### 前置要求

- Node.js ≥ 20 与 pnpm（frontend）
- Go ≥ 1.23（仅在运行 Cottage Service 时需要）
- 支持 [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API) 的 Chromium 浏览器，例如 Chrome 或 Edge 桌面版
- HTTPS 安全上下文（开发服务器已配置 basic-ssl）

### 启动前端

```powershell
# Windows：安装 frontend 依赖并启动开发服务器
.\start.ps1
```

```bash
# macOS / Linux
bash start.sh
```

也可以手动启动：

```bash
cd frontend
pnpm install
pnpm dev
```

开发服务器默认访问地址为 `https://localhost:5176`；浏览器首次可能需要信任自签名证书。

### 按需启动 Cottage Service

只有搜索、动态网页或网页自动化等任务需要它：

```bash
cd cottage-service-go
go run .
```

默认服务地址为 `https://127.0.0.1:8787`。启动后，在 Open Cottage 的 **设置 → Cottage Service** 中连接；证书和部署细节请见[官方文档](https://doc.cottage.swimlions.com/architecture/cottage-service-deploy)。

---

## 安全与数据

- Agent 只在你授权的工作区范围内读写；开始前请确认选择的是正确目录。
- 暂存审阅、危险操作确认和计划批准用于让改动保持可见、可控。
- `.cottage/` 保存工作区状态；备份重要工作时请连同它一起复制。API Key 不写入工作区，换浏览器或换设备需要重新配置，或改由代理侧管理。
- 版本历史为 Beta，不能代替你的常规备份策略。

详细安全模型与漏洞报告方式请见 [SECURITY.md](SECURITY.md)。

---

## 贡献

欢迎提交 issue、改进文档或贡献能力包。提交前请先阅读相应子项目和[官方开发文档](https://doc.cottage.swimlions.com/architecture/contributing)。

## License

本项目采用 **MIT** License，见 [LICENSE](LICENSE)。贡献内容在相同 license 下授权。

---

*项目状态：0.x。公开功能、API 与数据格式仍可能演进。*


