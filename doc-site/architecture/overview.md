# 架构概览

## 仓库结构

| 目录 | 职责 | 技术栈 |
|------|------|--------|
| `frontend/` | 浏览器内 Agent 容器与全部 UI | Vue 3 + Vite 6 + Pinia + AI SDK Core + Cottage Agent Runtime |
| `cottage-service-go/` | 伴随服务（独立分发，托盘 + 控制台） | Go + rod |
| `docs/` | 设计白皮书与内部进度 | Markdown |
| `doc-site/` | **本官方文档站** | VitePress |

前端通过统一 HTTP API 连接 Cottage Service。部署见 [部署 Cottage Service](./cottage-service-deploy)。

## 运行时拓扑

```
Vue UI（欢迎页 → 工作区：文件侧栏 + 聊天，预览按需）
  → Pinia stores（workspace / agent / …）
  → createCottageAgent
       · base tools + askUser + Spec tools
       · builtin / external packs
       · MCP（可选）
       · PolicyGate + StagingStore
  → Platform Core（capabilities / policy / packs / staging / verify / trace）
  → domains（coding / office …）
  → FSA 工作区 + .cottage/
  → LLM API 或 Cottage Service
```

## 关键思想

1. **Agent 住在浏览器**：编排、策略、验收、人机交互在控制平面完成  
2. **Service 是能力平面**：搜索、抓取、无头浏览器、代理——不是把 Agent 本体挪出去  
3. **语义化工具优先**：默认不让 LLM 直接摸裸 shell  
4. **Pack 可插拔**：领域能力注册工具、prompt overlay 与 skills  

更细的前端实现见 `frontend/ARCHITECTURE.md`（部分章节可能滞后于代码，以源码为准）。

## 数据流（一次对话）

1. 用户发消息（可带 @ 引用 / 附件）  
2. Agent 循环：模型 → 工具调用 → 闸门 / 暂存 → 观察结果  
3. 流式 UI 渲染工具与文本  
4. 变更落盘或进入暂存；用户在预览核对

## 开发者入口

- [编写 Capability Pack](./pack-authoring)  
- [部署 Cottage Service](./cottage-service-deploy)  
- [贡献指南](./contributing)  
