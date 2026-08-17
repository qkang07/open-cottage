# 安全策略

Open Cottage 在浏览器里运行 Agent，会读写你授权的本地目录、在 Web Worker 内执行 Agent 生成的脚本、可调用本地 Cottage Service 与外部 LLM API。本文说明安全模型与漏洞上报方式。

## 支持版本

项目处于早期开发（`0.x`），安全修复只针对最新的 `main` 与最近一次 release。

## 安全模型

### 数据本地优先

- 工作空间内的所有数据（对话历史、任务状态、索引、配置）落在你选定目录的 `.cottage/` 中，**不自动上传**到任何服务器。
- 工作区外的文件**不可访问**：文件操作受 File System Access API 授权范围限制，路径会做 `normalizePath` 校验，禁止 `..` 越界。

### API Key 存储

- 各 LLM 厂商 API Key 仅存于浏览器 **IndexedDB**（库名 `open-cottage-secrets`），**不进入**工作空间目录、不写入 `.cottage/config.json`、不上传。
- 若使用 `llm-proxy`，Key 可改为在代理侧注入，浏览器端留空。

### 权限闸门

- **Policy Engine**：工具调用前按风险级别（`read` / `write` / `external` / `destructive`）判定；默认 `destructive` 操作（删除等）需用户在对话中点击「允许 / 拒绝」审批，拒绝则把「被策略阻止」结果回传模型而非真正执行。
- 可在设置页调整 `governance.requireApprovalFor` 提升或降低审批级别。

更严格的 Plan Gate 属于当前保留的隐藏治理能力，不应作为公开版本的默认安全边界；其状态见 `docs/hidden-features.md`。

### 脚本执行

- `runScript` 在 **Web Worker** 内通过 `new Function` 执行 Agent 生成或用户编写的 JS。
- Worker 内**禁止**直接访问 DOM 与主线程变量；所有文件 IO 经 `postMessage` RPC 回主线程完成。
- **这不是强隔离沙箱**：恶意脚本仍可耗尽 CPU / 内存 / 存储，或通过 RPC 读写授权目录内任意文件。因此 `runScript` 只适合执行**受信来源**的代码（你自己写的、或你在审批后同意 Agent 执行的）。
- Pyodide（`runPython`）在独立 WASM 运行时内执行，文件访问同样经主线程 RPC。

### Cottage Service

- 默认仅监听 `127.0.0.1`，不对外暴露。
- 默认 `COTTAGE_SERVICE_TLS_MODE=auto` 生成自签名证书启用 HTTPS；如关闭 TLS 走 HTTP，请确保仅在单机受信环境。
- 启用 CORS 以便本地前端直连；部署到非本地环境前请收紧 CORS 与监听地址。

### LLM 反向代理（llm-proxy）

- 用于在服务端注入 API Key、解决 CORS 与厂商特化。
- 默认 CORS `origin: '*'`，便于本地开发；**生产部署前请收紧**到具体来源。
- 切勿把含真实 Key 的 `.env` 提交到仓库。

### 浏览器与传输

- 依赖 HTTPS（File System Access API 要求安全上下文）。开发用 Vite 自带 `basic-ssl` 自签名证书，浏览器首次需手动信任。
- 与 LLM 厂商 API 的连接走厂商官方 HTTPS 端点；经 `llm-proxy` 时走你自己的部署。

## 已知限制

| 项 | 说明 |
|----|------|
| Worker 脚本非强隔离 | 见上「脚本执行」；不要让 Agent 自动执行来历不明的脚本，审批提示出现时请谨慎。 |
| 浏览器 CORS | 直连抓取网页常失败，需经 Cottage Service 或代理；这是浏览器同源策略，非本项目漏洞。 |
| 自签名证书 | 开发环境证书未被 CA 信任，需手动信任；切勿在生产环境复用开发证书。 |
| 单任务并发 | 全局仅允许一个 `running` 任务，避免并发写冲突。 |

## 上报漏洞

如果你发现安全漏洞，请**不要**在公开 issue 中提交，按以下方式私下上报：

- 私下联系维护者（邮箱待补充，开源后填入）
- 或在邮件中描述：影响范围、复现步骤、建议修复方向

我们承诺在合理时间内回复并协调披露。在修复发布前，请勿公开披露漏洞细节。

## 责任披露

- 我们感谢任何负责任的安全报告。
- 报告者若希望，会在致谢列表中署名（待补充）。
