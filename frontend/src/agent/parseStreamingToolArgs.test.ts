import { describe, expect, it } from 'vitest';
import {
  extractPartialJsonString,
  parseStreamingFileWriteArgs,
} from './parseStreamingToolArgs';

describe('extractPartialJsonString', () => {
  it('从不完整 JSON 提取 path', () => {
    expect(extractPartialJsonString('{"path": "src/foo.ts", "content": "', 'path')).toBe(
      'src/foo.ts',
    );
  });

  it('从不完整 JSON 提取 content 片段', () => {
    const raw = '{"path":"a.txt","content":"import React\\nfrom';
    expect(extractPartialJsonString(raw, 'content')).toBe('import React\nfrom');
  });

  it('从完整 JSON 提取 content', () => {
    const raw = '{"path":"a.txt","content":"hello"}';
    expect(extractPartialJsonString(raw, 'content')).toBe('hello');
  });
});

describe('parseStreamingFileWriteArgs', () => {
  it('标记完整参数', () => {
    const raw = '{"path":"a.txt","content":"hi"}';
    expect(parseStreamingFileWriteArgs(raw)).toEqual({
      path: 'a.txt',
      content: 'hi',
      complete: true,
    });
  });

  it('流式片段仍返回 partial 字段', () => {
    const raw = '{"path":"a.txt","content":"hel';
    expect(parseStreamingFileWriteArgs(raw)).toEqual({
      path: 'a.txt',
      content: 'hel',
      complete: false,
    });
  });
});
