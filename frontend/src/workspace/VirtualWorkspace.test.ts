import { describe, expect, it } from 'vitest';
import { usageAfterRemoval, usageAfterWrite } from './VirtualWorkspace';

describe('virtual workspace usage accounting', () => {
  it('adds a new file payload', () => {
    expect(usageAfterWrite(128, 0, 64)).toBe(192);
  });

  it('replaces the previous file payload instead of double counting', () => {
    expect(usageAfterWrite(256, 100, 40)).toBe(196);
    expect(usageAfterWrite(256, 40, 100)).toBe(316);
  });

  it('never reports a negative size after recovery from stale metadata', () => {
    expect(usageAfterRemoval(10, 20)).toBe(0);
    expect(usageAfterWrite(10, 20, 0)).toBe(0);
  });
});

