import type { CottageAgent } from '../agent/CottageAgent';
import { taskDeliverableFile } from '../config/constants';
import { workspace } from '../workspace/FileSystemWorkspace';
import {
  appendTaskEvent,
  loadTaskManifest,
  loadTaskPlan,
  loadTaskSpec,
  loadTaskState,
  saveTaskState,
  saveTaskVerifyReport,
  touchTaskMeta,
} from './persistence';
import { buildTaskPrompt, buildPlanReminder, buildSubtaskWakeReminder } from './buildPrompt';
import type { PlanSession } from '../platform/plan';
import type { TaskSignalState } from './taskSignals';
import type { TaskRunControl, WakeReason } from './taskControl';
import { DEFAULT_MAX_TURNS, type TaskSpec, type TaskState } from './types';
import { runAcceptance } from './verify';

export interface TaskRunnerDeps {
  getChat: () => CottageAgent | null;
  getControl: () => TaskRunControl;
  mountTaskSession: (sessionId: string, taskId: string) => Promise<void>;
  persistChat: () => Promise<void>;
  getSignals: (taskId: string) => TaskSignalState;
  onUpdate: () => void;
}

const waitFor = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });

const waitUntilChatIdle = async (
  getChat: () => CottageAgent | null,
  shouldStop: () => boolean,
  timeoutMs = 600_000,
) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (shouldStop()) {
      throw new Error('TASK_STOPPED');
    }
    const chat = getChat();
    if (chat && !chat.busy) return chat;
    await waitFor(100);
  }
  throw new Error('等待 Agent 空闲超时');
};

type TurnEndReason = 'complete' | 'stopped' | 'stalled';

const waitForTurnEnd = (
  chat: CottageAgent,
  shouldStop: () => boolean,
): Promise<TurnEndReason> =>
  new Promise((resolve) => {
    if (shouldStop()) {
      resolve('stopped');
      return;
    }

    let settled = false;

    const finish = (reason: TurnEndReason) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(reason);
    };

    const cleanup = () => {
      chat.unwatch('assistantComplete', onComplete);
      chat.unwatch('rewind', onRewind);
      chat.unwatch('stalled', onStalled);
      window.clearInterval(poll);
    };

    const onComplete = () => finish('complete');
    const onRewind = () => finish('complete');
    const onStalled = () => finish('stalled');

    chat.watch('assistantComplete', onComplete);
    chat.watch('rewind', onRewind);
    chat.watch('stalled', onStalled);

    const poll = window.setInterval(() => {
      if (shouldStop()) {
        finish('stopped');
      }
    }, 100);
  });

const resolveMaxTurns = (spec: TaskSpec): number =>
  spec.maxTurns ?? DEFAULT_MAX_TURNS;

const hasPendingVerifyFail = (state: TaskState): boolean =>
  Boolean(state.verifyReport && state.verifyReport.verdict !== 'pass');

const hasPendingAgentTurn = (
  state: TaskState,
  spec: TaskSpec,
  control: TaskRunControl,
  signals: TaskSignalState,
): boolean => {
  if (control.shouldStop() || signals.failRequested) return false;
  if (state.turnCount >= resolveMaxTurns(spec)) return false;
  if (control.pendingWake) return true;
  if (hasPendingVerifyFail(state) && !signals.completeRequested) return true;
  return true;
};

interface PromptBuildContext {
  wakeReason?: WakeReason;
  stalledRecovery?: boolean;
  handoffTurn?: boolean;
}

const buildPromptForTurn = (
  spec: TaskSpec,
  plan: Awaited<ReturnType<typeof loadTaskPlan>>,
  state: TaskState,
  ctx: PromptBuildContext,
  planSession?: PlanSession | null,
): string => {
  const body = buildTaskPrompt(spec, plan, state, {
    verifyReport:
      hasPendingVerifyFail(state) && !ctx.handoffTurn
        ? state.verifyReport
        : undefined,
    stalledRecovery: ctx.stalledRecovery,
    handoffTurn: ctx.handoffTurn,
  });
  const reminder = buildPlanReminder(plan, { planSession });
  const subtaskWake =
    ctx.wakeReason === 'subtask-done' ? buildSubtaskWakeReminder() : null;
  return [subtaskWake, reminder, body].filter(Boolean).join('\n\n');
};

export class TaskRunner {
  constructor(private readonly getDeps: () => TaskRunnerDeps) {}

  pause() {
    const deps = this.getDeps();
    deps.getControl().requestPause();
    deps.getChat()?.abort();
  }

  cancel() {
    const deps = this.getDeps();
    deps.getControl().requestCancel();
    deps.getChat()?.abort();
  }

  async run(taskId: string): Promise<void> {
    const deps = this.getDeps();
    const control = deps.getControl();
    control.reset();

    const spec = await loadTaskSpec(taskId);
    const state = await loadTaskState(taskId);
    if (!spec || !state) {
      throw new Error('任务不存在');
    }

    const signals = deps.getSignals(taskId);
    signals.reset();

    const shouldStop = () => control.shouldStop();
    let consecutiveStalled = 0;
    let stalledRecoveryPending = false;

    const wakeLock = await navigator.wakeLock?.request('screen').catch(() => null);

    try {
      const resumeFromHandoff = state.status === 'paused' && Boolean(state.handoff);
      await this.patchState(taskId, {
        ...state,
        status: 'running',
        lastError: undefined,
        turnCount: resumeFromHandoff ? 0 : state.turnCount,
        updatedAt: Date.now(),
      });
      await appendTaskEvent(taskId, {
        type: state.status === 'paused' ? 'resumed' : 'started',
        at: Date.now(),
      });
      deps.onUpdate();

      await deps.mountTaskSession(state.chatSessionId, taskId);

      while (true) {
        const current = await loadTaskState(taskId);
        if (!current || current.status !== 'running') break;

        if (control.cancelRequested) {
          await this.patchState(taskId, {
            ...current,
            status: 'cancelled',
            updatedAt: Date.now(),
          });
          await appendTaskEvent(taskId, { type: 'cancelled', at: Date.now() });
          break;
        }

        if (control.pauseRequested) {
          await this.patchState(taskId, {
            ...current,
            status: 'paused',
            updatedAt: Date.now(),
          });
          await appendTaskEvent(taskId, { type: 'paused', at: Date.now() });
          break;
        }

        if (signals.failRequested) {
          await this.failTask(
            taskId,
            current,
            signals.failReason ?? 'Agent 声明任务失败',
          );
          break;
        }

        if (signals.handoffRequested && signals.handoff) {
          await this.applyHandoff(taskId, current, signals.handoff);
          break;
        }

        if (signals.completeRequested) {
          const finished = await this.tryComplete(taskId, spec, current, signals);
          if (finished) break;
          if (shouldStop()) continue;
          continue;
        }

        if (!hasPendingAgentTurn(current, spec, control, signals)) {
          if (current.turnCount >= resolveMaxTurns(spec)) {
            await this.failTask(taskId, current, '超过最大执行轮次');
          }
          break;
        }

        const wakeReason = control.consumeWake();
        const maxTurns = resolveMaxTurns(spec);
        const handoffTurn =
          !stalledRecoveryPending &&
          !hasPendingVerifyFail(current) &&
          !current.handoff &&
          current.turnCount === maxTurns - 1;

        const plan = await loadTaskPlan(taskId);
        const chatForPlan = deps.getChat();
        const prompt = buildPromptForTurn(
          spec,
          plan,
          current,
          {
            wakeReason,
            stalledRecovery: stalledRecoveryPending,
            handoffTurn,
          },
          chatForPlan?.getPlanSession(),
        );
        stalledRecoveryPending = false;

        try {
          const chat = await waitUntilChatIdle(deps.getChat, shouldStop);
          void chat.next(prompt);
          const endReason = await waitForTurnEnd(chat, shouldStop);
          await deps.persistChat();
          deps.onUpdate();

          if (endReason === 'stopped') {
            continue;
          }

          if (endReason === 'stalled') {
            consecutiveStalled += 1;
            if (consecutiveStalled >= 2) {
              await this.failTask(taskId, current, 'Agent 连续无产出');
              break;
            }
            stalledRecoveryPending = true;
            control.wake('stalled-recovery');
            continue;
          }

          consecutiveStalled = 0;
        } catch (error) {
          if (error instanceof Error && error.message === 'TASK_STOPPED') {
            continue;
          }
          throw error;
        }

        const after = await loadTaskState(taskId);
        if (!after) break;

        if (control.cancelRequested) {
          await this.patchState(taskId, {
            ...after,
            status: 'cancelled',
            updatedAt: Date.now(),
          });
          await appendTaskEvent(taskId, { type: 'cancelled', at: Date.now() });
          break;
        }

        if (control.pauseRequested) {
          await this.patchState(taskId, {
            ...after,
            status: 'paused',
            updatedAt: Date.now(),
          });
          await appendTaskEvent(taskId, { type: 'paused', at: Date.now() });
          break;
        }

        if (signals.handoffRequested && signals.handoff) {
          await this.applyHandoff(taskId, after, signals.handoff);
          break;
        }

        await this.patchState(taskId, {
          ...after,
          turnCount: after.turnCount + 1,
          updatedAt: Date.now(),
        });
        await appendTaskEvent(taskId, {
          type: 'turn',
          at: Date.now(),
          detail: { turn: after.turnCount + 1 },
        });
        deps.onUpdate();

        if (signals.failRequested) {
          const latest = await loadTaskState(taskId);
          if (latest) {
            await this.failTask(
              taskId,
              latest,
              signals.failReason ?? 'Agent 声明任务失败',
            );
          }
          break;
        }

        if (signals.completeRequested) {
          const latest = await loadTaskState(taskId);
          if (latest) {
            const finished = await this.tryComplete(taskId, spec, latest, signals);
            if (finished) break;
          }
        }
      }
    } finally {
      wakeLock?.release();
      deps.onUpdate();
    }
  }

  private async tryComplete(
    taskId: string,
    spec: Awaited<ReturnType<typeof loadTaskSpec>>,
    state: TaskState,
    signals: TaskSignalState,
  ): Promise<boolean> {
    if (!spec) return false;
    const deps = this.getDeps();

    const manifest = await loadTaskManifest(taskId);
    const report = await runAcceptance(spec, manifest);
    await saveTaskVerifyReport(taskId, report);
    deps.getChat()?.getTraceRecorder()?.append({
      type: 'verify',
      at: report.runAt,
      verdict: report.verdict,
      checkCount: report.checks.length,
      uncovered: report.uncovered,
      manifestPathCount: report.manifestPathCount,
    });

    if (report.verdict !== 'pass') {
      signals.completeRequested = false;
      await this.patchState(taskId, {
        ...state,
        verifyReport: report,
        updatedAt: Date.now(),
      });
      await appendTaskEvent(taskId, {
        type: 'verified',
        at: Date.now(),
        detail: {
          ok: false,
          reason: report.reason,
          uncovered: report.uncovered,
          checkCount: report.checks.length,
        },
      });
      deps.getControl().wake('verify-failed');
      deps.onUpdate();
      return false;
    }

    const paths = manifest!.paths.map((p) => p.path);
    const deliverable = taskDeliverableFile(taskId);
    if (paths.length > 0) {
      await workspace.compress(paths, deliverable);
    }

    await this.patchState(taskId, {
      ...state,
      status: 'completed',
      deliverablePath: deliverable,
      verifyReport: report,
      updatedAt: Date.now(),
    });
    await appendTaskEvent(taskId, {
      type: 'verified',
      at: Date.now(),
      detail: {
        ok: true,
        checkCount: report.checks.length,
        manifestPathCount: report.manifestPathCount,
      },
    });
    await appendTaskEvent(taskId, { type: 'completed', at: Date.now() });
    await touchTaskMeta(taskId, {});
    deps.onUpdate();
    return true;
  }

  private async applyHandoff(
    taskId: string,
    state: TaskState,
    handoff: NonNullable<TaskSignalState['handoff']>,
  ) {
    const deps = this.getDeps();
    await this.patchState(taskId, {
      ...state,
      status: 'paused',
      handoff,
      lastError: '达到最大轮次，已交接',
      updatedAt: Date.now(),
    });
    await appendTaskEvent(taskId, {
      type: 'handoff',
      at: handoff.at,
      detail: {
        summary: handoff.summary,
        remainingCount: handoff.remaining.length,
        nextStepCount: handoff.nextSteps.length,
      },
    });
    await appendTaskEvent(taskId, { type: 'paused', at: Date.now() });
    deps.getChat()?.getTraceRecorder()?.append({
      type: 'handoff',
      at: handoff.at,
      summary: handoff.summary,
      remainingCount: handoff.remaining.length,
      nextStepCount: handoff.nextSteps.length,
    });
    deps.onUpdate();
  }

  private async failTask(taskId: string, state: TaskState, reason: string) {
    const deps = this.getDeps();
    await this.patchState(taskId, {
      ...state,
      status: 'failed',
      lastError: reason,
      updatedAt: Date.now(),
    });
    await appendTaskEvent(taskId, {
      type: 'failed',
      at: Date.now(),
      detail: { reason },
    });
    await touchTaskMeta(taskId, {});
    deps.onUpdate();
  }

  private async patchState(taskId: string, state: TaskState) {
    await saveTaskState(taskId, state);
    this.getDeps().onUpdate();
  }
}
