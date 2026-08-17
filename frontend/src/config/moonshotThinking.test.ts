import { describe, expect, it } from 'vitest';
import {
  applyMoonshotThinkingBody,
  defaultThinkingForModel,
  supportsMoonshotThinking,
} from './moonshotThinking';

describe('supportsMoonshotThinking', () => {
  it('matches kimi-k2 family', () => {
    expect(supportsMoonshotThinking('kimi-k2.6')).toBe(true);
    expect(supportsMoonshotThinking('kimi-k2.5')).toBe(true);
    expect(supportsMoonshotThinking('kimi-k2-turbo')).toBe(true);
  });

  it('does not match legacy moonshot-v1-8k', () => {
    expect(supportsMoonshotThinking('moonshot-v1-8k')).toBe(false);
  });
});

describe('applyMoonshotThinkingBody', () => {
  it('fills reasoning_content on assistant messages and enables thinking for k2.6', () => {
    const body = applyMoonshotThinkingBody({
      model: 'kimi-k2.6',
      messages: [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: '1', type: 'function', function: { name: 'x', arguments: '{}' } }],
        },
      ],
    });

    const messages = body.messages as { role: string; reasoning_content?: string }[];
    expect(messages[1].reasoning_content).toBe(' ');
    expect(body.thinking).toEqual({ type: 'enabled', keep: 'all' });
  });

  it('only patches reasoning for non-thinking models', () => {
    const body = applyMoonshotThinkingBody({
      model: 'moonshot-v1-8k',
      messages: [{ role: 'assistant', content: 'ok' }],
    });

    expect(body.thinking).toBeUndefined();
    const messages = body.messages as { reasoning_content?: string }[];
    expect(messages[0].reasoning_content).toBe(' ');
  });
});

describe('defaultThinkingForModel', () => {
  it('uses keep all for k2.6', () => {
    expect(defaultThinkingForModel('kimi-k2.6')).toEqual({
      type: 'enabled',
      keep: 'all',
    });
  });
});
