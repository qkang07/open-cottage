import { describe, expect, it } from 'vitest';
import { validateEvalRootMarker } from './directoryWorkspace';

describe('live eval directory marker', () => {
  it('accepts only the dedicated root marker schema', () => {
    expect(validateEvalRootMarker({
      schemaVersion: 1,
      kind: 'open-cottage-live-eval-root',
      createdAt: '2026-09-06T00:00:00.000Z',
    })).toBe(true);
    expect(validateEvalRootMarker({ schemaVersion: 1, kind: 'other' })).toBe(false);
    expect(validateEvalRootMarker({
      schemaVersion: 1,
      kind: 'open-cottage-live-eval-root',
    })).toBe(false);
    expect(validateEvalRootMarker(null)).toBe(false);
  });
});
