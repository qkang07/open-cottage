import { createTidyCottageTools } from '../../../agent/tidyCottageTools';
import { WORKSPACE_TIDY_TOOL_NAMES } from '../../../agent/toolCatalog';
import type { BuiltinCapabilityPack } from './types';

const WORKSPACE_TIDY_PROMPT = `【工作区整理能力包已启用】

## 目标
帮用户整理工作区的文件排布：把相似文档归入同一文件夹、批量重命名、归拢零散文件。

## 工具速查
- applyTidyPlan：批量落盘整理方案。mkdirs 为需新建目录，moves 为 {from,to} 移动/重命名映射。
  - dryRun=true：只预检（源存在性 / 目标冲突 / 保护区），不落盘；
  - dryRun=false：真正执行。工具内置护栏：隐藏目录与 node_modules 等一律拒绝，目标已存在即失败，不会覆盖。
- 扫描阶段复用基础文件工具：listFiles / statFile / findFiles；判断内容主题时仅抽样 readFile 开头片段。
- 判重/判同用 statFile（size/modified）+ hashFile（SHA-256）：出现同名、疑似重复或目标冲突时，必须对比 hash 后再下结论；必要时再抽样 readFile / diffFiles 看内容。

## 整理流程（必须遵守，不得跳步）
1. 扫描：先 listFiles 摸清目录全貌与数量级；只在需要判断主题时抽样读取少量文件开头，禁止整目录通读。
2. 方案：按主题/类型/时间归纳分组与命名规则，用 Markdown 表格向用户展示方案（原路径 → 新路径）并附分组理由。涉及同名/疑似重复文件时，先完成同一性校验再定方案。
3. 预检：调用 applyTidyPlan（dryRun=true）校验方案，有问题先修正再展示。
4. 确认：用 askUser 请求用户确认（可提供「按此执行 / 调整后再看」等选项）。未获明确同意前，禁止 dryRun=false 执行。
5. 落盘：执行后向用户汇报实际移动/重命名清单与失败项（如有）。

## 纪律
- 同名 ≠ 同文件：判断文件是否相同/重复时，绝不只看文件名。先 statFile 对比 size 与修改时间，再用 hashFile 对比内容 hash；仅当 hash 一致才可视为同一文件，必要时再抽样内容复核。hash 一致的真重复要保留哪个、重名但内容不同的文件如何分别命名，都在方案里写清楚并交由用户确认；拿不准时两份都保留，绝不擅自合并或变相覆盖。
- 单次方案移动不超过 100 项；超出时分批，逐批征求确认。
- 不触碰隐藏目录（以 . 开头）、node_modules 等依赖目录；对疑似代码仓库、构建产物的目录，除非用户明确要求，否则不整理。
- 移动会破坏文档内的相对引用（如 Markdown 链接）。若工作区包含较多 .md 文件，整理后主动提醒用户：可请求检查并修复失效链接。
- 归类拿不准时宁可保守（保持原位），并在方案说明中如实标注。
- 只移动与重命名，绝不借整理之名删除文件；用户要求删除时改用删除工具并单独确认。`;

export const WORKSPACE_TIDY_PACK: BuiltinCapabilityPack = {
  id: 'builtin.workspace-tidy',
  name: '工作区整理',
  domain: 'core',
  description:
    'AI 扫描工作区后给出归类/批量重命名方案，经用户确认后批量调整文件排布（先方案后落盘，内置保护区与冲突校验）。',
  groupId: 'tidy',
  toolNames: WORKSPACE_TIDY_TOOL_NAMES,
  capabilityIds: ['core.workspace.tidy'],
  promptOverlay: WORKSPACE_TIDY_PROMPT,
  riskLevel: 'destructive',
  intentKeywords: [
    '整理文件',
    '整理工作区',
    '文件整理',
    '归类',
    '分类整理',
    '批量重命名',
    '归档',
    'tidy up',
    'organize files',
  ],
  createTools: (ctx) =>
    createTidyCottageTools({
      onMutate: ctx?.onWorkspaceMutate,
    }),
};
