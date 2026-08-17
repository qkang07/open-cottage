import { describe, expect, it } from 'vitest';
import { fromModelsDevEntry, modelSupportsVision } from './modelCatalog';

describe('modelSupportsVision', () => {
  it('only allows models explicitly marked vision: true', () => {
    expect(modelSupportsVision({ vision: false })).toBe(false);
    expect(modelSupportsVision({ vision: true })).toBe(true);
    // 能力未知时保守拦截，避免向不支持视觉的模型发送图片。
    expect(modelSupportsVision({})).toBe(false);
    expect(modelSupportsVision(null)).toBe(false);
    expect(modelSupportsVision(undefined)).toBe(false);
  });
});

describe('fromModelsDevEntry modalities parsing', () => {
  it('marks vision true when input modalities include image', () => {
    const option = fromModelsDevEntry({
      id: 'gpt-x',
      modalities: { input: ['text', 'image'] },
    });
    expect(option.vision).toBe(true);
  });

  it('marks vision false for text-only input modalities', () => {
    const option = fromModelsDevEntry({
      id: 'text-only',
      modalities: { input: ['text'] },
    });
    expect(option.vision).toBe(false);
  });

  it('leaves vision undefined when modalities are missing', () => {
    expect(fromModelsDevEntry({ id: 'unknown' }).vision).toBeUndefined();
    expect(
      fromModelsDevEntry({ id: 'no-input', modalities: {} }).vision,
    ).toBeUndefined();
  });
});
