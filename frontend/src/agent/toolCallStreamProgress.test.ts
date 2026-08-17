import { describe, expect, it } from 'vitest';
import {
  mergeToolCallChunks,
  type CottageToolCallChunk,
} from './toolCallStreamProgress';

describe('mergeToolCallChunks', () => {
  it('按 index 合并 arguments 碎片', () => {
    const chunks: CottageToolCallChunk[] = [
      { name: 'writeFile', args: '{"path":"a.ts","content":"', index: 0 },
      { name: '', args: 'hello', index: 0 },
      { name: '', args: '"}', index: 0 },
    ];
    expect(mergeToolCallChunks(chunks)).toEqual([
      {
        id: 'index:0',
        name: 'writeFile',
        args: '{"path":"a.ts","content":"hello"}',
      },
    ]);
  });

  it('保留 call id', () => {
    const chunks: CottageToolCallChunk[] = [
      {
        name: 'writeFile',
        args: '{"path":"a.ts"',
        id: 'call_abc',
        index: 0,
      },
      { name: '', args: '}', id: 'call_abc', index: 0 },
    ];
    expect(mergeToolCallChunks(chunks)).toEqual([
      { id: 'call_abc', name: 'writeFile', args: '{"path":"a.ts"}' },
    ]);
  });
});
