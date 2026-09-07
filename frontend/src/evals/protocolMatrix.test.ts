import { beforeAll, describe, expect, it } from 'vitest';
import type { CottageModelEvent } from '../agent/runtime/model';
import { runAgentEvalScenario, formatAgentEvalReport } from './runner';
import { installEvalWebLocks } from './runtime';

const finalStream = (text: string): CottageModelEvent[] => [
  { type: 'text-delta', text },
  { type: 'finish', finishReason: 'stop' },
];

describe('deterministic streaming tool protocol matrix', () => {
  beforeAll(() => installEvalWebLocks());

  it('reconstructs every two-part JSON split without duplicate execution', async () => {
    const serialized = JSON.stringify({
      path: 'matrix.txt',
      content: '你好🙂\nfragmented',
    });
    const failures: string[] = [];
    for (let split = 1; split < serialized.length; split += 1) {
      const report = await runAgentEvalScenario({
        schemaVersion: 1,
        id: `protocol-split-${split}`,
        title: `工具参数分片位置 ${split}`,
        tags: ['tool-protocol', 'matrix'],
        prompt: '创建 matrix.txt。',
        model: {
          streams: [
            [
              { type: 'tool-input-start', id: 'matrix-call', name: 'writeFile' },
              { type: 'tool-input-delta', id: 'matrix-call', delta: serialized.slice(0, split) },
              { type: 'tool-input-delta', id: 'matrix-call', delta: serialized.slice(split) },
              {
                type: 'tool-call',
                call: {
                  id: 'matrix-call',
                  name: 'writeFile',
                  args: { path: 'matrix.txt', content: '你好🙂\nfragmented' },
                },
              },
              { type: 'finish', finishReason: 'tool_calls' },
            ],
            finalStream('完成。'),
          ],
        },
        expected: {
          workspace: {
            files: { 'matrix.txt': '你好🙂\nfragmented' },
            changedPaths: ['matrix.txt'],
          },
          trace: [{ type: 'tool_call', count: 1, fields: { status: 'ok' } }],
          limits: { maxToolCalls: 1 },
        },
      });
      if (!report.passed) failures.push(formatAgentEvalReport(report));
    }
    expect(failures).toEqual([]);
  });

  it('keeps interleaved calls isolated by call id', async () => {
    const a = JSON.stringify({ path: 'a.txt', content: 'A' });
    const b = JSON.stringify({ path: 'b.txt', content: 'B' });
    const report = await runAgentEvalScenario({
      schemaVersion: 1,
      id: 'protocol-interleaved-calls',
      title: '交错流式工具参数',
      tags: ['tool-protocol', 'matrix'],
      prompt: '同时创建两个文件。',
      model: {
        streams: [
          [
            { type: 'tool-input-start', id: 'call-a', name: 'writeFile' },
            { type: 'tool-input-start', id: 'call-b', name: 'writeFile' },
            { type: 'tool-input-delta', id: 'call-a', delta: a.slice(0, 12) },
            { type: 'tool-input-delta', id: 'call-b', delta: b.slice(0, 9) },
            { type: 'tool-input-delta', id: 'call-a', delta: a.slice(12) },
            { type: 'tool-input-delta', id: 'call-b', delta: b.slice(9) },
            {
              type: 'tool-call',
              call: { id: 'call-a', name: 'writeFile', args: { path: 'a.txt', content: 'A' } },
            },
            {
              type: 'tool-call',
              call: { id: 'call-b', name: 'writeFile', args: { path: 'b.txt', content: 'B' } },
            },
            { type: 'finish', finishReason: 'tool_calls' },
          ],
          finalStream('两个文件均已创建。'),
        ],
      },
      expected: {
        workspace: {
          files: { 'a.txt': 'A', 'b.txt': 'B' },
          changedPaths: ['a.txt', 'b.txt'],
        },
        trace: [{ type: 'tool_call', count: 2, fields: { status: 'ok' } }],
        limits: { maxToolCalls: 2 },
      },
    });
    expect(report.passed, formatAgentEvalReport(report)).toBe(true);
  });
});
