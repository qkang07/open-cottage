import { describe, expect, it } from 'vitest';
import { createReplayModelController } from '../../agent/runtime/replay';
import { createEvalWorkspaceTools, EvalMemoryWorkspace } from '../inMemoryWorkspace';
import type { LiveEvalCase } from './cases';
import { runPlanLiveEvalCase } from './planRunner';

const toolStream = (
  id: string,
  name: string,
  args: Record<string, unknown>,
) => [
  { type: 'tool-call' as const, call: { id, name, args } },
  { type: 'finish' as const, finishReason: 'tool_calls' },
];

describe('Plan live eval harness', () => {
  it('drives approval, real PlanRunner transitions, guard, journal, verification, and completion', async () => {
    const model = createReplayModelController({
      identity: {
        provider: 'openai',
        model: 'eval-model',
        connectionId: 'eval-connection',
      },
      streams: [
        toolStream('submit', 'submitPlan', {
          goal: '创建受控结果',
          requirements: ['结果必须精确'],
          design: '单步骤写入后使用隔离验证器检查内容',
          allowedPathPrefixes: ['output/result.txt'],
          steps: [{
            id: 'write-result',
            title: '写入结果',
            kind: 'implementation',
            dependsOn: [],
            allowedPathPrefixes: ['output/result.txt'],
            acceptance: [{
              id: 'step-content',
              providerId: 'eval.contentMatches',
              description: '结果内容正确',
              required: true,
              config: { path: 'output/result.txt', expected: 'done' },
            }],
          }],
          finalAcceptance: [{
            id: 'final-content',
            providerId: 'eval.contentMatches',
            description: '最终内容正确',
            required: true,
            config: { path: 'output/result.txt', expected: 'done' },
          }],
          budgets: { maxTurns: 4, maxChangedFiles: 1, maxExternalCalls: 0, maxStepRetries: 1 },
        }),
        toolStream('write', 'writeFile', { path: 'output/result.txt', content: 'done' }),
        toolStream('step', 'completePlanStep', {
          stepId: 'write-result',
          summary: '已写入并回读',
        }),
        toolStream('complete', 'completePlanRun', { summary: '实现与最终验证完成' }),
        [
          { type: 'text-delta' as const, text: '计划已按批准范围完成。' },
          { type: 'finish' as const, finishReason: 'stop' },
        ],
      ],
    });
    const workspace = new EvalMemoryWorkspace();
    const item: LiveEvalCase = {
      id: 'plan-harness-test',
      title: 'plan harness test',
      tags: ['plan'],
      mode: 'plan',
      prompt: '创建 output/result.txt。',
      workspace: {},
      evaluate: () => [],
    };

    const result = await runPlanLiveEvalCase({
      item,
      model: model.driver,
      modelConfig: {
        provider: 'openai',
        connectionId: 'eval-connection',
        model: 'eval-model',
      },
      workspace: {
        tools: createEvalWorkspaceTools(workspace),
        snapshot: async () => workspace.snapshot(),
      },
    });

    expect(result.finalWorkspace).toEqual({ 'output/result.txt': 'done' });
    expect(result.trace.approvals).toEqual([
      expect.objectContaining({ revision: 1, decision: 'approved' }),
    ]);
    expect(result.trace.transitions.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'submitted',
        'revision_approved',
        'step_started',
        'mutation_recorded',
        'step_completed',
        'completed',
      ]),
    );
    expect(result.trace.mutations[0]).toMatchObject({
      stepId: 'write-result',
      predictedPaths: ['output/result.txt'],
      report: { created: [{ path: 'output/result.txt', kind: 'file' }] },
    });
    expect(result.trace.verification.map((entry) => entry.scope)).toEqual(['step', 'final']);
    expect(result.trace.checkpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stepId: 'write-result',
          files: { 'output/result.txt': null },
        }),
      ]),
    );
    expect(result.trace.finalRun?.status).toBe('completed');
    expect(result.trace.finalWorkspace).toEqual(result.finalWorkspace);
    const firstExecutionMessages = model.calls[1]?.request.messages ?? [];
    expect(firstExecutionMessages.some(
      (message) => message.role === 'assistant' &&
        message.toolCalls?.some((call) => call.name === 'submitPlan'),
    )).toBe(false);
    expect(JSON.stringify(firstExecutionMessages)).toContain('批准时验证能力快照');
    model.assertExhausted();
  });
});
