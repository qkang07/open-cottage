# 贡献指南

## 欢迎的贡献

- Bug 报告与复现步骤  
- 文档与翻译改进（含本 `doc-site`）  
- 新的 Capability Pack / Skill  
- 小而清晰的 UX 改进  

## 本地怎么跑起来

1. **前端**：`cd frontend && pnpm install && pnpm dev` → `https://localhost:5176`  
2. **伴随服务**（可选）：[部署 Cottage Service](./cottage-service-deploy)
3. **llm-proxy**（可选）：[部署 llm-proxy](./llm-proxy-deploy)  
4. 或仓库根目录一键：`start.ps1` / `start.sh`（前端）

## 开发建议

1. 阅读 [产品简介](/guide/introduction)，避免把未接线能力当产品功能宣传
2. 参考代码目录（如 `opencode/`）**只读**，不得复制进本仓库构建路径（见根 `AGENTS.md`）  
3. 改动触及隐藏模块时，同步更新 `docs/hidden-features.md`  
4. 新增能力包工具时按 [编写 Capability Pack](./pack-authoring) 三处登记  
5. 遵守 MIT License  

## 文档站本地预览

```bash
cd doc-site
pnpm install
pnpm run dev
```

## 安全

漏洞请按 [安全说明](/guide/security) 私下披露，不要开公开 issue 贴 PoC。
