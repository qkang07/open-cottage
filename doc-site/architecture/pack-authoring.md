# 编写 Capability Pack

Capability Pack 用来把一套可复用的工作方法带进 Open Cottage：它可以描述 Agent 应如何处理某类任务，附带检查清单，并声明所依赖的工具或 MCP 服务。

适合把团队已有的流程沉淀成可安装的包，例如：文档审校、发布前检查、客户访谈整理或设计交接。

> Capability Pack 是声明式扩展：由 `manifest.json`、提示词和 Skills 组成。它不能直接在用户机器上执行自定义 JavaScript、Shell 或二进制代码；如需接入专用系统，请通过 MCP 服务提供工具。

## 先理解运行方式

安装后，Open Cottage 会把包登记到当前工作区（或浏览器域名层）。启用该包的对话会获得：

1. **领域提示词**：告诉 Agent 目标、步骤、边界和交付标准。
2. **Skills**：以 Markdown 保存的详细操作手册或检查清单。
3. **能力声明**：供界面和 Agent 判断任务类型、输入输出与风险。
4. **MCP 配置（可选）**：连接外部系统提供的工具。

包应解决一个清晰的任务域，而不是把所有团队规则塞进同一份提示词。

## 最小目录与最小清单

工作区级安装后的文件位于：

```text
.cottage/packs/<pack-id>/
├── manifest.json
├── prompt.md              # 可选；补充或替代 promptOverlay
└── skills/                # 可选；由 manifest 中的 skills 写入
    └── <skill-name>.md
```

最小的 `manifest.json` 只需要四个字段：

```json
{
  "schema": "cottage-capability-pack-v1",
  "id": "team.release-notes",
  "name": "发布说明",
  "version": "1.0.0"
}
```

`id` 必须以小写字母开头，只能使用小写字母、数字、`.`、`_` 和 `-`，长度为 2–64 个字符。建议采用 `团队.任务` 的形式，例如 `acme.design-handoff`。

## 字段参考

| 字段 | 必填 | 用途 |
|---|---:|---|
| `schema` | 是 | 固定为 `cottage-capability-pack-v1` |
| `id` | 是 | 稳定标识；升级同一个包时不要更改 |
| `name` | 是 | 设置和能力面板中的显示名称 |
| `version` | 是 | 版本号；更新包时递增 |
| `description` | 否 | 一句话说明适用场景和产出 |
| `promptOverlay` | 否 | 注入对话的领域工作规则；也可存为 `prompt.md` |
| `capabilities` | 否 | 任务类型、依赖工具、输入输出和风险声明 |
| `skills` | 否 | 要安装的 Markdown 技能文件 |
| `suggestedTools` | 否 | 建议用户同时打开的已有工具名 |
| `mcpServers` | 否 | 需要连接的 MCP 服务配置 |
| `riskLevel` / `requiresApproval` | 否 | 包级风险提示和确认需求 |

`promptOverlay` 与 `prompt.md` 可以同时存在，加载时会合并。短规则放在 `promptOverlay`，篇幅较长、需要多人维护的内容放在 `prompt.md` 或 Skill 中。

## 示例一：文档审校包

这个例子不需要外部服务，只复用工作区已有的文件读写工具。它要求 Agent 在修改前理解全文，按清单检查，再用小步方式修改。

```json
{
  "schema": "cottage-capability-pack-v1",
  "id": "team.writing-review",
  "name": "文档审校",
  "version": "1.0.0",
  "description": "审校 Markdown、方案和说明文档，保持原有语气并输出修改摘要。",
  "promptOverlay": "处理文档时，先通读全文再修改。保持作者语气；优先修正结构、术语一致性和明显语病。完成后说明改了什么，不要无关改写。",
  "capabilities": [
    {
      "id": "team.writing-review",
      "domain": "core",
      "tools": ["readFile", "searchFiles", "editFile"],
      "inputTypes": ["text", "document"],
      "outputTypes": ["text", "document"],
      "riskLevel": "write",
      "plannerHints": "文档审校、术语统一、结构润色"
    }
  ],
  "skills": [
    {
      "file": "review-checklist.md",
      "content": "---\nname: review-checklist\ndescription: 文档审校清单\n---\n\n# 审校步骤\n\n1. 读取全文并确认目标读者。\n2. 检查标题层级、术语和链接。\n3. 每次只做一类修改。\n4. 汇总修改项与仍需作者确认的问题。\n"
    }
  ]
}
```

其中 `capabilities[0]` 的字段含义如下：

| 字段 | 说明 |
|---|---|
| `id` | 能力的唯一标识，建议与包 id 保持同一命名空间 |
| `domain` | `core`、`coding`、`office`、`media`、`chart` 或 `integration` |
| `tools` | 此工作流预计依赖的工具名 |
| `inputTypes` / `outputTypes` | `text`、`code`、`spreadsheet`、`document`、`slides`、`image`、`audio`、`video`、`json` 或 `binary` |
| `riskLevel` | `read`、`write`、`external` 或 `destructive` |
| `plannerHints` | 帮助 Agent 识别何时适合使用该能力的简短关键词 |

## 示例二：接入团队知识库

如果流程需要访问内部系统，应让系统通过 MCP 暴露工具，而不是在包里放可执行脚本。下面的清单会登记一个远程 MCP 服务，并要求 Agent 在答复中注明引用来源。

```json
{
  "schema": "cottage-capability-pack-v1",
  "id": "team.knowledge-base",
  "name": "团队知识库",
  "version": "1.0.0",
  "description": "检索团队规范和历史决策，并在回答中附来源。",
  "promptOverlay": "回答团队规范问题前先检索知识库。区分原文事实与自己的推断，并标明所用页面或条目。",
  "mcpServers": [
    {
      "id": "team-kb",
      "name": "团队知识库",
      "url": "https://mcp.example.com/knowledge",
      "enabled": true,
      "transport": "streamable-http"
    }
  ],
  "capabilities": [
    {
      "id": "team.knowledge-search",
      "domain": "integration",
      "tools": ["search_knowledge"],
      "inputTypes": ["text"],
      "outputTypes": ["text"],
      "riskLevel": "external",
      "requiresApproval": true,
      "plannerHints": "查询团队知识库、查找内部规范"
    }
  ]
}
```

安装会把服务信息合并进当前工作区的 MCP 配置；服务可用性、认证方式和工具名称由 MCP 服务自身决定。发布前请确认服务 URL 可访问、认证不写入 manifest，以及该服务的风险等级描述准确。

## 安装与调试

### 从设置安装

1. 打开一个工作区。
2. 进入 **设置 → 能力配置 → 外部包**。
3. 选择导入 `manifest.json`，或填写托管该 JSON 文件的 HTTPS 地址。
4. 回到聊天区的 **模型与能力**，确认包已出现并启用。

URL 安装时，Open Cottage 会读取 JSON；只有 `schema` 正确的 JSON 才会按 Capability Pack 安装。普通 Markdown 地址会被当作工作区 Skill 安装。

### 本地安装

将 `manifest.json` 放入上面的 `.cottage/packs/<pack-id>/` 目录后，仍需在设置中导入或登记该包，才能让它进入当前工作区配置。最可靠的做法是先通过设置导入清单，再检查生成的文件。

### 排查清单

| 现象 | 检查方式 |
|---|---|
| 导入失败 | 确认 JSON 合法，`schema` 固定，`id` 格式正确，且 `name`、`version` 非空 |
| 已安装但聊天中看不到 | 确认当前打开的是安装时的工作区，并在“模型与能力”中启用该包 |
| 规则没有生效 | 检查 `promptOverlay` 或 `prompt.md` 是否为空；新开一轮对话再验证 |
| MCP 工具不可用 | 检查服务 URL、网络、认证与 MCP 设置；确认服务实际提供了清单中声明的工具 |
| 行为太泛或太长 | 缩短提示词，只保留该领域的步骤、边界和交付格式；细节移动到 Skill |

## 设计原则

1. **一个包，一个清晰任务域**：不要把审校、发布、客服和数据治理混在一起。
2. **规则写成可执行步骤**：说明“先读什么、再做什么、输出什么”，少用抽象口号。
3. **能力声明要诚实**：工具、数据类型和风险等级必须与实际依赖一致。
4. **最小权限与最小外部依赖**：不需要 MCP 就不要配置 MCP；不需要写入就标记为 `read`。
5. **把长知识放进 Skill**：提示词负责导航，Skill 负责清单、模板和例外处理。
6. **用真实任务验收**：为每个包准备 2–3 条典型请求，验证它是否只在相关任务中生效、是否遵守流程、是否产出预期文件或答复。

用户侧的安装和启用步骤见 [安装外部能力](/packs/external)。
