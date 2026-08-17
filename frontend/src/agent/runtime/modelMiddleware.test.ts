import { describe, expect, it, vi } from 'vitest';
import { createReplayModelDriver } from './replay';
import { withCottageModelMiddleware } from './modelMiddleware';

describe('withCottageModelMiddleware', () => {
  it('records one stable request id with latency and usage', async () => {
    const onCallStart = vi.fn();
    const onCallFinish = vi.fn();
    const driver = withCottageModelMiddleware(
      createReplayModelDriver({
        streams: [
          [
            { type: 'text-delta', text: 'ok' },
            {
              type: 'finish',
              finishReason: 'stop',
              usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
            },
          ],
        ],
      }),
      [{ onCallStart, onCallFinish }],
    );

    const events = [];
    for await (const event of driver.stream({ messages: [] })) events.push(event);

    const started = onCallStart.mock.calls[0]?.[0];
    const finished = onCallFinish.mock.calls[0]?.[0];
    expect(started.metrics.requestId).toBe(finished.metrics.requestId);
    expect(finished.operation).toBe('stream');
    expect(finished.usage.totalTokens).toBe(3);
    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        type: 'finish',
        metrics: expect.objectContaining({ requestId: started.metrics.requestId }),
      }),
    );
  });
});
