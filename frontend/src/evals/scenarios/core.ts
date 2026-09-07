import { z } from 'zod';
import { cottageTool } from '../../agent/runtime/tool';
import type { AgentEvalScenario } from '../types';

const finalStream = (text: string) => [
  { type: 'text-delta' as const, text },
  { type: 'finish' as const, finishReason: 'stop' },
];

const evalExternalLookupTool = cottageTool(
  async ({ query }) => ({ query, result: 'deterministic-result' }),
  {
    name: 'mcp__eval__lookup',
    description: '确定性外部查询占位工具。',
    schema: z.object({ query: z.string() }),
  },
);

export const CORE_AGENT_EVAL_SCENARIOS: readonly AgentEvalScenario[] = [
  {
    schemaVersion: 1,
    id: 'chat-text-only',
    title: '纯文本回复不修改工作区',
    tags: ['chat', 'invariant'],
    prompt: '只回答问题，不修改文件。',
    workspace: { 'keep.txt': 'unchanged' },
    model: { streams: [finalStream('没有修改文件。')] },
    expected: {
      workspace: { files: { 'keep.txt': 'unchanged' }, changedPaths: [] },
      requests: { count: 1, messageIncludes: ['只回答问题'] },
      finalResponseIncludes: ['没有修改文件'],
      limits: { maxModelCalls: 1, maxToolCalls: 0 },
    },
  },
  {
    schemaVersion: 1,
    id: 'chat-write-file',
    title: '工具写入后把真实结果回传模型',
    tags: ['chat', 'tool', 'workspace'],
    prompt: '创建 result.txt。',
    model: {
      streams: [
        [
          {
            type: 'tool-call',
            call: {
              id: 'call-write-1',
              name: 'writeFile',
              args: { path: 'result.txt', content: 'done' },
            },
          },
          { type: 'finish', finishReason: 'tool_calls' },
        ],
        finalStream('result.txt 已创建。'),
      ],
    },
    expected: {
      workspace: { files: { 'result.txt': 'done' }, changedPaths: ['result.txt'] },
      trace: [{ type: 'tool_call', fields: { name: 'writeFile', status: 'ok' } }],
      requests: {
        count: 2,
        messageIncludes: ['"written": true'],
        toolNamesInclude: ['readFile', 'writeFile'],
      },
      finalResponseIncludes: ['已创建'],
      limits: { maxModelCalls: 2, maxToolCalls: 1 },
    },
  },
  {
    schemaVersion: 1,
    id: 'chat-reject-write',
    title: '拒绝审批后不修改工作区',
    tags: ['chat', 'approval', 'safety'],
    prompt: '覆盖 protected.txt。',
    workspace: { 'protected.txt': 'original' },
    approvalDecisions: [
      { toolName: 'writeFile', allowed: false, reason: '用户拒绝覆盖' },
    ],
    model: {
      streams: [
        [
          {
            type: 'tool-call',
            call: {
              id: 'call-write-rejected',
              name: 'writeFile',
              args: { path: 'protected.txt', content: 'changed' },
            },
          },
          { type: 'finish', finishReason: 'tool_calls' },
        ],
        finalStream('操作已被拒绝，文件保持不变。'),
      ],
    },
    expected: {
      workspace: { files: { 'protected.txt': 'original' }, changedPaths: [] },
      trace: [
        { type: 'tool_call', fields: { name: 'writeFile', status: 'blocked_policy' } },
      ],
      approvals: [{ toolName: 'writeFile', allowed: false }],
      requests: { count: 2, messageIncludes: ['用户拒绝覆盖'] },
      finalResponseIncludes: ['保持不变'],
    },
  },
  {
    schemaVersion: 1,
    id: 'stream-fragmented-tool-args',
    title: '碎片化工具参数只执行一次',
    tags: ['stream', 'tool-protocol'],
    prompt: '创建 fragmented.txt。',
    model: {
      streams: [
        [
          { type: 'tool-input-start', id: 'call-fragmented', name: 'writeFile' },
          { type: 'tool-input-delta', id: 'call-fragmented', delta: '{"path":"frag' },
          {
            type: 'tool-input-delta',
            id: 'call-fragmented',
            delta: 'mented.txt","content":"ok"}',
          },
          {
            type: 'tool-call',
            call: {
              id: 'call-fragmented',
              name: 'writeFile',
              args: { path: 'fragmented.txt', content: 'ok' },
            },
          },
          { type: 'finish', finishReason: 'tool_calls' },
        ],
        finalStream('碎片化参数已正确执行。'),
      ],
    },
    expected: {
      workspace: {
        files: { 'fragmented.txt': 'ok' },
        changedPaths: ['fragmented.txt'],
      },
      trace: [{ type: 'tool_call', count: 1, fields: { name: 'writeFile', status: 'ok' } }],
      requests: { count: 2 },
      limits: { maxToolCalls: 1 },
    },
  },
  {
    schemaVersion: 1,
    id: 'unknown-tool-recovery',
    title: '未知工具形成错误结果并允许模型恢复',
    tags: ['tool-protocol', 'recovery', 'regression'],
    regression: {
      id: 'OC-REG-001',
      source: 'historical',
      symptom: '未知工具 trace 被通用 error 状态覆盖',
      invariant: '未知工具必须保留 unknown_tool 诊断并以错误 tool result 回传模型',
    },
    prompt: '尝试不存在的工具后继续。',
    model: {
      streams: [
        [
          {
            type: 'tool-call',
            call: { id: 'call-missing', name: 'missingTool', args: {} },
          },
          { type: 'finish', finishReason: 'tool_calls' },
        ],
        finalStream('工具不存在，已停止该尝试。'),
      ],
    },
    expected: {
      workspace: { changedPaths: [] },
      trace: [
        { type: 'tool_call', fields: { name: 'missingTool', status: 'unknown_tool' } },
      ],
      requests: { count: 2, messageIncludes: ['未知工具'] },
      finalResponseIncludes: ['工具不存在'],
    },
  },
  {
    schemaVersion: 1,
    id: 'duplicate-call-requires-approval',
    title: '第三次相同调用请求确认并在拒绝后停止执行',
    tags: ['doom-loop', 'approval', 'safety', 'regression'],
    regression: {
      id: 'OC-REG-002',
      source: 'historical',
      symptom: '第三次相同工具调用被直接阻止',
      invariant: '重复调用达到阈值后必须询问用户，由用户决定是否继续',
    },
    prompt: '读取 keep.txt，但不要无限重复。',
    workspace: { 'keep.txt': 'value' },
    approvalDecisions: [
      { toolName: 'doom_loop', allowed: false, reason: '拒绝继续重复' },
    ],
    model: {
      streams: [
        [
          {
            type: 'tool-call',
            call: { id: 'call-read-1', name: 'readFile', args: { path: 'keep.txt' } },
          },
          { type: 'finish', finishReason: 'tool_calls' },
        ],
        [
          {
            type: 'tool-call',
            call: { id: 'call-read-2', name: 'readFile', args: { path: 'keep.txt' } },
          },
          { type: 'finish', finishReason: 'tool_calls' },
        ],
        [
          {
            type: 'tool-call',
            call: { id: 'call-read-3', name: 'readFile', args: { path: 'keep.txt' } },
          },
          { type: 'finish', finishReason: 'tool_calls' },
        ],
        finalStream('已按用户决定停止重复读取。'),
      ],
    },
    expected: {
      workspace: { files: { 'keep.txt': 'value' }, changedPaths: [] },
      trace: [
        { type: 'tool_call', count: 2, fields: { name: 'readFile', status: 'ok' } },
        { type: 'tool_call', count: 1, fields: { name: 'readFile', status: 'duplicate' } },
      ],
      approvals: [{ toolName: 'doom_loop', allowed: false }],
      requests: { count: 4 },
      finalResponseIncludes: ['停止重复读取'],
      limits: { maxToolCalls: 3 },
    },
  },
  {
    schemaVersion: 1,
    id: 'tool-failure-recovery',
    title: '工具执行前故障作为 tool result 回传并允许恢复',
    tags: ['fault-injection', 'recovery'],
    prompt: '读取 unstable.txt，失败后给出说明。',
    workspace: { 'unstable.txt': 'value' },
    faults: [
      {
        target: 'tool',
        toolName: 'readFile',
        phase: 'before',
        error: 'injected read failure',
      },
    ],
    model: {
      streams: [
        [
          {
            type: 'tool-call',
            call: {
              id: 'call-read-failed',
              name: 'readFile',
              args: { path: 'unstable.txt' },
            },
          },
          { type: 'finish', finishReason: 'tool_calls' },
        ],
        finalStream('读取失败，未修改任何文件。'),
      ],
    },
    expected: {
      workspace: { files: { 'unstable.txt': 'value' }, changedPaths: [] },
      trace: [
        { type: 'tool_call', fields: { name: 'readFile', status: 'error' } },
      ],
      requests: { count: 2, messageIncludes: ['injected read failure'] },
      finalResponseIncludes: ['读取失败'],
    },
  },
  {
    schemaVersion: 1,
    id: 'partial-write-is-visible',
    title: '工具落盘后故障不会被误判为无副作用',
    tags: ['fault-injection', 'workspace', 'diagnostics', 'regression'],
    regression: {
      id: 'OC-REG-003',
      source: 'historical',
      symptom: '工具报错被误认为没有发生文件副作用',
      invariant: '写入后故障必须保留真实工作区变化供恢复诊断',
    },
    prompt: '创建 partial.txt。',
    faults: [
      {
        target: 'tool',
        toolName: 'writeFile',
        phase: 'after',
        error: 'injected post-write failure',
      },
    ],
    model: {
      streams: [
        [
          {
            type: 'tool-call',
            call: {
              id: 'call-partial-write',
              name: 'writeFile',
              args: { path: 'partial.txt', content: 'partially committed' },
            },
          },
          { type: 'finish', finishReason: 'tool_calls' },
        ],
        finalStream('写入后发生错误，需要恢复处理。'),
      ],
    },
    expected: {
      workspace: {
        files: { 'partial.txt': 'partially committed' },
        changedPaths: ['partial.txt'],
      },
      trace: [
        { type: 'tool_call', fields: { name: 'writeFile', status: 'error' } },
      ],
      requests: { count: 2, messageIncludes: ['injected post-write failure'] },
      finalResponseIncludes: ['需要恢复'],
    },
  },
  {
    schemaVersion: 1,
    id: 'plan-out-of-scope-write',
    title: 'Plan 范围外写入在工具执行前被阻止',
    tags: ['plan', 'scope', 'safety'],
    mode: 'plan',
    prompt: '只允许修改 src，但尝试写入 docs。',
    workspace: { 'src/keep.ts': 'export {}' },
    planGuard: { allowedPathPrefixes: ['src'] },
    model: {
      streams: [
        [
          {
            type: 'tool-call',
            call: {
              id: 'call-outside-plan',
              name: 'writeFile',
              args: { path: 'docs/outside.md', content: 'not allowed' },
            },
          },
          { type: 'finish', finishReason: 'tool_calls' },
        ],
        finalStream('写入超出计划范围，未执行。'),
      ],
    },
    expected: {
      workspace: {
        files: { 'src/keep.ts': 'export {}' },
        absent: ['docs/outside.md'],
        changedPaths: [],
      },
      trace: [
        { type: 'tool_call', fields: { name: 'writeFile', status: 'blocked_plan' } },
      ],
      requests: { count: 2, messageIncludes: ['路径超出已批准范围'] },
      finalResponseIncludes: ['未执行'],
    },
  },
  {
    schemaVersion: 1,
    id: 'malformed-tool-args-recovery',
    title: '非法工具参数不会执行并允许模型恢复',
    tags: ['tool-protocol', 'schema', 'recovery'],
    prompt: '尝试用不完整参数写文件。',
    model: {
      streams: [
        [
          {
            type: 'tool-call',
            call: {
              id: 'call-malformed-write',
              name: 'writeFile',
              args: { path: 'invalid.txt' },
            },
          },
          { type: 'finish', finishReason: 'tool_calls' },
        ],
        finalStream('参数校验失败，文件没有创建。'),
      ],
    },
    expected: {
      workspace: { absent: ['invalid.txt'], changedPaths: [] },
      trace: [{ type: 'tool_call', fields: { name: 'writeFile', status: 'error' } }],
      requests: { count: 2, messageIncludes: ['content'] },
      finalResponseIncludes: ['没有创建'],
    },
  },
  {
    schemaVersion: 1,
    id: 'plan-file-budget-exhausted',
    title: 'Plan 文件预算耗尽时在执行前阻止新路径',
    tags: ['plan', 'budget', 'safety'],
    mode: 'plan',
    prompt: '文件预算已满，仍尝试写入另一个文件。',
    planGuard: {
      allowedPathPrefixes: ['src'],
      maxChangedFiles: 1,
      changedFiles: ['src/already.ts'],
    },
    model: {
      streams: [
        [
          {
            type: 'tool-call',
            call: {
              id: 'call-file-budget',
              name: 'writeFile',
              args: { path: 'src/new.ts', content: 'blocked' },
            },
          },
          { type: 'finish', finishReason: 'tool_calls' },
        ],
        finalStream('文件预算已耗尽，写入未执行。'),
      ],
    },
    expected: {
      workspace: { absent: ['src/new.ts'], changedPaths: [] },
      trace: [{ type: 'tool_call', fields: { name: 'writeFile', status: 'blocked_plan' } }],
      planBlocksInclude: ['预计修改文件数超过预算 1'],
      requests: { count: 2 },
    },
  },
  {
    schemaVersion: 1,
    id: 'plan-external-budget-exhausted',
    title: '无文件变更的外部调用仍会耗尽 Plan 预算',
    tags: ['plan', 'budget', 'external', 'safety'],
    mode: 'plan',
    prompt: '最多允许一次外部查询，但尝试查询两次。',
    planGuard: {
      allowedPathPrefixes: ['src'],
      maxExternalCalls: 1,
    },
    extraTools: [evalExternalLookupTool],
    model: {
      streams: [
        [
          {
            type: 'tool-call',
            call: {
              id: 'call-external-1',
              name: 'mcp__eval__lookup',
              args: { query: 'first' },
            },
          },
          { type: 'finish', finishReason: 'tool_calls' },
        ],
        [
          {
            type: 'tool-call',
            call: {
              id: 'call-external-2',
              name: 'mcp__eval__lookup',
              args: { query: 'second' },
            },
          },
          { type: 'finish', finishReason: 'tool_calls' },
        ],
        finalStream('第二次外部查询因预算耗尽而停止。'),
      ],
    },
    expected: {
      workspace: { changedPaths: [] },
      trace: [
        { type: 'tool_call', fields: { name: 'mcp__eval__lookup', status: 'ok' } },
        { type: 'tool_call', fields: { name: 'mcp__eval__lookup', status: 'blocked_plan' } },
      ],
      planBlocksInclude: ['外部调用次数达到预算 1'],
      requests: { count: 3, messageIncludes: ['deterministic-result'] },
    },
  },
  {
    schemaVersion: 1,
    id: 'restore-completed-tool-turn',
    title: '销毁 Agent 后从事件投影恢复并继续下一回合',
    tags: ['session', 'restore', 'multi-turn'],
    actions: [
      { type: 'send', text: '创建 persisted.txt。' },
      { type: 'destroyAgent' },
      { type: 'restoreAgent' },
      { type: 'send', text: '确认上一轮结果。' },
    ],
    model: {
      streams: [
        [
          {
            type: 'tool-call',
            call: {
              id: 'call-persisted-write',
              name: 'writeFile',
              args: { path: 'persisted.txt', content: 'saved' },
            },
          },
          { type: 'finish', finishReason: 'tool_calls' },
        ],
        finalStream('第一轮写入完成。'),
        finalStream('恢复后仍能看到 persisted.txt 的写入结果。'),
      ],
    },
    expected: {
      workspace: {
        files: { 'persisted.txt': 'saved' },
        changedPaths: ['persisted.txt'],
      },
      trace: [
        { type: 'turn_start', count: 2 },
        { type: 'turn_end', count: 2 },
        { type: 'tool_call', fields: { name: 'writeFile', status: 'ok' } },
      ],
      requests: {
        count: 3,
        messageIncludes: ['"written": true', '确认上一轮结果'],
      },
      finalResponseIncludes: ['恢复后仍能看到'],
    },
  },
  {
    schemaVersion: 1,
    id: 'restore-with-corrupt-event-tail',
    title: '事件日志尾行损坏时恢复此前有效消息',
    tags: ['session', 'restore', 'corruption', 'regression'],
    regression: {
      id: 'OC-REG-004',
      source: 'synthetic',
      symptom: '事件日志尾部半写入可能导致整个会话无法恢复',
      invariant: '恢复必须忽略损坏尾行并保留此前有效事件',
    },
    actions: [
      { type: 'send', text: '记住恢复标记 ALPHA。' },
      { type: 'destroyAgent' },
      { type: 'restoreAgent', corruptEventLogTail: true },
      { type: 'send', text: '恢复标记是什么？' },
    ],
    model: {
      streams: [
        finalStream('已记住恢复标记 ALPHA。'),
        finalStream('恢复标记是 ALPHA。'),
      ],
    },
    expected: {
      workspace: { changedPaths: [] },
      trace: [
        { type: 'turn_start', count: 2 },
        { type: 'turn_end', count: 2 },
      ],
      requests: { count: 2, messageIncludes: ['已记住恢复标记 ALPHA'] },
      finalResponseIncludes: ['ALPHA'],
    },
  },
  {
    schemaVersion: 1,
    id: 'staging-stop-restore-approve',
    title: '停止后保留暂存，重建 Agent 后仍可批准落盘',
    tags: ['staging', 'restore', 'approval', 'lifecycle', 'regression'],
    regression: {
      id: 'OC-REG-005',
      source: 'historical',
      symptom: '停止等待审批时暂存内容被当作取消而丢弃',
      invariant: '停止只解除等待，暂存覆盖层和持久化状态必须保留',
    },
    staging: { enabled: true },
    actions: [
      { type: 'send', text: '暂存写入 staged.txt。', waitForCompletion: false },
      { type: 'abortAfterStaged' },
      { type: 'awaitTurn' },
      { type: 'destroyAgent' },
      { type: 'restoreAgent' },
      { type: 'approveStaged' },
    ],
    model: {
      streams: [
        [
          {
            type: 'tool-call',
            call: {
              id: 'call-staged-write',
              name: 'writeFile',
              args: { path: 'staged.txt', content: 'approved later' },
            },
          },
          { type: 'finish', finishReason: 'tool_calls' },
        ],
        finalStream('写入已进入暂存审阅。'),
      ],
    },
    expected: {
      workspace: {
        files: { 'staged.txt': 'approved later' },
        changedPaths: ['staged.txt'],
      },
      staging: { pendingPaths: [], persistedPaths: [] },
      uiEvents: [
        { type: 'need_staged_review', count: 2 },
        { type: 'staged_committed', count: 1 },
      ],
      trace: [{ type: 'turn_end', fields: { endReason: 'aborted' } }],
      requests: { count: 2 },
    },
  },
  {
    schemaVersion: 1,
    id: 'staging-discard-keeps-disk',
    title: '丢弃暂存不会修改真实工作区',
    tags: ['staging', 'approval', 'safety'],
    staging: { enabled: true },
    actions: [
      { type: 'send', text: '尝试覆盖 original.txt。', waitForCompletion: false },
      { type: 'discardStaged' },
      { type: 'awaitTurn' },
    ],
    workspace: { 'original.txt': 'original' },
    model: {
      streams: [
        [
          {
            type: 'tool-call',
            call: {
              id: 'call-staged-discard',
              name: 'writeFile',
              args: { path: 'original.txt', content: 'discard me' },
            },
          },
          { type: 'finish', finishReason: 'tool_calls' },
        ],
        finalStream('改动等待暂存审阅。'),
      ],
    },
    expected: {
      workspace: { files: { 'original.txt': 'original' }, changedPaths: [] },
      staging: { pendingPaths: [], persistedPaths: [] },
      uiEvents: [{ type: 'staged_discarded', count: 1 }],
      requests: { count: 2 },
    },
  },
  {
    schemaVersion: 1,
    id: 'manual-approval-action',
    title: '回合挂起时可由后续 action 拒绝审批并收敛',
    tags: ['approval', 'lifecycle', 'safety'],
    actions: [
      { type: 'send', text: '尝试覆盖 guarded.txt。', waitForCompletion: false },
      { type: 'resolveApproval', toolName: 'writeFile', allowed: false },
      { type: 'awaitTurn' },
    ],
    workspace: { 'guarded.txt': 'original' },
    approvalDecisions: [{ toolName: 'writeFile', waitForAction: true }],
    model: {
      streams: [
        [
          {
            type: 'tool-call',
            call: {
              id: 'call-manual-approval',
              name: 'writeFile',
              args: { path: 'guarded.txt', content: 'changed' },
            },
          },
          { type: 'finish', finishReason: 'tool_calls' },
        ],
        finalStream('用户拒绝了覆盖，文件未改变。'),
      ],
    },
    expected: {
      workspace: { files: { 'guarded.txt': 'original' }, changedPaths: [] },
      trace: [
        { type: 'tool_call', fields: { name: 'writeFile', status: 'blocked_policy' } },
      ],
      approvals: [{ toolName: 'writeFile', allowed: false }],
      requests: { count: 2 },
      finalResponseIncludes: ['文件未改变'],
    },
  },
];
