import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ImageUrlImportError,
  downloadImageBlob,
  sniffImageMime,
  validateImageUrl,
} from './imageUrlImport';
import { getCottageConfig } from '../config/store';

vi.mock('../config/store', () => ({
  getCottageConfig: vi.fn(() => ({ vision: {} })),
}));

const PNG_MAGIC = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);

const imageResponse = (
  bytes: Uint8Array = PNG_MAGIC,
  contentType = 'image/png',
): Response =>
  new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { 'content-type': contentType },
  });

const reasonOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'no-error';
  } catch (error) {
    if (error instanceof ImageUrlImportError) return error.reason;
    throw error;
  }
};

beforeEach(() => {
  vi.mocked(getCottageConfig).mockReturnValue({ vision: {} });
});

describe('validateImageUrl', () => {
  it('accepts http/https and rejects others', () => {
    expect(validateImageUrl(' https://a.com/x.png ').href).toBe(
      'https://a.com/x.png',
    );
    expect(() => validateImageUrl('not a url')).toThrowError(
      ImageUrlImportError,
    );
    expect(() => validateImageUrl('ftp://a.com/x.png')).toThrowError(
      ImageUrlImportError,
    );
  });
});

describe('sniffImageMime', () => {
  it('detects common magic numbers', () => {
    expect(sniffImageMime(PNG_MAGIC)).toBe('image/png');
    expect(
      sniffImageMime(
        new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      ),
    ).toBe('image/jpeg');
    expect(sniffImageMime(new TextEncoder().encode('<html>hello</html>'))).toBe(
      null,
    );
    expect(sniffImageMime(new Uint8Array(4))).toBe(null);
  });
});

describe('downloadImageBlob', () => {
  const url = new URL('https://img.example.com/pic.png');

  it('downloads directly when fetch succeeds', async () => {
    const fetchFn = vi.fn(async () => imageResponse());
    const { blob, mimeType } = await downloadImageBlob(url, {
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(mimeType).toBe('image/png');
    expect(blob.size).toBe(PNG_MAGIC.length);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('sniffs mime when content-type is not an image', async () => {
    const fetchFn = vi.fn(async () =>
      imageResponse(PNG_MAGIC, 'application/octet-stream'),
    );
    const { mimeType } = await downloadImageBlob(url, {
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(mimeType).toBe('image/png');
  });

  it('rejects non-image content', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response('<html></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    );
    expect(
      await reasonOf(
        downloadImageBlob(url, { fetchFn: fetchFn as unknown as typeof fetch }),
      ),
    ).toBe('not_image');
  });

  it('rejects oversized downloads', async () => {
    vi.mocked(getCottageConfig).mockReturnValue({
      vision: { maxImageBytes: 1 },
    } as ReturnType<typeof getCottageConfig>);
    const fetchFn = vi.fn(async () => imageResponse());
    expect(
      await reasonOf(
        downloadImageBlob(url, { fetchFn: fetchFn as unknown as typeof fetch }),
      ),
    ).toBe('too_large');
  });

  it('reports cors_no_service when direct fetch fails without service', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(
      await reasonOf(
        downloadImageBlob(url, { fetchFn: fetchFn as unknown as typeof fetch }),
      ),
    ).toBe('cors_no_service');
  });

  it('falls back to cottage service proxy on direct fetch failure', async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const href = typeof input === 'string' ? input : String(input);
      if (href === url.href) throw new TypeError('Failed to fetch');
      expect(href).toBe('http://127.0.0.1:8787/proxy');
      return imageResponse();
    });
    const { mimeType } = await downloadImageBlob(url, {
      serviceBaseUrl: 'http://127.0.0.1:8787',
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(mimeType).toBe('image/png');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('reports plain http error without proxy fallback', async () => {
    const fetchFn = vi.fn(async () => new Response('nope', { status: 404 }));
    expect(
      await reasonOf(
        downloadImageBlob(url, { fetchFn: fetchFn as unknown as typeof fetch }),
      ),
    ).toBe('network');
  });
});
