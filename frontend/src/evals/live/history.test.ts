import { describe, expect, it } from 'vitest';
import { sortLiveEvalHistory, type StoredLiveEvalReport } from './history';

describe('live eval history', () => {
  it('sorts newest reports first without mutating the input', () => {
    const older = { id: 'old', generatedAt: '2026-01-01T00:00:00.000Z' };
    const newer = { id: 'new', generatedAt: '2026-01-02T00:00:00.000Z' };
    const input = [older, newer] as StoredLiveEvalReport[];

    expect(sortLiveEvalHistory(input).map((item) => item.id)).toEqual(['new', 'old']);
    expect(input.map((item) => item.id)).toEqual(['old', 'new']);
  });
});
