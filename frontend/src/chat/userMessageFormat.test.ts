import { describe, expect, it } from 'vitest';
import {
  buildActiveFileTag,
  buildLlmUserMessage,
  parseUserMessageDisplay,
} from './userMessageFormat';

describe('userMessageFormat', () => {
  it('builds active file tag', () => {
    expect(buildActiveFileTag('src/a.ts')).toBe(
      '<cottage_active_file path="src/a.ts" />',
    );
  });

  it('builds structured llm payload', () => {
    const llm = buildLlmUserMessage({
      references: [{ path: 'a.xlsx', label: 'a.xlsx!B1' }],
      fileBlocks: '<file_reference path="a.xlsx">x</file_reference>',
      userText: '改一下',
      activeFilePath: 'src/open.ts',
    });
    expect(llm).toContain('<cottage_active_file path="src/open.ts" />');
    expect(llm).toContain('<cottage_open_file_context path="src/open.ts">');
    expect(llm).toContain('<cottage_refs>');
    expect(llm).toContain('<cottage_message>');
    expect(llm).toContain('改一下');
    expect(llm).not.toContain('以下为用户引用');
  });

  it('parses stored metadata for display', () => {
    const display = parseUserMessageDisplay('ignored', {
      userText: 'hello',
      fileReferences: [{ path: 'src/a.ts', label: 'src/a.ts' }],
      activeFilePath: 'src/open.ts',
    });
    expect(display.userText).toBe('hello');
    expect(display.references).toHaveLength(1);
    expect(display.activeFilePath).toBe('src/open.ts');
  });

  it('parses modern cottage tags from content', () => {
    const content = buildLlmUserMessage({
      references: [{ path: 'b.csv', label: 'b.csv' }],
      fileBlocks: '',
      userText: 'hi',
      activeFilePath: 'src/current.ts',
    });
    const display = parseUserMessageDisplay(content);
    expect(display.userText).toBe('hi');
    expect(display.references[0]?.path).toBe('b.csv');
    expect(display.activeFilePath).toBe('src/current.ts');
  });
});
