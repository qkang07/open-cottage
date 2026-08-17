import { describe, expect, it, vi } from 'vitest';
import {
  hydrateAttachmentsForLlm,
  repairToolCallHistory,
  storedToRuntime,
} from './historyAdapter';
import type { StoredMessage } from './messages';
import type { ChatAttachment } from '../chat/attachments';

// storedToRuntime / hydrateAttachmentsForLlm 均不触达真实工作区（resolve 由测试注入）
vi.mock('../chat/attachmentStorage', () => ({
  resolveAttachmentDataUrl: vi.fn(async () => null),
  isAttachmentPath: (data: string) => !data.startsWith('data:'),
}));

const DATA_URL = 'data:image/png;base64,aGVsbG8=';

const att = (data: string, id = 'a1'): ChatAttachment => ({
  id,
  type: 'image',
  filename: 'a.png',
  mimeType: 'image/png',
  data,
});

describe('storedToRuntime attachments', () => {
  it('builds image-only user message with attachment note text', () => {
    const [msg] = storedToRuntime([
      { role: 'user', content: '', attachments: [att(DATA_URL)] },
    ]);
    expect(msg?.role).toBe('user');
    const content = msg!.content as Array<Record<string, unknown>>;
    expect(content).toHaveLength(2);
    expect(content[0]).toMatchObject({
      type: 'text',
      text: '[图片附件 a.png]',
    });
    expect(content[1]).toMatchObject({
      type: 'image',
      url: DATA_URL,
    });
  });

  it('combines text and image parts for user message', () => {
    const [msg] = storedToRuntime([
      { role: 'user', content: '看这张图', attachments: [att(DATA_URL)] },
    ]);
    const content = msg!.content as Array<Record<string, unknown>>;
    expect(content).toHaveLength(2);
    expect(content[0]).toMatchObject({
      type: 'text',
      text: '看这张图\n[图片附件 a.png]',
    });
  });

  it('includes workspace path note for hydrated attachments', () => {
    const hydrated = {
      ...att(DATA_URL),
      sourcePath: '.cottage/attachments/a1.png',
    };
    const [msg] = storedToRuntime([
      { role: 'user', content: '', attachments: [hydrated] },
    ]);
    const content = msg!.content as Array<Record<string, unknown>>;
    expect(content[0]).toMatchObject({
      type: 'text',
      text: '[图片附件 a.png: .cottage/attachments/a1.png]',
    });
  });

  it('skips path-form attachments that were not hydrated', () => {
    const [msg] = storedToRuntime([
      {
        role: 'user',
        content: 'hi',
        attachments: [att('.cottage/attachments/a1.png')],
      },
    ]);
    expect(msg?.role).toBe('user');
    expect(msg!.content).toBe('hi');
  });

  it('emits synthetic user message after tool message with images', () => {
    const converted = storedToRuntime([
      {
        role: 'tool',
        content: '{"savedTo":"shots/a.png"}',
        toolCallId: 'call-1',
        name: 'screenshotPage',
        attachments: [att(DATA_URL)],
      },
    ]);
    expect(converted).toHaveLength(2);
    expect(converted[0]?.role).toBe('tool');
    expect(converted[1]?.role).toBe('user');
    const content = converted[1]!.content as Array<Record<string, unknown>>;
    expect(content[0]).toMatchObject({
      type: 'text',
      text: '[工具 screenshotPage 返回的图片]\n[图片附件 a.png]',
    });
    expect(content[1]).toMatchObject({
      type: 'image',
      url: DATA_URL,
    });
  });

  it('keeps plain tool message when there are no attachments', () => {
    const converted = storedToRuntime([
      { role: 'tool', content: 'ok', toolCallId: 'call-1', name: 'readFile' },
    ]);
    expect(converted).toHaveLength(1);
    expect(converted[0]?.role).toBe('tool');
  });
});

describe('hydrateAttachmentsForLlm', () => {
  const pathMsg: StoredMessage = {
    role: 'user',
    content: '看图',
    attachments: [att('.cottage/attachments/a1.png')],
  };

  it('drops attachments when model lacks vision', async () => {
    const [msg] = await hydrateAttachmentsForLlm([pathMsg], false);
    expect(msg!.attachments).toBeUndefined();
    expect(msg!.content).toBe('看图');
  });

  it('resolves path attachments to data URLs and keeps sourcePath', async () => {
    const resolve = vi.fn(async () => DATA_URL);
    const [msg] = await hydrateAttachmentsForLlm([pathMsg], true, resolve);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(msg!.attachments?.[0]?.data).toBe(DATA_URL);
    expect(msg!.attachments?.[0]?.sourcePath).toBe(
      '.cottage/attachments/a1.png',
    );
  });

  it('filters out attachments that fail to resolve', async () => {
    const resolve = vi.fn(async (a: ChatAttachment) =>
      a.id === 'ok' ? DATA_URL : null,
    );
    const [msg] = await hydrateAttachmentsForLlm(
      [
        {
          role: 'user',
          content: '',
          attachments: [att('.cottage/x.png', 'gone'), att(DATA_URL, 'ok')],
        },
      ],
      true,
      resolve,
    );
    expect(msg!.attachments).toHaveLength(1);
    expect(msg!.attachments?.[0]?.id).toBe('ok');
  });

  it('returns messages without attachments untouched', async () => {
    const plain: StoredMessage = { role: 'assistant', content: 'hello' };
    const [msg] = await hydrateAttachmentsForLlm([plain], true);
    expect(msg).toBe(plain);
  });
});

describe('repairToolCallHistory', () => {
  it('fills a missing legacy call id and reuses it for the tool result', () => {
    const repaired = repairToolCallHistory([
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: '', name: 'readFile', args: { path: 'a.ts' } }],
      },
      { role: 'tool', content: 'ok', name: 'readFile' },
    ]);

    const callId = repaired[0]?.toolCalls?.[0]?.id;
    expect(callId).toBeTruthy();
    expect(repaired[1]?.toolCallId).toBe(callId);
  });

  it('adds an interrupted result for an unfinished tool call', () => {
    const repaired = repairToolCallHistory([
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call-1', name: 'writeFile', args: {} }],
      },
    ]);

    expect(repaired[1]).toMatchObject({
      role: 'tool',
      toolCallId: 'call-1',
      name: 'writeFile',
      interrupted: true,
    });
  });

  it('keeps assistant toolCalls intact after their results are matched', () => {
    // 回归：pendingToolCalls 曾与已入列 assistant 消息共享同一数组引用，
    // 匹配到 tool 结果时 splice 会把 assistant.toolCalls 一并清空，
    // 导致会话重建时工具调用卡片（含 askUser）全部丢失。
    const repaired = repairToolCallHistory([
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'call-a', name: 'readFile', args: {} },
          { id: 'call-b', name: 'askUser', args: {} },
        ],
      },
      { role: 'tool', content: 'ok', toolCallId: 'call-a', name: 'readFile' },
      { role: 'tool', content: '{}', toolCallId: 'call-b', name: 'askUser' },
    ]);

    expect(repaired[0]?.toolCalls?.map((call) => call.id)).toEqual([
      'call-a',
      'call-b',
    ]);
  });
});
