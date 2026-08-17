import { describe, expect, it } from 'vitest';
import type { CottageMessage, CottageSection } from '../agent/messages';
import { collectMessageChangedFiles } from './messageChangedFiles';

const assistantMessage = (
  sections: CottageSection[],
): CottageMessage => ({
  id: 'm1',
  role: 'assistant',
  sections,
});

const call = (
  partial: Partial<Extract<CottageSection, { type: 'call' }>> & {
    name: string;
  },
): Extract<CottageSection, { type: 'call' }> => ({
  type: 'call',
  id: partial.id ?? 'c1',
  arguments: partial.arguments ?? '{}',
  ...partial,
});

describe('collectMessageChangedFiles', () => {
  it('提取 writeFile / createFile / editFile 的路径与类别', () => {
    const files = collectMessageChangedFiles(
      assistantMessage([
        call({
          name: 'writeFile',
          arguments: '{"path":"src/a.ts","content":"x"}',
        }),
        call({
          id: 'c2',
          name: 'createFile',
          arguments: '{"path":"src/b.ts","content":"y"}',
        }),
        call({
          id: 'c3',
          name: 'editFile',
          arguments: '{"path":"src/a.ts","edits":[]}',
          result: '{"replacements":1}',
        }),
      ]),
    );
    expect(files).toEqual([
      { path: 'src/a.ts', kind: 'modified' },
      { path: 'src/b.ts', kind: 'created' },
    ]);
  });

  it('参数仍在流式生成时做部分提取', () => {
    const files = collectMessageChangedFiles(
      assistantMessage([
        call({
          name: 'writeFile',
          arguments: '{"path": "docs/plan.md", "content": "',
          running: true,
          argsStreaming: true,
        }),
      ]),
    );
    expect(files).toEqual([{ path: 'docs/plan.md', kind: 'modified' }]);
  });

  it('applyPatch 从结果 files 列表提取多文件', () => {
    const files = collectMessageChangedFiles(
      assistantMessage([
        call({
          name: 'applyPatch',
          arguments: '{"patch":"..."}',
          result: JSON.stringify({
            count: 3,
            files: [
              { path: 'src/a.ts', written: true },
              { path: 'src/new.ts', written: true, created: true },
              { path: 'src/old.ts', deleted: true },
            ],
          }),
        }),
      ]),
    );
    expect(files).toEqual([
      { path: 'src/a.ts', kind: 'modified' },
      { path: 'src/new.ts', kind: 'created' },
      { path: 'src/old.ts', kind: 'deleted' },
    ]);
  });

  it('applyPatch 执行中退回参数 path', () => {
    const files = collectMessageChangedFiles(
      assistantMessage([
        call({
          name: 'applyPatch',
          arguments: '{"patch":"...","path":"src/a.ts"}',
          running: true,
        }),
      ]),
    );
    expect(files).toEqual([{ path: 'src/a.ts', kind: 'modified' }]);
  });

  it('生成类工具从结果提取产物路径', () => {
    const files = collectMessageChangedFiles(
      assistantMessage([
        call({
          name: 'writeWord',
          arguments: '{"path":"docs/report.docx"}',
          result: '{"path":"docs/report.docx","written":true,"paragraphCount":3}',
        }),
        call({
          id: 'c2',
          name: 'generateImage',
          arguments: '{"prompt":"cat"}',
          result: '{"savedTo":["assets/cat.png"],"provider":"x"}',
        }),
        call({
          id: 'c3',
          name: 'createPdf',
          arguments: '{"lines":["hi"]}',
          result: '{"outputPath":"document-1.pdf","pageCount":1}',
        }),
        call({
          id: 'c4',
          name: 'splitPdf',
          arguments: '{"path":"big.pdf"}',
          result: '{"source":"big.pdf","outputs":[{"outputPath":"big-1.pdf"}]}',
        }),
      ]),
    );
    expect(files).toEqual([
      { path: 'docs/report.docx', kind: 'generated' },
      { path: 'assets/cat.png', kind: 'generated' },
      { path: 'document-1.pdf', kind: 'generated' },
      { path: 'big-1.pdf', kind: 'generated' },
    ]);
  });

  it('忽略只读工具与失败调用', () => {
    const files = collectMessageChangedFiles(
      assistantMessage([
        call({
          name: 'readFile',
          arguments: '{"path":"src/a.ts"}',
          result: '内容…',
        }),
        call({
          id: 'c2',
          name: 'writeFile',
          arguments: '{"path":"src/b.ts","content":"x"}',
          result: '⛔ 操作被安全策略阻止：用户拒绝了该操作',
        }),
      ]),
    );
    // readFile 不计入；writeFile 失败/被阻断也不算变更
    expect(files).toEqual([]);
  });

  it('忽略 snake_case 工具名变体并归一化匹配', () => {
    const files = collectMessageChangedFiles(
      assistantMessage([
        call({
          name: 'write_file',
          arguments: '{"path":"src/a.ts","content":"x"}',
        }),
      ]),
    );
    expect(files).toEqual([{ path: 'src/a.ts', kind: 'modified' }]);
  });

  it('rename/move/copy 提取目标新路径', () => {
    const files = collectMessageChangedFiles(
      assistantMessage([
        call({
          name: 'rename',
          arguments: '{"from":"docs/old.md","to":"archive/old.md"}',
          result: '{"ok":true}',
        }),
        call({
          id: 'c2',
          name: 'move',
          arguments: '{"from":"a.txt","to":"notes/a.txt"}',
        }),
        call({
          id: 'c3',
          name: 'copy',
          arguments: '{"from":"a.txt","to":"backup/a.txt"}',
          result: '{"ok":true}',
        }),
      ]),
    );
    expect(files).toEqual([
      { path: 'archive/old.md', kind: 'modified' },
      { path: 'notes/a.txt', kind: 'modified' },
      { path: 'backup/a.txt', kind: 'created' },
    ]);
  });

  it('copyPaths 从 items[].to 提取产物路径', () => {
    const files = collectMessageChangedFiles(
      assistantMessage([
        call({
          name: 'copyPaths',
          arguments:
            '{"items":[{"from":"a.txt","to":"docs/a.txt"},{"from":"b.txt","to":"docs/b.txt"}]}',
          result: '{"results":[{"ok":true},{"ok":true}]}',
        }),
      ]),
    );
    expect(files).toEqual([
      { path: 'docs/a.txt', kind: 'created' },
      { path: 'docs/b.txt', kind: 'created' },
    ]);
  });

  it('deleteFiles（数组/单路径）记为删除，并覆盖先前类别', () => {
    const files = collectMessageChangedFiles(
      assistantMessage([
        call({
          name: 'writeFile',
          arguments: '{"path":"tmp/out.txt","content":"x"}',
        }),
        call({
          id: 'c2',
          name: 'deleteFiles',
          arguments: '{"paths":"tmp/out.txt"}',
          result: '{"deletedFiles":["tmp/out.txt"],"deletedDirs":[]}',
        }),
        call({
          id: 'c3',
          name: 'deleteFiles',
          arguments: '{"paths":["junk/a.tmp","junk/b.tmp"]}',
          result: '{"deletedFiles":["junk/a.tmp","junk/b.tmp"],"deletedDirs":[]}',
        }),
      ]),
    );
    expect(files).toEqual([
      { path: 'tmp/out.txt', kind: 'deleted' },
      { path: 'junk/a.tmp', kind: 'deleted' },
      { path: 'junk/b.tmp', kind: 'deleted' },
    ]);
  });

  it('历史会话的 deleteFile / deletePaths 旧名仍识别为删除', () => {
    const files = collectMessageChangedFiles(
      assistantMessage([
        call({
          name: 'deleteFile',
          arguments: '{"path":"tmp/out.txt"}',
          result: '{"ok":true}',
        }),
        call({
          id: 'c2',
          name: 'deletePaths',
          arguments: '{"paths":["junk/a.tmp"]}',
          result: '{"deleted":1}',
        }),
      ]),
    );
    expect(files).toEqual([
      { path: 'tmp/out.txt', kind: 'deleted' },
      { path: 'junk/a.tmp', kind: 'deleted' },
    ]);
  });

  it('结构性操作失败/被阻断时不计入变更', () => {
    const files = collectMessageChangedFiles(
      assistantMessage([
        call({
          name: 'rename',
          arguments: '{"from":"a.txt","to":"b.txt"}',
          result: '⛔ 操作被安全策略阻止：用户拒绝了该操作',
        }),
        call({
          id: 'c2',
          name: 'deleteFiles',
          arguments: '{"paths":["a.txt"]}',
          result: '删除失败：路径不存在',
        }),
      ]),
    );
    expect(files).toEqual([]);
  });

  it('忽略用户消息', () => {
    const message: CottageMessage = {
      id: 'u1',
      role: 'user',
      sections: [{ type: 'content', text: 'hi' }],
    };
    expect(collectMessageChangedFiles(message)).toEqual([]);
  });
});
