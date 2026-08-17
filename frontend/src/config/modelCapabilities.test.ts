import { describe, expect, it } from 'vitest';
import {
  resolveCottageModelCapabilities,
  supportsThinkingControl,
  supportsVisionInput,
} from './modelCapabilities';

describe('model capabilities', () => {
  it('keeps unknown distinct from unsupported', () => {
    const capabilities = resolveCottageModelCapabilities({
      provider: 'openai_compatible',
      model: 'custom-model',
    });

    expect(capabilities.vision).toBe('unknown');
    expect(capabilities.tools).toBe('unknown');
    expect(capabilities.structuredOutput).toBe('unknown');
    expect(supportsVisionInput(capabilities)).toBe(false);
  });

  it('combines catalog and provider capabilities', () => {
    const capabilities = resolveCottageModelCapabilities(
      { provider: 'google', model: 'gemini-test' },
      {
        id: 'gemini-test',
        label: 'Gemini Test',
        temperature: true,
        reasoning: true,
        reasoningEffortValues: ['low', 'high'],
        vision: true,
        tools: true,
        contextLimit: 128_000,
      },
    );

    expect(capabilities.nativeSearch).toBe(true);
    expect(capabilities.temperature).toBe(true);
    expect(capabilities.contextLimit).toBe(128_000);
    expect(supportsThinkingControl(capabilities)).toBe(true);
    expect(supportsVisionInput(capabilities)).toBe(true);
  });
});
