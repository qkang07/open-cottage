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
export const createReplayModelDriver = (
  options: CreateReplayModelOptions = {},
): CottageModelDriver => {
  const identity: CottageModelRuntimeIdentity = {
    ...defaultIdentity,
    ...options.identity,
  };
  let streamIndex = 0;
  let generationIndex = 0;
  let structuredIndex = 0;

  return {
    getRuntimeIdentity: () => ({ ...identity }),
    async *stream(
      _request: CottageModelRequest,
      signal?: AbortSignal,
    ): AsyncIterable<CottageModelEvent> {
      const events = options.streams?.[streamIndex++];
      if (!events) throw exhausted('stream');
      for (const event of events) {
        if (signal?.aborted) return;
        yield event;
      }
    },
    async generate(
      _request: CottageModelRequest,
      signal?: AbortSignal,
    ): Promise<CottageAssistantResponse> {
      if (signal?.aborted) throw signal.reason;
      const response = options.generations?.[generationIndex++];
      if (!response) throw exhausted('generate');
      return { ...response };
    },
    async generateObject<T>(
      request: CottageStructuredRequest<T>,
      signal?: AbortSignal,
    ): Promise<CottageStructuredResponse<T>> {
      if (signal?.aborted) throw signal.reason;
      if (!options.structured || structuredIndex >= options.structured.length) {
        throw exhausted('generateObject');
      }
      const value = request.schema.parse(options.structured[structuredIndex++]);
      return { value };
    },
  };
};
