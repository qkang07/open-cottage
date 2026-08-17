import type {
  CottageAssistantResponse,
  CottageModelDriver,
  CottageModelEvent,
  CottageModelMetrics,
  CottageModelRequest,
  CottageModelRuntimeIdentity,
  CottageModelUsage,
  CottageStructuredRequest,
  CottageStructuredResponse,
} from './model';

export type CottageModelOperation = 'stream' | 'generate' | 'generateObject';

export interface CottageModelCallSummary {
  operation: CottageModelOperation;
  identity: CottageModelRuntimeIdentity;
  metrics: CottageModelMetrics;
  usage?: CottageModelUsage;
  finishReason?: string;
  error?: string;
}

export interface CottageModelMiddleware {
  onCallStart?(event: Omit<CottageModelCallSummary, 'usage' | 'finishReason' | 'error'>):
    | void
    | Promise<void>;
  onCallFinish?(event: CottageModelCallSummary): void | Promise<void>;
}

const requestId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `model_${Date.now()}_${Math.random().toString(36).slice(2)}`;

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const callMetrics = (
  id: string,
  startedAt: number,
  firstTokenAt?: number,
): CottageModelMetrics => ({
  requestId: id,
  startedAt,
  durationMs: Math.max(0, Date.now() - startedAt),
  firstTokenMs:
    firstTokenAt === undefined ? undefined : Math.max(0, firstTokenAt - startedAt),
});

export const withCottageModelMiddleware = (
  driver: CottageModelDriver,
  middleware: readonly CottageModelMiddleware[] = [],
): CottageModelDriver => {
  const notifyStart = async (
    operation: CottageModelOperation,
    metrics: CottageModelMetrics,
  ) => {
    for (const item of middleware) {
      try {
        await item.onCallStart?.({
          operation,
          identity: driver.getRuntimeIdentity(),
          metrics,
        });
      } catch (error) {
        console.warn('[ModelMiddleware] onCallStart failed:', error);
      }
    }
  };
  const notifyFinish = async (event: CottageModelCallSummary) => {
    for (const item of middleware) {
      try {
        await item.onCallFinish?.(event);
      } catch (error) {
        console.warn('[ModelMiddleware] onCallFinish failed:', error);
      }
    }
  };

  return {
    getRuntimeIdentity: () => driver.getRuntimeIdentity(),
    async *stream(
      request: CottageModelRequest,
      signal?: AbortSignal,
    ): AsyncIterable<CottageModelEvent> {
      const startedAt = Date.now();
      const id = requestId();
      const initialMetrics = callMetrics(id, startedAt);
      await notifyStart('stream', initialMetrics);
      let firstTokenAt: number | undefined;
      let usage: CottageModelUsage | undefined;
      let finishReason: string | undefined;
      let terminalError: string | undefined;
      try {
        for await (const event of driver.stream(request, signal)) {
          if (
            firstTokenAt === undefined &&
            (event.type === 'text-delta' ||
              event.type === 'reasoning-delta' ||
              event.type === 'tool-input-start' ||
              event.type === 'tool-call')
          ) {
            firstTokenAt = Date.now();
          }
          if (event.type === 'finish') {
            usage = event.usage;
            finishReason = event.finishReason;
            yield {
              ...event,
              metrics: callMetrics(id, startedAt, firstTokenAt),
            };
          } else {
            if (event.type === 'error') terminalError = errorText(event.error);
            yield event;
          }
        }
      } catch (error) {
        terminalError = errorText(error);
        throw error;
      } finally {
        await notifyFinish({
          operation: 'stream',
          identity: driver.getRuntimeIdentity(),
          metrics: callMetrics(id, startedAt, firstTokenAt),
          usage,
          finishReason,
          error: terminalError,
        });
      }
    },
    async generate(
      request: CottageModelRequest,
      signal?: AbortSignal,
    ): Promise<CottageAssistantResponse> {
      const startedAt = Date.now();
      const id = requestId();
      await notifyStart('generate', callMetrics(id, startedAt));
      try {
        const response = await driver.generate(request, signal);
        const metrics = callMetrics(id, startedAt);
        const enriched = { ...response, metrics };
        await notifyFinish({
          operation: 'generate',
          identity: driver.getRuntimeIdentity(),
          metrics,
          usage: response.usage,
          finishReason: response.finishReason,
        });
        return enriched;
      } catch (error) {
        await notifyFinish({
          operation: 'generate',
          identity: driver.getRuntimeIdentity(),
          metrics: callMetrics(id, startedAt),
          error: errorText(error),
        });
        throw error;
      }
    },
    async generateObject<T>(
      request: CottageStructuredRequest<T>,
      signal?: AbortSignal,
    ): Promise<CottageStructuredResponse<T>> {
      const startedAt = Date.now();
      const id = requestId();
      await notifyStart('generateObject', callMetrics(id, startedAt));
      try {
        const response = await driver.generateObject(request, signal);
        const metrics = callMetrics(id, startedAt);
        const enriched = { ...response, metrics };
        await notifyFinish({
          operation: 'generateObject',
          identity: driver.getRuntimeIdentity(),
          metrics,
          usage: response.usage,
          finishReason: response.finishReason,
        });
        return enriched;
      } catch (error) {
        await notifyFinish({
          operation: 'generateObject',
          identity: driver.getRuntimeIdentity(),
          metrics: callMetrics(id, startedAt),
          error: errorText(error),
        });
        throw error;
      }
    },
  };
};
