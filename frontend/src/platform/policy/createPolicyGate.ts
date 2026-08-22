import type { CapabilityRiskLevel } from '../capabilities/types';
import {
  waitForCallInteraction,
} from '../../chat/callInteractionGate';
import { evaluateToolPolicy } from './policyEngine';
import type { PolicyGate } from './types';

export interface CreatePolicyGateOptions {
  requireApprovalFor?: readonly CapabilityRiskLevel[];
  /** 即使能力目录把它归为普通写入，也始终逐次确认的工具。 */
  requireApprovalForTools?: readonly string[];
  /** 所属会话 ID，用于按会话隔离审批闸门 */
  sessionId?: string | null;
}

const ARG_VALUE_MAX = 160;
const ARG_LIST_MAX = 5;

const formatArgValue = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const oneLine = value.replace(/\s*\n\s*/g, ' ').trim();
    if (!oneLine) return null;
    return oneLine.length > ARG_VALUE_MAX
      ? `${oneLine.slice(0, ARG_VALUE_MAX)}…（共 ${value.length} 字符）`
      : oneLine;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    const items = value
      .filter(
        (v): v is string | number | boolean =>
          typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean',
      )
      .map(String);
    if (!items.length) return null;
    const shown = items.slice(0, ARG_LIST_MAX).join('、');
    return items.length > ARG_LIST_MAX
      ? `${shown} 等 ${items.length} 项`
      : shown;
  }
  return null;
};

/** 常见参数名的可读标签：审批文案不直接展示代码参数名 */
const ARG_KEY_LABELS: Record<string, string> = {
  path: '路径',
  paths: '路径列表',
  from: '源路径',
  to: '目标路径',
};

/** 把工具参数整理成可读摘要，让用户审批时看清操作对象（如要删除的文件路径） */
const summarizeToolArgs = (args: unknown): string | null => {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
  const lines: string[] = [];
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    const text = formatArgValue(value);
    if (text) lines.push(`· ${ARG_KEY_LABELS[key] ?? key}: ${text}`);
  }
  return lines.length ? lines.join('\n') : null;
};

/** 整理方案移动清单最多展开的行数，超出折叠为「其余 N 项」 */
const TIDY_MOVES_SHOWN_MAX = 8;

/**
 * 整理方案专用摘要：首行醒目区分「预检」与「真正执行」（两者仅 dryRun 不同，
 * 通用摘要几乎看不出差别），并把 moves 对象展开为「源 → 目标」清单。
 * 注意：dryRun=true 的预检已在 policyEngine（DRY_RUN_EXEMPT_PREDICATES）豁免审批，
 * 正常流程只有 dryRun=false 才会走到这里；「预检」文案仅作防御性兜底
 * （豁免逻辑调整或本工具被加入逐次确认名单时仍会正确展示）。
 */
const summarizeApplyTidyPlan = (
  args: Record<string, unknown>,
): string | null => {
  const lines: string[] = [
    args.dryRun === true
      ? '本次为预检（不落盘）：只校验方案是否可行，不会移动或新建任何文件。'
      : '本次为真正执行：将实际移动/重命名文件，并创建新目录。',
  ];
  const mkdirs = Array.isArray(args.mkdirs)
    ? args.mkdirs.filter(
        (v): v is string => typeof v === 'string' && v.trim().length > 0,
      )
    : [];
  const dirsText = formatArgValue(mkdirs);
  if (dirsText) lines.push(`新建目录（${mkdirs.length}）：${dirsText}`);
  const pairs = (Array.isArray(args.moves) ? args.moves : []).filter(
    (m): m is { from: string; to: string } =>
      !!m &&
      typeof m === 'object' &&
      typeof (m as { from?: unknown }).from === 'string' &&
      typeof (m as { to?: unknown }).to === 'string',
  );
  if (pairs.length) {
    lines.push(`移动/重命名（${pairs.length} 项）：`);
    for (const pair of pairs.slice(0, TIDY_MOVES_SHOWN_MAX)) {
      lines.push(`· ${pair.from} → ${pair.to}`);
    }
    if (pairs.length > TIDY_MOVES_SHOWN_MAX) {
      lines.push(`· …其余 ${pairs.length - TIDY_MOVES_SHOWN_MAX} 项`);
    }
  }
  return lines.join('\n');
};

/**
 * 工具专属参数摘要：参数携带关键语义差别（如 applyTidyPlan 的 dryRun）的工具，
 * 用定制文案替代通用键值罗列；返回值自带小节标题，不再套「操作对象：」前缀。
 */
const TOOL_ARG_SUMMARIZERS: Partial<Record<
  string,
  (args: Record<string, unknown>) => string | null
>> = {
  applyTidyPlan: summarizeApplyTidyPlan,
};

const runApproval = async (
  input: Parameters<PolicyGate>[0],
  message: string,
  sessionId: string | null | undefined,
): Promise<{ allowed: boolean; reason?: string }> => {
  let approvalMessage = message;
  if (input.toolName === 'doom_loop') {
    const args = (input.args ?? {}) as {
      reason?: string;
      targetTool?: string;
    };
    const reason = typeof args.reason === 'string' ? args.reason : '疑似死循环';
    const target =
      typeof args.targetTool === 'string' && args.targetTool
        ? args.targetTool
        : '该工具';
    approvalMessage =
      `检测到工具循环：${reason}。\n相关工具：${target}\n\n允许：再执行一次。\n拒绝：跳过这次，让助手换做法。`;
  } else {
    const summarizer = TOOL_ARG_SUMMARIZERS[input.toolName];
    const argsRecord =
      input.args && typeof input.args === 'object' && !Array.isArray(input.args)
        ? (input.args as Record<string, unknown>)
        : null;
    const argsSummary = summarizer
      ? summarizer(argsRecord ?? {})
      : summarizeToolArgs(input.args);
    if (argsSummary) {
      approvalMessage = summarizer
        ? `${message}\n\n${argsSummary}`
        : `${message}\n\n操作对象：\n${argsSummary}`;
    }
  }
  input.onAwaitingApproval?.({ message: approvalMessage });
  const decision = await waitForCallInteraction({
    sessionId,
    callId: input.callId,
    signal: input.signal,
  });
  const approved =
    decision.kind === 'tool_approval' && decision.approved;
  return approved
    ? { allowed: true }
    : { allowed: false, reason: '用户拒绝了该操作' };
};

/**
 * 组装 Policy 执行器：doom_loop 在软提醒耗尽后走审批；其余按 requireApprovalFor。
 */
export const createPolicyGate = (
  options: CreatePolicyGateOptions,
): PolicyGate => {
  const requireApprovalFor = options.requireApprovalFor ?? [];
  const requireApprovalForTools = new Set(options.requireApprovalForTools ?? []);
  const sessionId = options.sessionId ?? null;

  return async (input) => {
    const decision = evaluateToolPolicy(
      input.toolName,
      { requireApprovalFor },
      input.args,
    );
    if (decision.action === 'allow' && requireApprovalForTools.has(input.toolName)) {
      return runApproval(
        input,
        `计划即将执行需要单独确认的工具「${input.toolName}」。是否继续？`,
        sessionId,
      );
    }
    if (decision.action === 'allow') return { allowed: true };
    if (decision.action === 'deny') {
      return { allowed: false, reason: decision.reason };
    }

    return runApproval(input, decision.message, sessionId);
  };
};
