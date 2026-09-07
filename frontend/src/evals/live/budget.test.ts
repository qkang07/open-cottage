import { describe, expect, it } from 'vitest';
import type { CottageModelDriver } from '../../agent/runtime/model';
import { createLiveEvalBudgetedModel, LiveEvalBudgetError } from './budget';

const fakeModel = (): CottageModelDriver => ({
  getRuntimeIdentity: () => ({
    provider: 'fake',
    model: 'fake-model',
    baseUrl: 'https://example.invalid',
  }),
  async *stream() {
    yield {
      type: 'finish',
      finishReason: 'stop',
      usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
    };
  },
  async generate() {
    return {
      content: 'ok',
      usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
    };
  },
  async generateObject<T>() {
    return { value: {} as T, usage: { totalTokens: 5 } };
  },
});

const budget = {
  maxCases: 1,
  maxModelCalls: 1,
  maxTotalTokens: 10,
  maxDurationMs: 10_000,
  maxOutputTokens: 100,
};

describe('live eval budgeted model', () => {
  it('accounts usage and blocks calls beyond the configured maximum', async () => {
    const wrapped = createLiveEvalBudgetedModel(fakeModel(), budget);
    wrapped.setPhase('plan-step:test');
    await wrapped.model.generate({ messages: [{ role: 'user', content: 'continue' }] });
    expect(wrapped.snapshot()).toMatchObject({
      modelCalls: 1,
      inputTokens: 3,
      outputTokens: 2,
      totalTokens: 5,
    });
    expect(wrapped.callsSnapshot()).toEqual([
      expect.objectContaining({
        sequence: 1,
        phase: 'plan-step:test',
        kind: 'generate',
        messageCount: 1,
        usage: expect.objectContaining({ totalTokens: 5 }),
      }),
    ]);
    await expect(wrapped.model.generate({ messages: [] })).rejects.toBeInstanceOf(
      LiveEvalBudgetError,
    );
  });

  it('stops after a response crosses the total token budget', async () => {
    const wrapped = createLiveEvalBudgetedModel(fakeModel(), {
      ...budget,
      maxModelCalls: 2,
      maxTotalTokens: 4,
    });
    await expect(wrapped.model.generate({ messages: [] })).rejects.toThrow(
      'token 使用超过上限 4',
    );
    expect(wrapped.snapshot().totalTokens).toBe(5);
    expect(wrapped.getViolation()).toContain('token 使用超过上限 4');
  });

  it('fails closed when a provider omits token usage', async () => {
    const withoutUsage: CottageModelDriver = {
      ...fakeModel(),
      async generate() {
        return { content: 'usage omitted' };
      },
    };
    const wrapped = createLiveEvalBudgetedModel(withoutUsage, budget);
    await expect(wrapped.model.generate({ messages: [] })).rejects.toThrow(
      '未提供 token usage',
    );
    expect(wrapped.getViolation()).toContain('无法继续执行硬预算评测');
  });
});
