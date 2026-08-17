/** Spec 模式：单文档五段式（目标 / 需求 / 设计改动 / 任务清单 / 验收标准）。 */

export type SpecTaskStatus = 'pending' | 'doing' | 'done' | 'failed';

export interface SpecTask {
  id: string;
  title: string;
  /** 该任务的具体改动说明（可选，供执行时参考） */
  detail?: string;
  status: SpecTaskStatus;
  /** 失败/备注信息 */
  note?: string;
}

export type SpecStatus =
  | 'drafting'
  | 'awaiting_approval'
  | 'executing'
  | 'paused'
  | 'completed'
  | 'failed';

/** 五段式方案文档 */
export interface SpecDoc {
  id: string;
  chatSessionId: string;
  /** 一句话目标 */
  goal: string;
  /** 需求条目 */
  requirements: string[];
  /** 设计改动说明（Markdown 文本） */
  design: string;
  /** 任务清单（逐项执行） */
  tasks: SpecTask[];
  /** 验收标准条目 */
  acceptance: string[];
  status: SpecStatus;
  createdAt: number;
  updatedAt: number;
}

/** submitSpec 工具产出的草稿（尚未分配 id / 状态 / 时间戳） */
export interface SpecDraft {
  goal: string;
  requirements: string[];
  design: string;
  tasks: { title: string; detail?: string }[];
  acceptance: string[];
}

export interface SpecMeta {
  id: string;
  goal: string;
  status: SpecStatus;
  createdAt: number;
  updatedAt: number;
}

export const newSpecId = () => crypto.randomUUID();
export const newSpecTaskId = () => crypto.randomUUID();

/** 由草稿创建完整 SpecDoc（初始为待批准） */
export function createSpecDoc(
  draft: SpecDraft,
  chatSessionId: string,
): SpecDoc {
  const now = Date.now();
  return {
    id: newSpecId(),
    chatSessionId,
    goal: draft.goal.trim(),
    requirements: draft.requirements.map((r) => r.trim()).filter(Boolean),
    design: draft.design.trim(),
    tasks: draft.tasks
      .filter((t) => t.title.trim())
      .map((t) => ({
        id: newSpecTaskId(),
        title: t.title.trim(),
        detail: t.detail?.trim() || undefined,
        status: 'pending' as SpecTaskStatus,
      })),
    acceptance: draft.acceptance.map((a) => a.trim()).filter(Boolean),
    status: 'awaiting_approval',
    createdAt: now,
    updatedAt: now,
  };
}

/** 进度统计 */
export function computeSpecProgress(doc: SpecDoc): {
  total: number;
  done: number;
  failed: number;
  percent: number;
} {
  const total = doc.tasks.length;
  const done = doc.tasks.filter((t) => t.status === 'done').length;
  const failed = doc.tasks.filter((t) => t.status === 'failed').length;
  const percent = total === 0 ? 0 : Math.round(((done + failed) / total) * 100);
  return { total, done, failed, percent };
}

/** 渲染为可读 Markdown（用于落盘 .md 文件） */
export function renderSpecMarkdown(doc: SpecDoc): string {
  const lines: string[] = [];
  lines.push(`# ${doc.goal}`, '');
  lines.push('## 需求', '');
  if (doc.requirements.length) {
    lines.push(...doc.requirements.map((r) => `- ${r}`));
  } else {
    lines.push('（无）');
  }
  lines.push('', '## 设计改动', '', doc.design || '（无）', '');
  lines.push('## 任务清单', '');
  if (doc.tasks.length) {
    for (const t of doc.tasks) {
      const box = t.status === 'done' ? 'x' : ' ';
      const mark = t.status === 'failed' ? ' ⚠️失败' : t.status === 'doing' ? ' ⏳进行中' : '';
      lines.push(`- [${box}] ${t.title}${mark}`);
      if (t.detail) lines.push(`  - ${t.detail}`);
    }
  } else {
    lines.push('（无）');
  }
  lines.push('', '## 验收标准', '');
  if (doc.acceptance.length) {
    lines.push(...doc.acceptance.map((a) => `- ${a}`));
  } else {
    lines.push('（无）');
  }
  lines.push('');
  return lines.join('\n');
}
