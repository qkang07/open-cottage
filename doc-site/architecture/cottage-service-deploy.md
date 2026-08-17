# 部署 Cottage Service

伴随服务提供搜索、抓取、无头浏览器与可选 HTTP 代理。前端在 **设置 → Cottage Service** 填写地址并连接。用户向说明见 [Cottage Service 专题](/concepts/cottage-service-concepts)。

## Go 服务

目录：`cottage-service-go/`。约 15MB 可执行文件，带系统托盘与图形控制台。

### 要求

- Go 1.23+  
- 截图 / 提取 / 浏览器交互：本机 Chrome 或 Edge  

### 运行（UI / 托盘）

```bash
cd cottage-service-go
go run .
```

Windows 无黑框控制台时可编译为：

```bash
go build -ldflags="-H=windowsgui" -o dist/cottage-service-go.exe .
./dist/cottage-service-go.exe
```

默认行为：

1. 系统托盘显示图标（Windows 请看任务栏溢出区）  
2. 按配置自动启动 API（默认 `https://127.0.0.1:8787`）  
3. 从托盘菜单「打开控制台」改端口、TLS、无头模式、浏览器路径等  

`TLS=auto` 会在配置目录持久化本机 CA 和服务证书。首次使用时，可在系统托盘菜单选择「尝试信任本机 CA」，将其写入当前用户信任库；后续启动与服务证书续签会继续复用该 CA。

### 纯命令行

```bash
go run . --cli
# 或
COTTAGE_SERVICE_UI=off go run .
```

### 配置文件

| 系统 | 路径 |
|------|------|
| Windows | `%APPDATA%\cottage-service\config.json` |
| macOS | `~/Library/Application Support/cottage-service/config.json` |
| Linux | `~/.config/cottage-service/config.json` |

常用环境变量（覆盖配置文件）：

| 变量 | 默认 |
|------|------|
| `COTTAGE_SERVICE_HOST` | `127.0.0.1` |
| `COTTAGE_SERVICE_PORT` | `8787` |
| `COTTAGE_SERVICE_TLS_MODE` | `auto` |
| `COTTAGE_SERVICE_UI` | 开启（`off` 或 `--cli` 关闭） |
| `HEADLESS_BROWSER` | `auto` |
| `COTTAGE_BROWSER_PATH` | 自动探测 |

更全说明见仓库 `cottage-service-go/README.md`。

## 与前端联调检查清单

1. 从托盘菜单选择「尝试信任本机 CA」，再打开 `https://127.0.0.1:8787/health`（或你改过的地址）确认连接
2. Open Cottage：**设置 → Cottage Service** → 填地址 → 连接成功  
3. 按需勾选经服务搜索 / 抓取 / LLM 代理  
4. 需要截图或交互时，在「模型与能力」打开 **网页自动化**  
5. 对话里试一次搜索或截图，确认工具不再报「未连接服务」  

API 字段摘要：[cottage-service API](/reference/cottage-service-api)。

## 生产注意

- 默认只绑定本机；**勿在未加固鉴权与 TLS 时暴露到公网**  
- 代理路由不要默认放开内网目标（Go 版 `COTTAGE_SERVICE_PROXY_ALLOW_PRIVATE` 默认关闭）  
- 复杂站点抓取异常时，优先查看服务日志并用目标 URL 做独立回归
