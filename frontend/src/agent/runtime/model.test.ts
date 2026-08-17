import { describe, expect, it } from 'vitest';
import {
  assertModelRuntimeIdentity,
  CottageModelBindingError,
} from './model';

describe('assertModelRuntimeIdentity', () => {
  it('accepts the exact provider, model and connection binding', () => {
    expect(() =>
      assertModelRuntimeIdentity(
        {
          provider: 'minimax',
          model: 'minimax-m3',
          connectionId: 'connection-1',
          baseUrl: 'https://api.example.test/v1',
        },
        {
          provider: 'minimax',
          model: 'minimax-m3',
          connectionId: 'connection-1',
        },
      ),
    ).not.toThrow();
  });

  it('blocks a stale GPT runtime when the UI expects MiniMax', () => {
    expect(() =>
      assertModelRuntimeIdentity(
        {
          provider: 'openai',
          model: 'gpt-5.6-luna',
          baseUrl: 'https://api.openai.com/v1',
        },
        { provider: 'minimax', model: 'minimax-m3' },
      ),
    ).toThrow(CottageModelBindingError);
  });
});
