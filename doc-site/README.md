# Open Cottage Docs

面向用户的官方文档站（VitePress）：教人**怎么用**，而不是堆架构说明。

**官方入口：[GitHub](https://github.com/qkang07/open-cottage) · [在线 Demo](https://cottage.swimlions.com/) · [官方文档](https://doc.cottage.swimlions.com/)**

## 本地预览

```bash
pnpm install
pnpm run dev
```

## 内容怎么组织

| 板块 | 给谁看 |
|------|--------|
| 首页 | 产品气质与入口 |
| `guide/` | 上手步骤、日常操作、按场景跟做 |
| `concepts/` | 专题：名词机制 + 对应操作 |
| `packs/` | 能力开关与能力清单（短） |
| `reference/` | 设置、工具、API 等参考 |
| `architecture/` | **开发者**：架构、写能力包、部署 Service、贡献 |

伴随服务由 Go 实现；日常用户可从官方 Demo 与使用指南开始，高级用法可通过开源代码自行部署，本地启动与服务部署归入开发者文档。GitHub、Demo 与文档地址统一维护在 `.vitepress/site-links.mjs`。

## 补截图

1. 按 `public/images/README.md` 的文件名列表截图
2. 把图放进 `public/images/`
3. 更新对应页的 Markdown 图片引用，例如 `![主界面](/images/main-ui.png)`

首页使用代码构建的工作流示意，不依赖氛围插画。
