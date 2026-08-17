import type { TaskPlan, TaskSpec, TaskState, TaskHandoff, VerifyReport } from './types';
import type { PlanSession } from '../platform/plan';

const formatPlan = (plan: TaskPlan | null): string => {
  if (!plan?.steps.length) return '（尚未提交计划）';
  return plan.steps
    .map((s) => `- [${s.status}] ${s.id}: ${s.title}`)
    .join('\n');
};

const formatOperatorInstructions = (state: TaskState): string | null => {
  const instructions = state.operatorInstructions?.filter((item) =>
    item.content.trim(),
  );
  if (!instructions?.length) return null;
  return instructions
    .map((item, index) => `${index + 1}. ${item.content.trim()}`)
    .join('\n');
};

const formatVerifyReport = (report: VerifyReport): string => {
  const lines = [`验收未通过：${report.uncovered.length} 项未满足`];
  for (const check of report.checks) {
    const mark = check.pass ? '✓' : '✗';
    lines.push(
      `  ${mark} [${check.type}] ${check.description ?? check.id}${
        check.reason && !check.pass ? ` — ${check.reason}` : ''
      }`,
    );
  }
  lines.push('', '请针对未通过项（✗）修复，再次调用 taskComplete 提交交付清单。');
  return lines.join('\n');
};

export interface PlanReminderContext {
  planSession?: PlanSession | null;
}

/** 合成 system-reminder 段，注入每轮 user 消息开头（不进 UI 展示）。 */
export const buildPlanReminder = (
  plan: TaskPlan | null,
  ctx?: PlanReminderContext,
): string | null => {
  const session = ctx?.planSession;
  const lines = ['<system-reminder>', '## 计划遵循', formatPlan(plan)];

  if (session?.plan) {
    const budget = session.effectiveBudget();
    lines.push(
      '',
      '## 执行计划预算',
      `- 工具轮次：${session.counters.turns}${
        budget.maxTurns !== undefined ? ` / ${budget.maxTurns}` : ''
      }`,
      `- 文件写入：${session.counters.files}${
        budget.maxFiles !== undefined ? ` / ${budget.maxFiles}` : ''
      }`,
      `- 外部访问：${session.counters.apiCalls}${
        budget.maxApiCalls !== undefined ? ` / ${budget.maxApiCalls}` : ''
      }`,
    );
  }

  if (session?.lastBlockedReason) {
    lines.push(
      '',
      `⚠️ 上次被计划闸门阻止：${session.lastBlockedReason}`,
      '禁止再执行写操作，请重新 submitExecutionPlan 或 taskHandoff。',
    );
  }

  if (session?.isOverBudget()) {
    lines.push('', '⚠️ 已超计划预算，禁止再执行写操作。');
  }

  lines.push('</system-reminder>');
  return lines.join('\n');
};

export const buildSubtaskWakeReminder = (): string =>
  '<system-reminder>后台子任务已完成，结果见上一条 &lt;subtask&gt; 消息。请据此继续主任务。</system-reminder>';

export interface BuildTaskPromptOptions {
  verifyError?: string;
  verifyReport?: VerifyReport;
  /** Agent 上一轮无产出时的追问 */
  stalledRecovery?: boolean;
  /** 触顶 maxTurns 前的强制交接轮 */
  handoffTurn?: boolean;
}

const formatHandoffContext = (handoff: TaskHandoff): string => {
  const lines = [
    '## 上次交接摘要',
    handoff.summary,
    '',
    '## 未完成项',
    ...handoff.remaining.map((item) => `- ${item}`),
    '',
    '## 建议下一步',
    ...handoff.nextSteps.map((item) => `- ${item}`),
  ];
  return lines.join('\n');
};

export const buildHandoffPrompt = (
  spec: TaskSpec,
  plan: TaskPlan | null,
  state: TaskState,
): string => {
  const parts = [
    '⚠️ 这是任务的最后一轮。你即将达到最大执行轮次上限。',
    '',
    '本轮禁止修改文件或使用除 taskHandoff 以外的工具。',
    '请调用 taskHandoff 提交结构化交接：summary（已完成摘要）、remaining（未完成项）、nextSteps（建议下一步）。',
    '',
    '## 目标',
    spec.goal,
    '',
    '## 当前计划',
    formatPlan(plan),
  ];
  const operatorInstructions = formatOperatorInstructions(state);
  if (operatorInstructions) {
    parts.push('', '## 人工补充指令', operatorInstructions);
  }
  if (state.handoff) {
    parts.push('', formatHandoffContext(state.handoff));
  }
  return parts.join('\n');
};

export const buildTaskPrompt = (
  spec: TaskSpec,
  plan: TaskPlan | null,
  state: TaskState,
  options?: BuildTaskPromptOptions,
): string => {
  if (options?.handoffTurn) {
    return buildHandoffPrompt(spec, plan, state);
  }

  if (options?.stalledRecovery) {
    const parts = [
      '上一轮未产生有效输出（无工具调用且无实质内容）。',
      '请继续推进任务，必要时调用工具读取或修改文件；若无法继续请调用 taskFail 说明原因。',
      '',
      '## 目标',
      spec.goal,
      '',
      '## 当前计划',
      formatPlan(plan),
    ];
    const operatorInstructions = formatOperatorInstructions(state);
    if (operatorInstructions) {
      parts.push('', '## 人工补充指令', operatorInstructions);
    }
    return parts.join('\n');
  }

  if (options?.verifyReport && options.verifyReport.verdict === 'fail') {
    const parts = [
      formatVerifyReport(options.verifyReport),
      '',
      '当前计划：',
      formatPlan(plan),
    ];
    const operatorInstructions = formatOperatorInstructions(state);
    if (operatorInstructions) {
      parts.push('', '## 人工补充指令', operatorInstructions);
    }
    return parts.join('\n');
  }

  if (options?.verifyError) {
    const parts = [
      `任务验收未通过：${options.verifyError}`,
      '请修复问题后再次调用 taskComplete 提交交付清单。',
      '',
      '当前计划：',
      formatPlan(plan),
    ];
    const operatorInstructions = formatOperatorInstructions(state);
    if (operatorInstructions) {
      parts.push('', '## 人工补充指令', operatorInstructions);
    }
    return parts.join('\n');
  }

  if (state.turnCount === 0) {
    const parts = [
      '请执行以下任务。',
      '',
      '## 目标',
      spec.goal,
    ];
    if (state.handoff) {
      parts.push('', formatHandoffContext(state.handoff));
    }
    if (spec.constraints?.trim()) {
      parts.push('', '## 约束', spec.constraints.trim());
    }
    if (spec.acceptance.files?.length) {
      parts.push(
        '',
        '## 验收要求（这些文件必须存在）',
        spec.acceptance.files.map((f) => `- ${f}`).join('\n'),
      );
    }
    if (spec.acceptance.checks?.length) {
      parts.push(
        '',
        '## 验收检查项（任务完成时会逐条校验）',
        spec.acceptance.checks
          .map((c) => {
            const desc = c.description ?? c.type;
            const target = c.path ?? c.field ?? '';
            const extra =
              c.expected !== undefined
                ? ` 期望=${JSON.stringify(c.expected)}`
                : c.equals !== undefined
                  ? ` 期望=${JSON.stringify(c.equals)}`
                  : '';
            return `- [${c.type}] ${desc}${target ? ` @${target}` : ''}${extra}${
              c.not ? ' (否定)' : ''
            }`;
          })
          .join('\n'),
        '完成时所有检查项须全部通过；未通过项会被回灌告知。',
      );
    }
    if (spec.acceptance.script?.trim()) {
      parts.push(
        '',
        '## 验收脚本',
        '任务完成后会自动在 Web Worker 中执行验收脚本（非 Cottage 工具调用）。',
        '脚本只能使用 api.*（listFiles、readFile、exists、patchFile 等）经主线程代理访问工作区，须 return { ok: true } 表示通过。',
      );
    }
    const operatorInstructions = formatOperatorInstructions(state);
    if (operatorInstructions) {
      parts.push('', '## 人工补充指令', operatorInstructions);
    }
    parts.push(
      '',
      '请先调用 taskSetPlan 提交计划，再开始修改文件。',
    );
    return parts.join('\n');
  }

  const pending = plan?.steps.filter((s) => s.status !== 'done') ?? [];
  const parts = [
    `继续执行任务（第 ${state.turnCount + 1} 轮）。`,
    '',
    '## 目标',
    spec.goal,
  ];
  if (state.handoff) {
    parts.push('', formatHandoffContext(state.handoff));
  }
  parts.push(
    '',
    '## 当前计划',
    formatPlan(plan),
    pending.length
      ? `\n待完成步骤：\n${pending.map((s) => `- ${s.title}`).join('\n')}`
      : '\n若所有步骤已完成，请调用 taskComplete 提交交付清单。',
    '',
    '请继续推进；完成后务必调用 taskComplete。',
  );
  const operatorInstructions = formatOperatorInstructions(state);
  if (operatorInstructions) {
    parts.splice(
      parts.length - 2,
      0,
      '',
      '## 人工补充指令',
      operatorInstructions,
    );
  }
  return parts.join('\n');
};
