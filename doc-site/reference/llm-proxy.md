# llm-proxy

可选的 LLM 反向代理：统一注入 API Key、处理 CORS、做少量厂商特化。

部署步骤见 [部署 llm-proxy](/architecture/llm-proxy-deploy)。

## 启动

```bash
cd llm-proxy
npm install
# 复制环境变量文件并填入各厂商 Key（若仓库提供 .env.example）
npm start
```

默认：`http://localhost:3111`。

## 何时使用

- 不希望 Key 留在浏览器 IndexedDB  
- 浏览器直连厂商遇 CORS  
- 需要在服务端统一改写请求（如部分厂商 thinking / tools 适配）  

## 与 Cottage Service 的关系

| | llm-proxy | Cottage Service `/proxy` |
|--|-----------|---------------------------|
| 定位 | LLM 网关 | 通用伴随服务（含搜索/浏览器） |
| Key | 通常在代理 `.env` | 也可由浏览器头传入 |
| 其它能力 | 无 | 搜索、抓取、无头浏览器 |

二者可并存，但建议明确「LLM 走哪条链路」，避免混乱。

## 安全

- 默认 CORS 偏宽松便于本地开发；**生产务必收紧 origin**  
- 切勿提交含真实 Key 的 `.env`  
- 见 [安全说明](/guide/security)
