import { describe, expect, it } from 'vitest';
import { sliceTextFileContent } from './readFileSlice';

describe('sliceTextFileContent', () => {
  const sample = ['a', 'b', 'c', 'd', 'e'].join('\n');

  it('returns full content by default (within maxChars)', () => {
    const sliced = sliceTextFileContent(sample);
    expect(sliced.content).toBe(sample);
    expect(sliced.totalLines).toBe(5);
    expect(sliced.startLine).toBe(1);
    expect(sliced.endLine).toBe(5);
    expect(sliced.truncatedByLines).toBe(false);
    expect(sliced.truncatedByChars).toBe(false);
  });

  it('supports 1-based offset and limit', () => {
    const sliced = sliceTextFileContent(sample, { offset: 2, limit: 2 });
    expect(sliced.content).toBe('b\nc');
    expect(sliced.startLine).toBe(2);
    expect(sliced.endLine).toBe(3);
    expect(sliced.truncatedByLines).toBe(true);
  });

  it('truncates by maxChars', () => {
    const sliced = sliceTextFileContent(sample, { maxChars: 3 });
    expect(sliced.content).toBe('a\nb'.slice(0, 3));
    expect(sliced.truncatedByChars).toBe(true);
  });
});
