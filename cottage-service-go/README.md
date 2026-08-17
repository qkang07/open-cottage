# cottage-service-go

Open Cottage 的 Cottage Service，使用本机 Chrome/Edge + [rod](https://github.com/go-rod/rod)。

## 能力

- HTTP API：`/search` `/fetch` `/proxy` `/screenshot` `/pdf` `/extract` `/browser/*` `/cookies` `/health` `/profiles`
- 浏览器状态页：`GET /`（确认 HTTPS 可访问）；程序探测仍用 `GET /health`（JSON）
- **图形控制台**（默认）：浏览器打开本地控制面板，启停服务、改端口 / TLS 等（与健康页分开，从托盘「打开控制台（配置）」进入）
- 系统托盘（Windows 通知区域 / macOS 菜单栏）
- **单实例**：再次启动会复用已有进程；UI 模式会重新打开控制面板
- TLS：`auto` 持久化本机 CA / 自定义证书 / `off`
- 无头可选：未检测到浏览器时自动降级为纯 HTTP
- 配置持久化到本机 JSON 文件

## 要求

- Go 1.23+
- 截图 / 提取 / 交互浏览器：本机 Chrome 或 Edge

## 运行（推荐：UI）

```bash
cd cottage-service-go
go run .
# Windows 推荐（无黑框控制台）：
go build -ldflags="-H=windowsgui" -o dist/cottage-service-go.exe .
./dist/cottage-service-go.exe
```

默认会：

1. 在系统托盘显示图标（**Windows 需看任务栏右下角 / `^` 溢出区**），UI 模式会隐藏控制台窗口  
2. 按配置自动启动 API 服务  
3. **自动打开配置控制台**；也可随时从托盘菜单「打开控制台（配置）」进入  
4. UI 模式日志写入 `%APPDATA%\cottage-service\service.log`（macOS/Linux 在对应配置目录）

托盘图标：**开发时一次性**由 `assets/logo-light.svg` 栅格化为 PNG/ICO（`python scripts/gen_tray_icons.py` 或 `go generate ./internal/tray`），产物在 `assets/tray*.png|ico`；`go build` 再通过 `//go:embed` 打进 exe。**运行时不会转 SVG。**

控制台可设置：监听地址、端口、TLS、无头模式、浏览器路径、内网代理、自动启动；「保存配置」会写入磁盘，改端口等会在服务运行时自动重启。控制台下方可查看实时运行日志（同时写入配置目录下的 `service.log`）。

`TLS=auto` 首次启动会在配置目录的 `tls/` 下生成本机 CA 与 localhost 服务证书，后续启动继续复用同一 CA。系统托盘菜单中的「尝试信任本机 CA」会尝试把 CA 写入当前用户信任库；这是显式用户操作，成功或失败会通过系统通知与日志反馈。自定义证书配置不受此机制影响。

配置文件路径：

| 系统 | 路径 |
|------|------|
| Windows | `%APPDATA%\cottage-service\config.json` |
| macOS | `~/Library/Application Support/cottage-service/config.json` |
| Linux | `~/.config/cottage-service/config.json` |

## 纯命令行模式

不打开控制台时：

```bash
go run . --cli
# 或
COTTAGE_SERVICE_UI=off go run .
```

## 编译

```bash
go build -o dist/cottage-service-go.exe .
# 约 15MB 量级
```

Windows 已关闭 rod `leakless` 辅助进程，避免杀软误报。

## 环境变量

环境变量会覆盖配置文件（便于脚本）：

| 变量 | 默认 |
|------|------|
| `COTTAGE_SERVICE_HOST` | `127.0.0.1` |
| `COTTAGE_SERVICE_PORT` | `8787` |
| `COTTAGE_SERVICE_TLS_MODE` | `auto` |
| `COTTAGE_SERVICE_PROXY_ALLOW_PRIVATE` | 关闭 |
| `COTTAGE_SERVICE_AUTOSTART` | 开启（UI 模式） |
| `COTTAGE_SERVICE_UI` | 开启（`off` 或 `--cli` 关闭） |
| `HEADLESS_BROWSER` | `auto` |
| `COTTAGE_BROWSER_PATH` | 自动探测 |

系统托盘固定启用，不可关闭。

图标流水线（一次性，非运行时）：

1. 源文件：`assets/logo-light.svg`
2. 生成：`python scripts/gen_tray_icons.py`（或 `go generate ./internal/tray`）
3. 可见产物：`assets/tray.png`、`assets/tray-running.*`、`assets/tray-stopped.*`
4. 编译嵌入：同名文件复制到 `internal/tray/`，由 `//go:embed` 打进 exe
