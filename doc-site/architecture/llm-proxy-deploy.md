# 部署 llm-proxy

可选的 LLM 反向代理：把 API Key 留在服务端，处理 CORS，并做少量厂商请求改写。

用户何时需要、与 Cottage Service `/proxy` 的对比，见 [llm-proxy 参考](/reference/llm-proxy)。本页只写怎么部署。

## 何时部署

- 不希望 Key 留在浏览器 IndexedDB  
- 浏览器直连厂商遇 CORS  
- 需要在服务端统一改写请求（部分厂商 thinking / tools 适配）  

若只用 Cottage Service 做通用 HTTP 转发，不必强制起 llm-proxy；两者可并存，但建议明确「LLM 走哪条链路」。

## 启动

```bash
cd llm-proxy
npm install
# 复制环境变量文件并填入各厂商 Key（若仓库提供 .env.example）
npm start
```

默认：`http://localhost:3111`。

## 前端怎么指过来

1. 前端不再通过构建期环境变量接入该服务；如需使用代理，请由你的部署层或 Cottage Service 统一转发
2. 或在设置 / 模型相关配置里把 Base URL 指到代理（以当前界面为准）  
3. 代理侧 `.env` 注入 Key 时，浏览器里对应 Key 可留空  

## 安全

- 默认 CORS 偏宽松便于本地开发；**生产务必收紧 origin**  
- 切勿提交含真实 Key 的 `.env`  
- 见 [安全说明](/guide/security)

## 相关

- [模型、预设与 API Key](/concepts/models-and-keys)  
- [llm-proxy 参考](/reference/llm-proxy)  
- [部署 Cottage Service](./cottage-service-deploy)
