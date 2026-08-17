# cottage-service API

默认监听：`https://127.0.0.1:8787`（`COTTAGE_SERVICE_*` / 兼容 `LOCAL_AGENT_*` 环境变量）。

服务实现位于 `cottage-service-go/`；前端按同一套 HTTP 地址连接。运维与部署见 [部署 Cottage Service](/architecture/cottage-service-deploy) 与仓库内 README。以下为文档站点摘要。

## 健康与画像

### `GET /health`

健康检查。

### `GET /profiles`

返回浏览器画像与引擎列表，例如：

```json
{
  "profiles": ["chrome-win", "chrome-mac", "edge-win", "firefox-win"],
  "engines": ["bing", "duckduckgo", "baidu", "google"]
}
```

## 搜索

### `GET|POST /search`

| 字段 | 说明 |
|------|------|
| `q` / `query` | 关键词 |
| `engine` | duckduckgo / bing / baidu / google |
| `limit` | 1–10，默认 5 |
| `profile` | 可选画像 |

主引擎无结果时可自动降级其它引擎。

## 抓取

### `GET|POST /fetch`

| 字段 | 说明 |
|------|------|
| `url` | 目标 |
| `maxLength` | 正文截断 |
| `profile` / `referer` | 可选 |

HTML 转纯文本返回。

## HTTP 代理

### `POST /proxy`

转发到公网目标，剥离浏览器特征头。**服务端不注入 Key**；鉴权头由客户端传入。

## 截图与提取

### `/screenshot` · `/extract`

经本机浏览器（无头）渲染后截图或结构化提取（供 Agent 网页工具使用），由 rod 驱动。

## PDF 打印

### `POST /pdf`

将 `html` 字符串或 `url` 经无头浏览器 `Page.printToPDF` 输出 PDF（base64）。供 Agent `createPdfFromHtml` 使用。

请求体示例：`{ "html": "<!DOCTYPE html>...", "preferCSSPageSize": true }` 或 `{ "url": "https://..." }`。

会话内亦可：`POST /browser/pdf`（body：`sessionId`，可选 `landscape`）。

## 浏览器会话

### `/browser/*`

`open` / `click` / `type` / `select` / `navigate` / `screenshot` / `extract` / `pdf` / `close` 等，支撑网页自动化与 HTML 打印。

## Cookie

### `DELETE /cookies`

清空 Cookie jar；可带 `?host=`。

## TLS

默认 `auto` 使用持久化本机 CA 签发 HTTPS 服务证书。可从系统托盘菜单尝试把 CA 写入当前用户信任库；也可使用自定义证书或关闭 TLS（仅单机受信环境）。
