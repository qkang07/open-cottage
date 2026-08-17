# Open Cottage — frontend

基于 [ARCHITECTURE.md](./ARCHITECTURE.md) 实现的 Cottage 变体：使用 **AI SDK Core + Cottage Agent Runtime + 各厂商公开 API** 作为 Agent 运行时。

## 技术栈

Vue 3 + Vite 6 + Element Plus + Pinia + AI SDK Core。详见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

## 开发

需要 **HTTPS**（Vite basic-ssl）以使用 File System Access API：

```bash
pnpm install
pnpm dev
```

默认：`https://localhost:5176`

开发/生产均直连各厂商 API；自定义 API 需允许浏览器 CORS，也可通过 Cottage Service 的通用 HTTP 转发。

无需为模型服务配置构建期环境变量；在设置中填写 API Base URL、模型和（如需要）API Key。

## 构建

```bash
pnpm build         # public：裁剪隐藏功能，公开发行默认使用
pnpm build:public  # 与 pnpm build 相同，显式命令
pnpm build:full    # full：保留隐藏功能实现，供内部验证
```

`pnpm dev` 也会保留隐藏功能源码，以便开发调试，但不会自动恢复产品入口。具体裁剪范围和恢复方式见 [`docs/hidden-features.md`](../docs/hidden-features.md)。

## 首次使用

1. 打开工作空间文件夹
2. 点击右上角 **设置**，选择提供商并填写模型配置；自定义 OpenAI 兼容 API 可不填 API Key
3. 从下拉框选择模型（公开 API 列表会从 models.dev / 厂商 API 刷新）
4. 在对话或计划模式中与 Agent 协作

## 配置说明

- **`.cottage/config.json`**：提供商、模型名、temperature、联网搜索方式等（可随项目迁移）
- **IndexedDB `open-cottage-secrets`**：各厂商 API Key（不进入工作空间目录）
