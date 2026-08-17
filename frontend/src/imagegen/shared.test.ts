import { describe, expect, it, vi } from 'vitest';
import { clampImageCount, downloadImageUrls } from './shared';
import { normalizeImageSizeLabel } from './catalog';
import { stripCottageImages } from '../agent/cottageTools';
import { evaluateToolPolicy } from '../platform/policy/policyEngine';

describe('clampImageCount', () => {
  it('defaults to 1', () => {
    expect(clampImageCount(undefined, 4)).toBe(1);
  });

  it('clamps to maxN', () => {
    expect(clampImageCount(9, 4)).toBe(4);
    expect(clampImageCount(0, 4)).toBe(1);
  });
});

describe('normalizeImageSizeLabel', () => {
  it('normalizes dashscope-style separators', () => {
    expect(normalizeImageSizeLabel('1024*1024')).toBe('1024x1024');
    expect(normalizeImageSizeLabel('1024×1024')).toBe('1024x1024');
  });
});

describe('downloadImageUrls', () => {
  it('collects fallback urls when fetch fails', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('CORS blocked');
    }) as unknown as typeof fetch;
    const result = await downloadImageUrls(
      ['https://example.com/a.png'],
      fetchImpl,
    );
    expect(result.images).toHaveLength(0);
    expect(result.fallbackUrls).toEqual(['https://example.com/a.png']);
    expect(result.warnings[0]).toMatch(/CORS|下载失败/);
  });

  it('decodes successful responses', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const fetchImpl = vi.fn(async () =>
      new Response(bytes, {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }),
    ) as unknown as typeof fetch;
    const result = await downloadImageUrls(
      ['https://example.com/a.png'],
      fetchImpl,
    );
    expect(result.images).toHaveLength(1);
    expect(result.images[0].mime).toBe('image/png');
    expect([...result.images[0].bytes]).toEqual([1, 2, 3]);
  });
});

describe('stripCottageImages', () => {
  it('strips cottageImages and returns paths', () => {
    const { output, imagePaths } = stripCottageImages({
      savedTo: ['images/a.png'],
      cottageImages: ['images/a.png', 'images/b.png'],
      note: 'ok',
    });
    expect(imagePaths).toEqual(['images/a.png', 'images/b.png']);
    expect(output).toEqual({
      savedTo: ['images/a.png'],
      note: 'ok',
    });
  });
});

describe('evaluateToolPolicy image gen n>1', () => {
  it('requires confirmation when n > 1', () => {
    const decision = evaluateToolPolicy(
      'generateImage',
      { requireApprovalFor: [] },
      { prompt: 'a cat', n: 3 },
    );
    expect(decision.action).toBe('confirm');
    if (decision.action === 'confirm') {
      expect(decision.message).toMatch(/3/);
    }
  });

  it('allows single image without n gate', () => {
    const decision = evaluateToolPolicy(
      'generateImage',
      { requireApprovalFor: [] },
      { prompt: 'a cat', n: 1 },
    );
    expect(decision.action).toBe('allow');
  });
});
