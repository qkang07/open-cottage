import { describe, expect, it, vi } from 'vitest';
import { composeUserMessage } from './composeUserMessage';
import type { ChatFileReference } from './fileReferences';

describe('composeUserMessage', () => {
  it('keeps active file as context, not implicit reference', async () => {
    const readFile = vi.fn(async () => 'ignored');
    const composed = await composeUserMessage('请帮我分析', [], readFile, {
      activeFilePath: 'src/open.ts',
    });

    expect(composed.references).toEqual([]);
    expect(composed.activeFilePath).toBe('src/open.ts');
    expect(composed.llmContent).toContain('<cottage_open_file_context path="src/open.ts">');
    expect(composed.llmContent).not.toContain('<cottage_refs>');
    expect(readFile).not.toHaveBeenCalled();
  });

  it('preserves explicit references and open-file context together', async () => {
    const refs: ChatFileReference[] = [
      { id: 'r1', path: 'src/main.ts' },
    ];
    const readFile = vi.fn(async () => 'console.log("ok")');
    const composed = await composeUserMessage('改这份文件', refs, readFile, {
      activeFilePath: 'src/open.ts',
    });

    expect(composed.references).toHaveLength(1);
    expect(composed.references[0]?.path).toBe('src/main.ts');
    expect(composed.activeFilePath).toBe('src/open.ts');
    expect(composed.llmContent).toContain('<cottage_refs>');
    expect(composed.llmContent).toContain('<cottage_open_file_context path="src/open.ts">');
    expect(composed.llmContent).toContain('<file_reference path="src/main.ts">');
  });
});
