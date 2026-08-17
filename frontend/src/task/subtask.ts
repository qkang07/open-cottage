import type { CottageAgent } from '../agent/CottageAgent';
import type { StoredMessage } from '../agent/messages';
import type { TaskToolSignals } from '../agent/taskToolSignals';
import type { ChatSessionRuntimeMeta } from '../config/constants';
import { buildSessionRuntimeMeta } from '../config/sessionRuntime';
import {
  appendTaskEvent,
  loadTaskState,
  saveTaskState,
} from './persistence';
import type { SubtaskRef, SubtaskStatus, TaskState } from './types';

const MAX_SUBTASK_TURNS = 8;

/** 正在执行的后台子任务（按 subtaskId 去重） */
const backgroundRuns = new Set<string>();

export interface SubtaskRunnerDeps {
  parentTaskId: string;
  createSession: (title: string) => Promise<string>;
  loadSessionHistory: (sessionId: string) => Promise<StoredMessage[]>;
  saveSessionHistory: (
    sessionId: string,
    history: StoredMessage[],
    runtime?: ChatSessionRuntimeMeta,
  ) => Promise<void>;
  createSubtaskAgent: (
    sessionId: string,
    parentTaskId: string,
    signals: TaskToolSignals,
  ) => Promise<CottageAgent>;
  getParentChatSessionId: () => Promise<string>;
  /** 后台子任务结束时回投主会话并唤醒任务循环 */
  onBackgroundSubtaskFinished: (
    result: DispatchSubtaskResult,
    goal: string,
  ) => Promise<void>;
  /** 子任务状态变更时刷新任务面板 */
  onTaskStateChange?: () => void;
}

const waitForAgentTurn = (agent: CottageAgent): Promise<'complete' | 'stopped'> =>
  new Promise((resolve) => {
    const onComplete = () => finish('complete');
    const onRewind = () => finish('complete');

    const finish = (reason: 'complete' | 'stopped') => {
      agent.unwatch('assistantComplete', onComplete);
      agent.unwatch('rewind', onRewind);
      resolve(reason);
    };

    agent.watch('assistantComplete', onComplete);
    agent.watch('rewind', onRewind);
  });

const buildSubtaskPrompt = (goal: string, resumeSummary?: string): string => {
  const parts = [
    '请执行以下子任务（独立会话，不影响主任务交付）。',
    '',
    '## 子任务目标',
    goal.trim(),
    '',
    '约束：',
    '- 不要调用 dispatchSubtask（禁止嵌套子任务）',
    '- 不要调用 taskComplete / taskHandoff（只有主任务能声明完成）',
    '- 不要调用 taskSetPlan（不能修改主任务计划）',
    '- 完成后调用 subtaskComplete 提交摘要；无法完成则 taskFail',
  ];
  if (resumeSummary) {
    parts.push('', '## 上次进度', resumeSummary);
  }
  return parts.join('\n');
};

export const buildSubtaskInjectionMessage = (
  result: DispatchSubtaskResult,
  goal: string,
): string => {
  const summary = result.summary ?? result.error ?? '（无摘要）';
  return [
    `<subtask id="${result.subtaskId}" state="${result.status}">`,
    `<goal>${goal.trim()}</goal>`,
    `<summary>${summary}</summary>`,
    '</subtask>',
    '',
    result.status === 'completed'
      ? '后台子任务已完成，请根据摘要继续推进主任务。'
      : '后台子任务未成功完成，请评估是否调整主任务计划或重试子任务。',
  ].join('\n');
};

const upsertSubtask = (
  state: TaskState,
  ref: SubtaskRef,
): TaskState => ({
  ...state,
  subtasks: [...(state.subtasks ?? []).filter((s) => s.id !== ref.id), ref],
  updatedAt: Date.now(),
});

export interface DispatchSubtaskResult {
  ok: boolean;
  subtaskId: string;
  status: SubtaskStatus;
  summary?: string;
  error?: string;
  background?: boolean;
}

interface SubtaskRunContext {
  subtaskId: string;
  sessionId: string;
  goal: string;
  ref: SubtaskRef;
}

const prepareSubtaskRun = async (
  deps: SubtaskRunnerDeps,
  goal: string,
  options?: { background?: boolean; subtaskId?: string },
): Promise<SubtaskRunContext> => {
  const trimmedGoal = goal.trim();
  if (!trimmedGoal) {
    throw new Error('子任务目标不能为空');
  }

  const parentState = await loadTaskState(deps.parentTaskId);
  if (!parentState) throw new Error('主任务不存在');

  const now = Date.now();
  let ref: SubtaskRef | undefined = options?.subtaskId
    ? parentState.subtasks?.find((s) => s.id === options.subtaskId)
    : undefined;

  if (ref?.status === 'completed') {
    throw new Error('SUBTASK_ALREADY_COMPLETED');
  }

  const subtaskId = ref?.id ?? crypto.randomUUID();
  const sessionId = ref?.chatSessionId ?? (await deps.createSession(trimmedGoal.slice(0, 40)));
  const background = options?.background ?? ref?.background ?? false;

  ref = {
    id: subtaskId,
    goal: trimmedGoal,
    chatSessionId: sessionId,
    status: 'running',
    background,
    createdAt: ref?.createdAt ?? now,
    updatedAt: now,
  };

  await saveTaskState(deps.parentTaskId, upsertSubtask(parentState, ref));
  await appendTaskEvent(deps.parentTaskId, {
    type: 'subtask',
    at: now,
    detail: {
      action: 'started',
      subtaskId,
      goal: trimmedGoal,
      background,
    },
  });
  deps.onTaskStateChange?.();

  return { subtaskId, sessionId, goal: trimmedGoal, ref };
};

const executeSubtaskRun = async (
  deps: SubtaskRunnerDeps,
  ctx: SubtaskRunContext,
): Promise<DispatchSubtaskResult> => {
  const { subtaskId, sessionId, goal, ref } = ctx;

  let summary: string | undefined;
  let error: string | undefined;
  let status: SubtaskStatus = 'failed';
  let completeRequested = false;
  let failRequested = false;
  let failReason: string | undefined;

  const signals: TaskToolSignals = {
    onSubtaskComplete: (text) => {
      completeRequested = true;
      summary = text;
    },
    onFail: (reason) => {
      failRequested = true;
      failReason = reason;
    },
  };

  const agent = await deps.createSubtaskAgent(sessionId, deps.parentTaskId, signals);
  let prompt = buildSubtaskPrompt(goal, ref.summary);

  try {
    for (let turn = 0; turn < MAX_SUBTASK_TURNS; turn++) {
      if (failRequested) {
        status = 'failed';
        error = failReason ?? '子任务声明失败';
        break;
      }
      if (completeRequested) {
        status = 'completed';
        break;
      }

      await agent.next(prompt);
      await waitForAgentTurn(agent);
      await agent.persistEventLogArtifacts(buildSessionRuntimeMeta(agent));

      if (failRequested) {
        status = 'failed';
        error = failReason ?? '子任务声明失败';
        break;
      }
      if (completeRequested) {
        status = 'completed';
        break;
      }

      prompt = '继续推进子任务；完成后务必调用 subtaskComplete 提交摘要。';
    }

    if (!completeRequested && !failRequested) {
      status = 'failed';
      error = '子任务超过最大轮次';
    }
  } catch (err) {
    status = 'failed';
    error = err instanceof Error ? err.message : String(err);
  }

  const finishedAt = Date.now();
  const finalRef: SubtaskRef = {
    ...ref,
    status,
    summary: summary ?? ref.summary,
    error,
    updatedAt: finishedAt,
  };

  const latest = await loadTaskState(deps.parentTaskId);
  if (latest) {
    await saveTaskState(deps.parentTaskId, upsertSubtask(latest, finalRef));
  }
  await appendTaskEvent(deps.parentTaskId, {
    type: 'subtask',
    at: finishedAt,
    detail: {
      action: status === 'completed' ? 'completed' : 'failed',
      subtaskId,
      summary: finalRef.summary,
      error: finalRef.error,
      background: ref.background,
    },
  });
  deps.onTaskStateChange?.();

  const result: DispatchSubtaskResult = {
    ok: status === 'completed',
    subtaskId,
    status,
    summary: finalRef.summary,
    error: finalRef.error,
    background: ref.background,
  };

  if (ref.background) {
    await deps.onBackgroundSubtaskFinished(result, goal);
  }

  return result;
};

/** 前台同步执行子任务（阻塞直到完成或失败） */
export async function dispatchSubtaskForeground(
  deps: SubtaskRunnerDeps,
  goal: string,
  options?: { background?: boolean; subtaskId?: string },
): Promise<DispatchSubtaskResult> {
  if (options?.background) {
    return dispatchSubtaskBackground(deps, goal, options);
  }

  try {
    const ctx = await prepareSubtaskRun(deps, goal, options);
    return await executeSubtaskRun(deps, ctx);
  } catch (error) {
    if (error instanceof Error && error.message === 'SUBTASK_ALREADY_COMPLETED') {
      const state = await loadTaskState(deps.parentTaskId);
      const ref = state?.subtasks?.find((s) => s.id === options?.subtaskId);
      return {
        ok: true,
        subtaskId: ref!.id,
        status: 'completed',
        summary: ref!.summary,
      };
    }
    throw error;
  }
}

/** 后台异步执行子任务（立即返回，完成后回投主会话） */
export async function dispatchSubtaskBackground(
  deps: SubtaskRunnerDeps,
  goal: string,
  options?: { subtaskId?: string },
): Promise<DispatchSubtaskResult> {
  const parentState = await loadTaskState(deps.parentTaskId);
  const existing = options?.subtaskId
    ? parentState?.subtasks?.find((s) => s.id === options.subtaskId)
    : undefined;

  if (existing?.status === 'completed') {
    return {
      ok: true,
      subtaskId: existing.id,
      status: 'completed',
      summary: existing.summary,
      background: true,
    };
  }

  if (existing?.status === 'running' && backgroundRuns.has(existing.id)) {
    return {
      ok: true,
      subtaskId: existing.id,
      status: 'running',
      summary: '子任务已在后台执行中',
      background: true,
    };
  }

  const ctx = await prepareSubtaskRun(deps, goal, {
    ...options,
    background: true,
  });
  backgroundRuns.add(ctx.subtaskId);

  void executeSubtaskRun(deps, ctx)
    .catch((error) => {
      console.error('[Subtask] background run failed:', error);
    })
    .finally(() => {
      backgroundRuns.delete(ctx.subtaskId);
    });

  return {
    ok: true,
    subtaskId: ctx.subtaskId,
    status: 'running',
    summary: '子任务已在后台启动，完成后将自动回投主会话',
    background: true,
  };
}

export const resumeSubtask = async (
  deps: SubtaskRunnerDeps,
  subtaskId: string,
): Promise<DispatchSubtaskResult> => {
  const state = await loadTaskState(deps.parentTaskId);
  const ref = state?.subtasks?.find((s) => s.id === subtaskId);
  if (!ref) throw new Error('子任务不存在');
  if (ref.status === 'completed') {
    return {
      ok: true,
      subtaskId,
      status: 'completed',
      summary: ref.summary,
      background: ref.background,
    };
  }
  if (ref.background) {
    return dispatchSubtaskBackground(deps, ref.goal, { subtaskId });
  }
  return dispatchSubtaskForeground(deps, ref.goal, { subtaskId });
};

/** 工作区切换或应用卸载时清理后台运行标记 */
export const resetBackgroundSubtaskRuns = (): void => {
  backgroundRuns.clear();
};
