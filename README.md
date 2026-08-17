# Open Cottage

> **在你自己的浏览器里，把自然语言意图稳定地变成可验证的结果。**
>
> English tagline: _Trustworthy work completion in your own environment._

Open Cottage 是一个 **以本地文件夹为工作空间、以浏览器为第一层容器** 的通用 Agent 平台。你选定一个本地目录后，Agent 在其中读写文件、生成文档/表格/幻灯片、改造代码、联网搜索，并交付**可核对的结果**——不是只聊天。

- **本地优先**：所有项目数据落在工作空间内的 `.cottage/` 目录，随工作区可备份、可迁移。
- **可信任**：API Key 仅存浏览器 IndexedDB；破坏性操作有 Policy 审批闸门；改前先出 Plan。
- **可插拔**：Platform Core + Domain Pack 架构，办公 / 编程 / 数据分析 是可独立启停的能力包。
- **通用**：同一套编排轨道服务多种任务类型，不绑死在编程场景。

> 截图占位（待补充）


<!-- 主界面截图 -->
<!-- ![主界面](docs/images/main-ui.png) -->

> 运行演示 GIF（待补充）

<!-- ![演示](docs/images/demo.gif) -->

---

## 开始使用

Open Cottage 将提供可直接体验的官方 Demo；它是纯前端应用，无需安装客户端、Node.js 或 Go。高级用法可通过本仓库源码自行部署。

官方 Demo 与开源仓库的公开地址统一维护在文档站 `.vitepress/site-links.mjs`；地址发布前不展示空链接。

1. 在官方 Demo 或自行部署的实例中使用 Chrome / Edge 桌面版
2. 选择一个本地文件夹作为工作区
3. 在设置中配置模型和 API Key，并按任务开启所需能力包

详细步骤请见[官方使用指南](doc-site/guide/introduction.md)。如需自行运行站点或参与开发，请阅读下方的「本地开发与启动」。

---

## 仓库结构

| 目录 | 说明 | 技术栈 |
|------|------|--------|
| [`frontend/`](frontend/) | 主应用：浏览器内的 Agent 容器与人机界面 | Vue 3 + Vite 6 + Element Plus + AI SDK Core + Cottage Agent Runtime |
| [`cottage-service-go/`](cottage-service-go/) | Cottage Service 伴随服务（搜索、抓取、浏览器自动化、LLM 代理） | Go + rod |
| [`llm-proxy/`](llm-proxy/) | 可选的 LLM 反向代理：统一注入 API Key、处理 CORS、厂商特化 | Node.js + Express |
| [`docs/`](docs/) | 设计白皮书、路线图与开源准备清单 | Markdown |
| [`doc-site/`](doc-site/) | 官方文档站点（产品介绍与使用手册） | VitePress |

详见 [ARCHITECTURE](frontend/ARCHITECTURE.md) 与 [docs/](docs/)。

---

## 本地开发与启动

本节面向需要在本机运行 Open Cottage、部署配套服务或参与开发的用户。日常使用无需执行以下安装和启动步骤。

### 前置要求

- **Node.js ≥ 20** 与 **pnpm**（frontend）
- **Go ≥ 1.23**（Cottage Service，可选）
- 支持 [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API) 的 Chromium 系浏览器（Chrome / Edge 桌面版）
- HTTPS 环境（FSA API 要求安全上下文，开发用 Vite 自带 basic-ssl）

### 一键启动（推荐）

安装依赖并启动 frontend：

```powershell
# Windows
.\start.ps1
```

```bash
# macOS / Linux
bash start.sh
```

启动后访问 `https://localhost:5176`，按 `Ctrl+C` 停止所有服务。

### 分步启动

#### 1. 启动 frontend

```bash
cd frontend
pnpm install
pnpm dev
```

默认在 `https://localhost:5176`（自签名证书，浏览器首次需信任）。

#### 2.（可选）启动 Cottage Service

如果你想让 Agent 用本地服务做网页搜索聚合，而非浏览器直连：

```bash
cd cottage-service-go
go run .             # 默认 https://127.0.0.1:8787
```

#### 3.（可选）启动 llm-proxy

如果你不想把各厂商 API Key 留在浏览器，或需要解决 CORS：

```bash
cd llm-proxy
npm install
npm start            # 默认 http://localhost:3111
```

复制 [`llm-proxy/.env.example`](llm-proxy/.env.example) 为 `.env` 并填入所需的厂商 Key。配置后 frontend 设置里就无需再填 Key。

### 首次使用

1. 打开 `https://localhost:5176`，选择一个本地文件夹作为工作空间。
2. 点击右上角 **设置**，选择 LLM 提供商并填入 API Key（或配置 proxy 后留空）。
3. 从下拉框选择模型。
4. 在 **对话** 模式手动协作，或切到 **计划** 模式先批准结构化计划再连续执行。

---

## 使用模式

| 模式 | 说明 |
|------|------|
| **对话（chat）** | 手动发消息，Agent 按需调用工具；支持多会话与历史切换。 |
| **计划（spec）** | 先起草可批准计划，再同一会话内按任务连续执行。 |

---

## 能力包（Capability Pack）

Open Cottage 的领域能力以**可启停的包**组织，在聊天框「模型与能力」面板开关（领域包默认关闭）：

- **office**：Word / PPT / 表格读写、模板渲染、批量生成
- **coding**：TS / Vue 符号索引、改前影响分析、AST 级编辑、编码工作流纪律
- **pdf** / **chart** / **deep-research** / **web-automation**：PDF、图表、深度研究、网页自动化（后者需 Cottage Service）

也可以通过 `manifest.json` 安装外部包到 `.cottage/packs/{id}/`。完整说明见 [官方文档站点](doc-site/)。

---

## 文档

| 文档 | 内容 |
|------|------|
| **[doc-site/](doc-site/)** | **官方站点**：产品介绍、使用指南、能力包与 API 参考（VitePress） |
| [frontend/ARCHITECTURE.md](frontend/ARCHITECTURE.md) | 架构与实现细节 |
| [docs/platform-vision-and-roadmap.md](docs/platform-vision-and-roadmap.md) | 平台愿景、设计原则与路线图（设计白皮书） |
| [docs/open-source-checklist.md](docs/open-source-checklist.md) | 开源准备进度清单 |
| [frontend/README.md](frontend/README.md) | frontend 子包说明 |
| [cottage-service-go/README.md](cottage-service-go/README.md) | Cottage Service API 与配置 |

本地预览官方文档：

```bash
cd doc-site
pnpm install
pnpm run dev
```

---

## 安全

本项目会读写你授权的本地目录、在 Web Worker 内执行 Agent 生成的脚本、可调用本地伴随服务与外部 LLM API。请阅读 [SECURITY.md](SECURITY.md) 了解安全模型与漏洞上报方式。

---

## 贡献

欢迎 issue 反馈与能力包贡献。

---

## License

本项目采用 **MIT** License，见 [LICENSE](LICENSE)。贡献内容在相同 license 下授权。

---

*项目状态：早期开发中（`0.x`），API 与数据格式可能在 minor 版本内变动。*
