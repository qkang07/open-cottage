import type {
  CottageAssistantResponse,
  CottageModelDriver,
  CottageModelEvent,
  CottageModelRequest,
  CottageModelRuntimeIdentity,
  CottageStructuredRequest,
  CottageStructuredResponse,
} from './model';

export interface CottageReplayFixture {
  streams?: readonly (readonly CottageModelEvent[])[];
  generations?: readonly CottageAssistantResponse[];
  structured?: readonly unknown[];
}

export interface CreateReplayModelOptions extends CottageReplayFixture {
  identity?: Partial<CottageModelRuntimeIdentity>;
  onRequest?: (call: CottageReplayCapturedCall) => void;
}

export type CottageReplayOperation = 'stream' | 'generate' | 'generateObject';

export interface CottageReplayCapturedCall {
  operation: CottageReplayOperation;
  request: CottageModelRequest | CottageStructuredRequest<unknown>;
}

export interface CottageReplayModelController {
  driver: CottageModelDriver;
  calls: CottageReplayCapturedCall[];
  assertExhausted(): void;
}

const defaultIdentity: CottageModelRuntimeIdentity = {
  provider: 'replay',
  model: 'fixture',
  baseUrl: 'replay://local',
};

const exhausted = (operation: string): Error =>
  new Error(`Replay model fixture exhausted for ${operation}`);

/**
 * 纯内存、无网络的确定性模型驱动。用于复现流式边界、工具调用和历史回归，
 * 每次调用按数组顺序消费一组 fixture，避免测试意外复用旧响应。
 */
export const createReplayModelController = (
  options: CreateReplayModelOptions = {},
): CottageReplayModelController => {
  const identity: CottageModelRuntimeIdentity = {
    ...defaultIdentity,
    ...options.identity,
  };
  const calls: CottageReplayCapturedCall[] = [];
  let streamIndex = 0;
  let generationIndex = 0;
  let structuredIndex = 0;

  const capture = (call: CottageReplayCapturedCall) => {
    calls.push(call);
    options.onRequest?.(call);
  };

  const driver: CottageModelDriver = {
    getRuntimeIdentity: () => ({ ...identity }),
    async *stream(
      request: CottageModelRequest,
      signal?: AbortSignal,
    ): AsyncIterable<CottageModelEvent> {
      capture({ operation: 'stream', request });
      const events = options.streams?.[streamIndex++];
      if (!events) throw exhausted('stream');
      for (const event of events) {
        if (signal?.aborted) return;
        yield event;
      }
    },
    async generate(
      request: CottageModelRequest,
      signal?: AbortSignal,
    ): Promise<CottageAssistantResponse> {
      capture({ operation: 'generate', request });
      if (signal?.aborted) throw signal.reason;
      const response = options.generations?.[generationIndex++];
      if (!response) throw exhausted('generate');
      return { ...response };
    },
    async generateObject<T>(
      request: CottageStructuredRequest<T>,
      signal?: AbortSignal,
    ): Promise<CottageStructuredResponse<T>> {
      capture({
        operation: 'generateObject',
        request: request as CottageStructuredRequest<unknown>,
      });
      if (signal?.aborted) throw signal.reason;
      if (!options.structured || structuredIndex >= options.structured.length) {
        throw exhausted('generateObject');
      }
      const value = request.schema.parse(options.structured[structuredIndex++]);
      return { value };
    },
  };

  return {
    driver,
    calls,
    assertExhausted() {
      const remaining = [
        ['stream', (options.streams?.length ?? 0) - streamIndex],
        ['generate', (options.generations?.length ?? 0) - generationIndex],
        ['generateObject', (options.structured?.length ?? 0) - structuredIndex],
      ]
        .filter(([, count]) => Number(count) !== 0)
        .map(([operation, count]) => `${operation}:${count}`);
      if (remaining.length > 0) {
        throw new Error(`Replay model fixture was not fully consumed (${remaining.join(', ')})`);
      }
    },
  };
};

export const createReplayModelDriver = (
  options: CreateReplayModelOptions = {},
): CottageModelDriver => createReplayModelController(options).driver;
