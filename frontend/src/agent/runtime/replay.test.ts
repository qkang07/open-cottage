import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createReplayModelDriver } from './replay';

describe('createReplayModelDriver', () => {
  it('replays stream fixtures in order without a provider call', async () => {
    const driver = createReplayModelDriver({
      streams: [
        [
          { type: 'text-delta', text: 'hello' },
          { type: 'finish', finishReason: 'stop' },
        ],
      ],
    });
    const events = [];
    for await (const event of driver.stream({ messages: [] })) events.push(event);
    expect(events).toEqual([
      { type: 'text-delta', text: 'hello' },
      { type: 'finish', finishReason: 'stop' },
    ]);
  });

  it('validates structured fixtures with the request schema', async () => {
    const driver = createReplayModelDriver({ structured: [{ answer: 42 }] });
    const response = await driver.generateObject({
      messages: [],
      schema: z.object({ answer: z.number() }),
    });
    expect(response.value).toEqual({ answer: 42 });
  });

  it('fails visibly when an operation fixture is exhausted', async () => {
    const driver = createReplayModelDriver();
    await expect(driver.generate({ messages: [] })).rejects.toThrow(
      'fixture exhausted for generate',
    );
  });
});
