# 开源准备清单

> 把 Open Cottage 公开发布前需要补齐的工作。按"必须处理 / 强烈建议 / 锦上添花"三档组织，并标注现状与落点。
>
> 状态图例：⬜ 未开始 · 🚧 部分完成 · ✅ 已完成

---

## 0. 现状速览（2026-06 盘点）

| 项 | 现状 |
|----|------|
| 仓库根 `LICENSE` | ✅ MIT（2026-07） |
| 仓库根 `README.md` | ✅ 已新建（2026-07，图片占位待补） |
| `CONTRIBUTING.md` / `CODE_OF_CONDUCT.md` / `SECURITY.md` | `SECURITY.md` ✅；其余待补 |
| `.github/`（CI、Issue/PR 模板） | 无 |
| `ARCHITECTURE.md` | ✅ 已重写为 Vue 3 + Element Plus + AI SDK Core + Cottage Agent Runtime + Platform Core/Pack |
| 内网信息泄露 | ✅ 已清理 `huolala.work` / `@hll/*` / `qikang.yuan` / `xlcx.work`（2026-07） |
| `frontend/src/workflow/` | ✅ 已整体删除（方案 A） |
| `frontend/vite.config.js` | ✅ 已删除（保留 `.ts`） |
| `.gitignore` | ✅ 已补 `.cottage/`（2026-07） |
| 子包 license 声明 | 三包统一 `MIT`（`frontend` / `cottage-service-go` / `llm-proxy`） |

---

## 1. 必须处理（不处理则不适合公开）

### 1.1 补 LICENSE 并统一 license 声明 — ✅

- [x] 在仓库根放 `LICENSE`（MIT）
- [x] `frontend/package.json`、`cottage-service-go/go.mod`、`llm-proxy/package.json` 已声明 MIT License
- [x] 根 README 顶部 license 声明（README 末尾 License 章节）

### 1.2 清理内网 / 公司相关信息 — ✅

- [x] `frontend/vite.config.ts`：`host` 由 `dev.huolala.work` 改为 `localhost`
- [x] 删除重复的 `frontend/vite.config.js`
- [x] 删除 `frontend/src/workflow/`（含 `wgw.huolala.work`）
- [x] 删除 `docs/workflow-provider-plan.md`
- [x] `frontend/ARCHITECTURE.md`：移除 `fe-tools.xlcx.work` / `wgw.huolala.work` / `VITE_USER_ID=qikang.yuan` / `@hll/*`
- [x] `frontend/README.md`：移除 workflow 引用与 `https://dev.huolala.work:5176`
- [x] `frontend/generate-product-intro.mjs`：移除"公司内部 Workflow"措辞，技术栈改为 Vue 3
- [x] `frontend/src/agent/CottageAgent.ts`：移除依赖 workflow 模型的 `_tool_call_progress` 死代码 fallback
- [x] `frontend/tsconfig.app.json` / `vitest.config.ts`：移除 `src/workflow` exclude

### 1.3 写一份与代码一致的根 README — ✅

- [x] 一句话项目定位（借用 `docs/platform-vision-and-roadmap.md` §1.1）
- [ ] 1–2 张运行截图 / 30s GIF（占位已留，待补图）
- [x] 快速开始：依赖、install、dev、为什么需要 HTTPS（FSA API）
- [x] 仓库结构：`frontend` / `cottage-service-go` / `llm-proxy` 三块说明
- [x] 文档链接表
- [x] License 声明

### 1.4 修正过时的 ARCHITECTURE.md — ✅

- [x] 重写 `frontend/ARCHITECTURE.md`，对齐 Vue + AI SDK Core + Cottage Agent Runtime + Platform Core/Pack 架构
- [x] 技术栈改为 Vue 3.5 + Element Plus + Pinia + AI SDK Core
- [x] 移除 `@hll/section-parser` 等内部包引用

---

## 2. 强烈建议

### 2.1 CONTRIBUTING.md — ⬜

- [ ] 开发环境要求（HTTPS、Chromium、pnpm / Go）
- [ ] 提交规范、目录布局
- [ ] 如何新增一个 Capability Pack（平台抽象已成熟，正好借此吸引贡献者）

### 2.2 CODE_OF_CONDUCT.md — ⬜

- [ ] 直接采用 Contributor Covenant 模板

### 2.3 SECURITY.md — ✅

- [x] 漏洞上报流程（不要在 public issue 里贴；邮箱待补）
- [x] 安全模型简述：API Key 仅存浏览器 IndexedDB、`.cottage/` 本地优先、Policy/Plan Gate 权限闸门

### 2.4 CI / GitHub Actions — ⬜

- [ ] `.github/workflows/ci.yml`：`pnpm install` + `vue-tsc -b`（typecheck）+ `vitest run`
- [ ] 可选：frontend build 冒烟测试

> 按用户约定，tsc/lint/test 由用户本地手动执行；CI 文件准备好后由用户验证启用。

### 2.5 Issue / PR 模板 — ⬜

- [ ] `.github/ISSUE_TEMPLATE/`（bug、feature 各一份）
- [ ] `.github/PULL_REQUEST_TEMPLATE.md`

### 2.6 文档目录梳理 — ⬜

`docs/` 下若干文档偏内部规划口吻。

- [x] 保留并轻度润色 `platform-vision-and-roadmap.md` 作为"设计白皮书"
- [x] `workflow-provider-plan.md` 已随 workflow 模块删除
- [ ] 给 `docs/` 加一份 `README.md` 索引，标注每篇文档定位与"是否仍代表当前实现"

### 2.7 .gitignore 补充 — ✅

- [x] 加 `.cottage/`（运行时工作空间数据，可能含对话历史）

---

## 3. 锦上添花

- [ ] **CHANGELOG.md**：用 Keep a Changelog 格式起步
- [x] **根目录 `package.json`**：用于脚本编排（`pnpm run dev` / `pnpm run dev:service`），方便新人 ✅
- [x] **一键启动**：`start.ps1`（Windows）/ `start.sh`（macOS/Linux），自动安装依赖并启动 frontend ✅
- [ ] **截图与 demo**：README 加 1–2 张主界面截图和一个 30s GIF
- [ ] **Repo topics / About**：GitHub About 栏填关键词（`agent`, `browser-based`, `ai-sdk`, `local-first`, `vue3`）
- [ ] **语义化版本承诺**：`frontend` 现为 `0.1.0`，写明 `0.x` 期兼容性承诺

---

## 4. 待决策项

### 4.1 `frontend/src/workflow/` 模块去留 — ✅ 已决策

采用**方案 A：彻底删除** `src/workflow/` + `docs/workflow-provider-plan.md`。仓库现为“AI SDK Core + Cottage Agent Runtime + 公开 API”单一版本。

### 4.2 License 选型 — ✅ 已决策

采用 **MIT**。

---

## 5. 推荐执行顺序

达到"可公开"门槛的最小路径：

1. LICENSE + 根 README + 清理内网信息（huolala / `@hll` / 个人账号）→ 先定 §4.1 workflow 去留
2. 修或撤掉过时的 `ARCHITECTURE.md`
3. CONTRIBUTING + CODE_OF_CONDUCT + SECURITY
4. CI + Issue/PR 模板
5. 文档索引、截图、CHANGELOG 等润色项

---

*文档版本：v2 · 2026-07 · LICENSE / 根 README / ARCHITECTURE / SECURITY / 内网清理 / workflow 删除 已完成*
