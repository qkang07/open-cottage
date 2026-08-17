# 本地开发与启动

本页面面向参与 Open Cottage 开发、需要在自己的环境运行站点，或需要自行运行 Cottage Service 的用户。

只想体验产品时，直接使用官方 Demo；无需安装客户端、Node.js 或 Go。需要高级用法、定制，或自行运行 Cottage Service 时，再按本页部署。

<ProjectLinks />

## 你需要准备

- Node.js 20 或更高，以及 pnpm  
- Chrome 或 Edge 桌面浏览器  
- （可选）Go 1.23+：用于运行或编译 Cottage Service

## 最快方式：一键启动

在仓库根目录执行：

::: code-group

```powershell [Windows]
.\start.ps1
```

```bash [macOS / Linux]
bash start.sh
```

:::

然后：

1. 浏览器打开 `https://localhost:5176`  
2. 首次使用 Cottage Service 时，从托盘菜单选择「尝试信任本机 CA」
3. 用 `Ctrl+C` 可停止服务  

一键脚本只启动前端。需要联网增强或网页自动化时，请按下方方式单独启动 Cottage Service。

![浏览器打开本地地址后的欢迎页](/images/welcome.png)

## 分开启动（可选）

只跑界面：

```bash
cd frontend
pnpm install
pnpm dev
```

需要更好的搜索、抓取、网页自动化时，再启动 Cottage Service。

### 启动 Cottage Service

Go 实现体积更小，带系统托盘与图形控制台：

```bash
cd cottage-service-go
go run .
# Windows 也可先编译再运行：
# go build -ldflags="-H=windowsgui" -o dist/cottage-service-go.exe .
# ./dist/cottage-service-go.exe
```

默认监听 `https://127.0.0.1:8787`。首次可从托盘菜单尝试把本机 CA 写入当前用户信任库，再打开 `/health` 确认连接。截图与网页自动化需要本机已安装 Chrome 或 Edge。

连接步骤见 [Cottage Service](/concepts/cottage-service-concepts)；部署细节见 [部署 Cottage Service](/architecture/cottage-service-deploy)。

不想把 API Key 放在浏览器时，可将模型服务接到自建网关，再在模型设置中填写其公开的兼容 API 地址。

## 启动成功后

继续 [五分钟配置](./first-setup)。
