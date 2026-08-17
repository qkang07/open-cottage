# 模型提供商与 Key

在 **设置 → 模型配置** 中选择提供商、填写 API Key 并保存模型预设。Key 只存在浏览器本地；自建兼容 API 可填写 Base URL，也可经 Cottage Service 的 `/proxy` 转发。

## 常见提供商

| 类型 | 提供商 |
|------|--------|
| 国际 | OpenAI、Anthropic Claude、Google Gemini、OpenRouter |
| 国内与亚太兼容 | DeepSeek、Kimi、智谱 GLM、通义千问、豆包、千帆、混元、MiniMax、硅基流动、零一万物、阶跃星辰、百川 |
| 自定义 | 任意 OpenAI 兼容网关 |

实际可选模型以你的账号、网络与所连服务为准。界面通常优先从提供商接口获取模型列表；失败时会再参考公共目录，仍没有结果时可手动填写模型名。

## 选择连接方式

1. **浏览器直连厂商 API**：配置最少，但需要厂商允许浏览器跨域请求。
2. **自定义 OpenAI 兼容 API**：适合自建或团队网关；在模型配置中填写 Base URL。
3. **Cottage Service 代理**：请求经本机伴随服务转发，是否携带 Key 取决于你的部署方式。

任选一种即可，避免重复转发或重复注入 Key。

## 保存边界

- API Key 不写入 `.cottage/config.json`，也不会随工作区复制。
- 模型预设与工作区选择遵循 [两层配置：域名与工作区](/concepts/storage-layers)。
- 换浏览器或清除站点数据后，需要重新填写 Key。

相关： [设置界面](./settings) · [安全说明](./security) · [模型、预设与 API Key](/concepts/models-and-keys)
