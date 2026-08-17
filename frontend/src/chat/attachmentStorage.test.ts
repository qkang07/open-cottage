import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatAttachment } from './attachments';
import {
  bytesToDataUrl,
  dataUrlToBytes,
  isAttachmentPath,
  mimeFromPath,
  persistAttachment,
  resolveAttachmentDataUrl,
  type AttachmentIo,
} from './attachmentStorage';
import { getCottageConfig } from '../config/store';

vi.mock('../config/store', () => ({
  getCottageConfig: vi.fn(() => ({ vision: {} })),
}));
vi.mock('../workspace/FileSystemWorkspace', () => ({
  workspace: { isOpen: false },
}));

const PNG_DATA_URL = 'data:image/png;base64,aGVsbG8='; // "hello"

const makeAttachment = (data: string): ChatAttachment => ({
  id: 'att-1',
  type: 'image',
  filename: 'a.png',
  mimeType: 'image/png',
  data,
});

/** 内存版附件 IO，模拟工作区读写 */
const memoryIo = (): AttachmentIo & { files: Map<string, Uint8Array> } => {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    isOpen: true,
    writeFileBytes: async (path, bytes) => {
      files.set(path, bytes);
    },
    readFileBytes: async (path) => {
      const bytes = files.get(path);
      if (!bytes) throw new Error(`missing: ${path}`);
      return bytes;
    },
  };
};

beforeEach(() => {
  vi.mocked(getCottageConfig).mockReturnValue({ vision: {} });
});

describe('attachmentStorage', () => {
  it('detects path vs data URL', () => {
    expect(isAttachmentPath(PNG_DATA_URL)).toBe(false);
    expect(isAttachmentPath('.cottage/attachments/a.png')).toBe(true);
  });

  it('maps extension to mime with fallback', () => {
    expect(mimeFromPath('shots/a.png')).toBe('image/png');
    expect(mimeFromPath('a.JPG')).toBe('image/jpeg');
    expect(mimeFromPath('a.jpeg')).toBe('image/jpeg');
    expect(mimeFromPath('a.webp')).toBe('image/webp');
    expect(mimeFromPath('a.unknown')).toBe('image/png');
  });

  it('round-trips data URL to bytes and back', () => {
    const { bytes, mimeType } = dataUrlToBytes(PNG_DATA_URL);
    expect(mimeType).toBe('image/png');
    expect(new TextDecoder().decode(bytes)).toBe('hello');
    expect(bytesToDataUrl(bytes, mimeType)).toBe(PNG_DATA_URL);
  });

  it('persists to workspace path and resolves back', async () => {
    const io = memoryIo();
    const persisted = await persistAttachment(makeAttachment(PNG_DATA_URL), io);
    expect(persisted.data).toBe('.cottage/attachments/att-1.png');
    expect(io.files.has(persisted.data)).toBe(true);

    const resolved = await resolveAttachmentDataUrl(persisted, io);
    expect(resolved).toBe(PNG_DATA_URL);
  });

  it('returns null when the persisted file is missing', async () => {
    const io = memoryIo();
    const missing = makeAttachment('.cottage/attachments/gone.png');
    expect(await resolveAttachmentDataUrl(missing, io)).toBeNull();
  });

  it('bypasses persistence in inline-base64 mode', async () => {
    vi.mocked(getCottageConfig).mockReturnValue({
      vision: { storage: 'inline-base64' },
    } as ReturnType<typeof getCottageConfig>);
    const io = memoryIo();
    const att = makeAttachment(PNG_DATA_URL);
    const persisted = await persistAttachment(att, io);
    expect(persisted).toBe(att);
    expect(io.files.size).toBe(0);
  });

  it('keeps inline data when workspace is closed or write fails', async () => {
    const closed = await persistAttachment(makeAttachment(PNG_DATA_URL), {
      isOpen: false,
      writeFileBytes: async () => {},
      readFileBytes: async () => new Uint8Array(),
    });
    expect(closed.data).toBe(PNG_DATA_URL);

    const failing = await persistAttachment(makeAttachment(PNG_DATA_URL), {
      isOpen: true,
      writeFileBytes: async () => {
        throw new Error('quota');
      },
      readFileBytes: async () => new Uint8Array(),
    });
    expect(failing.data).toBe(PNG_DATA_URL);
  });

  it('respects custom attachmentsDir from config', async () => {
    vi.mocked(getCottageConfig).mockReturnValue({
      vision: { attachmentsDir: 'assets/img/' },
    } as ReturnType<typeof getCottageConfig>);
    const io = memoryIo();
    const persisted = await persistAttachment(makeAttachment(PNG_DATA_URL), io);
    expect(persisted.data).toBe('assets/img/att-1.png');
  });
});
