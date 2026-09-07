import { describe, expect, it } from 'vitest';
import { loadLiveEvalConfig, validateLiveEvalConfig } from './config';

const base = {
  COTTAGE_LIVE_PROVIDER: 'openai',
  COTTAGE_LIVE_MODEL: 'test-model',
  COTTAGE_LIVE_API_KEY_ENV: 'TEST_LIVE_KEY',
  TEST_LIVE_KEY: 'secret-value',
  COTTAGE_LIVE_DRY_RUN: '1',
};

describe('live eval configuration', () => {
  it('requires explicit mode and reads the key only through the named environment variable', () => {
    const config = loadLiveEvalConfig(base);
    expect(config.apiKey).toBe('secret-value');
    expect(config.apiKeyEnv).toBe('TEST_LIVE_KEY');
    expect(config.dryRun).toBe(true);
    expect(validateLiveEvalConfig(config)).toEqual([]);
  });

  it('rejects unknown providers instead of silently selecting a compatible default', () => {
    expect(() => loadLiveEvalConfig({ ...base, COTTAGE_LIVE_PROVIDER: 'typo-provider' }))
      .toThrow('不支持的 provider');
  });

  it('accepts provider display casing but keeps the exact known provider id', () => {
    expect(loadLiveEvalConfig({ ...base, COTTAGE_LIVE_PROVIDER: 'OpenRouter' }).provider)
      .toBe('openrouter');
  });

  it('enforces static safety ceilings', () => {
    const config = loadLiveEvalConfig({
      ...base,
      COTTAGE_LIVE_MAX_CASES: '31',
      COTTAGE_LIVE_MAX_MODEL_CALLS: '201',
    });
    expect(validateLiveEvalConfig(config)).toEqual([
      '单次真实模型评测最多允许 30 个 case',
      '单次真实模型评测最多允许 200 次模型调用',
    ]);
  });
});
