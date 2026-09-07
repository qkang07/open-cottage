/** 防止核心回归场景被无意删除；增加场景时需显式更新此清单。 */
export const CORE_AGENT_EVAL_BASELINE = {
  schemaVersion: 1,
  scenarioIds: [
    'chat-text-only',
    'chat-write-file',
    'chat-reject-write',
    'stream-fragmented-tool-args',
    'unknown-tool-recovery',
    'duplicate-call-requires-approval',
    'tool-failure-recovery',
    'partial-write-is-visible',
    'plan-out-of-scope-write',
    'malformed-tool-args-recovery',
    'plan-file-budget-exhausted',
    'plan-external-budget-exhausted',
    'restore-completed-tool-turn',
    'restore-with-corrupt-event-tail',
    'staging-stop-restore-approve',
    'staging-discard-keeps-disk',
    'manual-approval-action',
  ],
} as const;
