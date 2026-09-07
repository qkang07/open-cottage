import type {
  CottageModelDriver,
  CottageModelEvent,
  CottageModelRequest,
  CottageModelUsage,
  CottageStructuredRequest,
} from '../../agent/runtime/model';
import type {
  LiveEvalBudgetConfig,
  LiveEvalModelCallRecord,
  LiveEvalUsageTotals,
} from './types';

export class LiveEvalBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiveEvalBudgetError';
  }
}

const emptyTotals = (): LiveEvalUsageTotals => ({
  modelCalls: 0,
  durationMs: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
});

export const createLiveEvalBudgetedModel = (
  driver: CottageModelDriver,
  budget: LiveEvalBudgetConfig,
) => {
  const startedAt = Date.now();
  const totals = emptyTotals();
  const calls: LiveEvalModelCallRecord[] = [];
  let phase = 'unassigned';
  let violation: string | null = null;
  const budgetError = (message: string) => {
    violation ??= message;
    return new LiveEvalBudgetError(message);
  };

  const deadlineSignal = (input?: AbortSignal) => {
    const remaining = Math.max(1, budget.maxDurationMs - (Date.now() - startedAt));
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(budgetError(`评测耗时达到上限 ${budget.maxDurationMs}ms`)),
      remaining,
    );
    const abort = () => controller.abort(input?.reason);
    input?.addEventListener('abort', abort, { once: true });
    return {
      signal: controller.signal,
      cleanup: () => {
        clearTimeout(timer);
        input?.removeEventListener('abort', abort);
      },
    };
  };

  const beforeCall = () => {
    totals.durationMs = Date.now() - startedAt;
    if (totals.modelCalls >= budget.maxModelCalls) {
      throw budgetError(`模型调用达到上限 ${budget.maxModelCalls}`);
    }
    if ((totals.totalTokens ?? 0) >= budget.maxTotalTokens) {
      throw budgetError(`token 使用达到上限 ${budget.maxTotalTokens}`);
    }
    if (totals.durationMs >= budget.maxDurationMs) {
      throw budgetError(`评测耗时达到上限 ${budget.maxDurationMs}ms`);
    }
    totals.modelCalls += 1;
    return { sequence: totals.modelCalls, startedAt: Date.now(), phase };
  };
  const record = (
    call: ReturnType<typeof beforeCall>,
    request: CottageModelRequest | CottageStructuredRequest<unknown>,
    kind: LiveEvalModelCallRecord['kind'],
    usage?: CottageModelUsage,
  ) => {
    if (
      !usage ||
      (usage.totalTokens === undefined &&
        usage.inputTokens === undefined &&
        usage.outputTokens === undefined)
    ) {
      throw budgetError('模型响应未提供 token usage，无法继续执行硬预算评测');
    }
    totals.inputTokens = (totals.inputTokens ?? 0) + (usage.inputTokens ?? 0);
    totals.outputTokens = (totals.outputTokens ?? 0) + (usage.outputTokens ?? 0);
    totals.totalTokens = (totals.totalTokens ?? 0) +
      (usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0));
    totals.reasoningTokens = (totals.reasoningTokens ?? 0) + (usage.reasoningTokens ?? 0);
    totals.cachedInputTokens = (totals.cachedInputTokens ?? 0) + (usage.cachedInputTokens ?? 0);
    totals.durationMs = Date.now() - startedAt;
    calls.push({
      sequence: call.sequence,
      phase: call.phase,
      kind,
      messageCount: request.messages.length,
      messageCharacters: JSON.stringify(request.messages).length,
      toolCount: 'tools' in request ? request.tools?.length ?? 0 : 0,
      durationMs: Date.now() - call.startedAt,
      usage: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        reasoningTokens: usage.reasoningTokens,
        cachedInputTokens: usage.cachedInputTokens,
      },
    });
    if ((totals.totalTokens ?? 0) > budget.maxTotalTokens) {
      throw budgetError(`token 使用超过上限 ${budget.maxTotalTokens}`);
    }
  };

  const model: CottageModelDriver = {
    getRuntimeIdentity: () => driver.getRuntimeIdentity(),
    async *stream(request: CottageModelRequest, signal?: AbortSignal) {
      const call = beforeCall();
      const deadline = deadlineSignal(signal);
      try {
        for await (const event of driver.stream(request, deadline.signal)) {
          if (event.type === 'finish') record(call, request, 'stream', event.usage);
          yield event as CottageModelEvent;
        }
      } finally {
        deadline.cleanup();
      }
    },
    async generate(request, signal) {
      const call = beforeCall();
      const deadline = deadlineSignal(signal);
      try {
        const response = await driver.generate(request, deadline.signal);
        record(call, request, 'generate', response.usage);
        return response;
      } finally {
        deadline.cleanup();
      }
    },
    async generateObject<T>(request: CottageStructuredRequest<T>, signal?: AbortSignal) {
      const call = beforeCall();
      const deadline = deadlineSignal(signal);
      try {
        const response = await driver.generateObject(request, deadline.signal);
        record(call, request as CottageStructuredRequest<unknown>, 'generateObject', response.usage);
        return response;
      } finally {
        deadline.cleanup();
      }
    },
  };

  return {
    model,
    snapshot: (): LiveEvalUsageTotals => ({ ...totals, durationMs: Date.now() - startedAt }),
    callsSnapshot: (): LiveEvalModelCallRecord[] => calls.map((call) => ({
      ...call,
      usage: { ...call.usage },
    })),
    setPhase: (value: string) => { phase = value || 'unassigned'; },
    getViolation: () => violation,
  };
};
