# Open Cottage 官方实用能力包

这里的每个子目录都是一个可直接导入的外部能力包，入口文件为 `manifest.json`。

## 一分钟上手

1. 打开 Open Cottage 和一个工作区。
2. 进入 **设置 → 能力配置 → 外部包**。
3. 点击 **导入 manifest**，选择某个包目录下的 `manifest.json`。
4. 确认包已启用，回到聊天页面，复制下表中的示例指令。

能力包不是单独运行的程序。它会把明确的工作流程、检查单和能力声明装进 Agent，然后调用 Open Cottage 已有的文件、联网或办公工具完成任务。

## 推荐从这四个开始

| 能力包 | 前置能力 | 复制这句话试用 | 默认产物 |
| --- | --- | --- | --- |
| [网页资料归档](web-page-archiver/manifest.json) | 无，使用基础联网能力 | `把这个网页归档到 references/，保留来源和访问日期：https://example.com/article` | `references/*.md` |
| [工作区盘点](workspace-inventory/manifest.json) | 无 | `盘点当前工作区，生成 WORKSPACE-INVENTORY.md，不要修改其他文件` | `WORKSPACE-INVENTORY.md` |
| [表格清洗](spreadsheet-cleaner/manifest.json) | 开启“办公文档” | `清洗 data.csv：去除空行和重复行，统一日期格式，另存为 data-cleaned.xlsx` | 新的 `.xlsx` 文件与清洗报告 |
| [批量重命名](batch-file-renamer/manifest.json) | 无 | `把 assets 里的图片按 product-001 这种格式重命名，先给我预览，不要立即执行` | 重命名预览；确认后改名 |

## 另外三个工作流包

| 能力包 | 复制这句话试用 |
| --- | --- |
| [文档审校](document-review/manifest.json) | `审校 README.md，修正表达和术语不一致，保持原有语气` |
| [证据研究](evidence-research/manifest.json) | `调研这个主题并把带来源的报告保存为 research/report.md：……` |
| [项目交接](project-handoff/manifest.json) | `扫描当前项目并生成 HANDOFF.md，标出未验证的启动步骤` |

## 使用原则

- 导入后直接用自然语言描述任务，不需要记工具名。
- 涉及覆盖、移动或重命名时，包会要求先预览并确认。
- “表格清洗”依赖内置办公工具；未开启时只能给出方案，不能读写 `.xlsx`。
- 外部能力包本身不能执行任意 JavaScript、Shell 或二进制程序。如需增加全新的可执行工具，应通过 MCP 服务接入。

## 编写自己的包

复制最接近需求的子目录，然后修改 `id`、名称、示例指令、工作流程和技能检查单。`id` 必须以小写字母开头，只能包含小写字母、数字、点、连字符和下划线。

一个好用的能力包至少要明确四件事：什么时候触发、需要什么输入、允许改动什么、最后交付什么。
