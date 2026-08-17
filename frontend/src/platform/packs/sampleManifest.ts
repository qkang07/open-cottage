import { CAPABILITY_PACK_SCHEMA, type CapabilityPackManifest } from './types';

/** 内置示例：写作审校能力包（可一键安装体验） */
export const SAMPLE_WRITING_REVIEW_PACK: CapabilityPackManifest = {
  schema: CAPABILITY_PACK_SCHEMA,
  id: 'sample.writing-review',
  name: '写作审校',
  version: '1.0.0',
  description:
    '为 Agent 提供文档审校流程与检查清单技能，适合润色 README、方案与说明文档。',
  promptOverlay: `本工作区已安装「写作审校」能力包。处理文档类任务时：
- 先通读全文把握结构与论点
- 检查错别字、语病、术语一致性
- 优化段落层次与标题层级
- 保持用户原有语气，避免过度改写`,
  capabilities: [
    {
      id: 'pack.writing-review',
      domain: 'core',
      tools: ['readFile', 'editFile', 'searchFiles'],
      inputTypes: ['text'],
      outputTypes: ['text'],
      riskLevel: 'write',
      plannerHints: '文档审校与结构化润色',
    },
  ],
  skills: [
    {
      file: 'writing-review-checklist.md',
      content: `---
name: writing-review-checklist
description: 文档审校检查清单与执行步骤
---

# 写作审校检查清单

## 执行步骤
1. 用 readFile 读取目标文档全文
2. 按下方清单逐项检查
3. 用 editFile 做小步修改（每次只改一处，便于回滚）
4. 修改后简要说明改了什么、为什么

## 检查项
- [ ] 标题层级是否合理（不跳级）
- [ ] 段落是否过长（建议单段不超过 6 行）
- [ ] 术语是否前后一致
- [ ] 有无明显错别字或语病
- [ ] 列表与代码块格式是否规范
- [ ] 链接与路径是否有效（如能验证）
`,
    },
  ],
  suggestedTools: [],
};
