# Cottage Service

**Cottage Service** 是跑在本机（或你指定机器）上的伴随服务：补浏览器做不到或不稳定的能力。

## 它不是什么

- 不是把 Agent「搬出浏览器」的另一个大脑  
- Agent 仍在页面里编排；Service 提供搜索、抓取、无头浏览器、可选 HTTP 代理等接口  

## 什么时候需要

| 需求 | 要不要 |
|------|--------|
| 只改本地文件 / 办公 / 编码 | 可选 |
| 更稳的网页搜索与抓取 | 推荐 |
| 网页截图、动态页、点击填表 | **需要** |

## 服务实现

Cottage Service 由 `cottage-service-go` 提供，可用 `go run .` 或编译后的可执行文件启动，默认地址为 `https://127.0.0.1:8787`。

## 怎么连接

<StepList :items="[
  { title: '启动服务', text: '若需自行运行，按「本地开发与启动」页启动 Cottage Service。根目录一键脚本只启动前端。' },
  { title: '信任证书', text: '从系统托盘菜单选择「尝试信任本机 CA」，成功后重新打开服务页面。也可手动打开 https://127.0.0.1:8787/health 检查。' },
  { title: '回到 Open Cottage', text: '设置 → Cottage Service → 填写地址（默认同上）→ 连接。' },
  { title: '打开需要的路由', text: '按需启用经服务搜索、抓取或 LLM 代理。' },
  { title: '再开网页自动化', text: '若要用截图/交互，到「模型与能力」打开网页自动化包。' },
]" />

![Cottage Service 设置页：未连接时可填写地址或探测本机端口](/images/settings-cottage-service.png)

## 怎么确认可用

在对话里试：

<div class="oc-prompt">
  <span class="oc-prompt__label">示例</span>
  搜索「VitePress 自定义首页」，列出前 3 条结果标题与链接。
</div>

若失败，检查：服务是否在运行、证书是否已信任，以及设置里是否已连接。

## 和你的数据

- 默认监听本机地址（如 `127.0.0.1`）  
- 请求由你的浏览器发起；请勿在未加固时暴露到公网  

## 相关

- [本地开发与启动](/guide/install)  
- [网页抓取与自动化](/guide/use-web)  
- [设置界面](/guide/settings)
- [部署 Cottage Service](/architecture/cottage-service-deploy)  
- [API 参考](/reference/cottage-service-api)
