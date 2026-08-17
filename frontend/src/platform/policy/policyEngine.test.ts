import { describe, expect, it } from 'vitest';
import { evaluateToolPolicy } from './policyEngine';

const APPROVE_ALL = {
  requireApprovalFor: ['read', 'write', 'external', 'destructive'],
} as const;

const tidyMoves = [{ from: 'a.txt', to: 'docs/a.txt' }];
const astOps = [
  { kind: 'renameSymbol', selector: { name: 'foo' }, newName: 'bar' },
];

describe('evaluateToolPolicy dryRun 预检豁免', () => {
  it('applyTidyPlan dryRun=true 直接放行，不受 destructive 审批配置影响', () => {
    const decision = evaluateToolPolicy('applyTidyPlan', APPROVE_ALL, {
      dryRun: true,
      moves: tidyMoves,
    });
    expect(decision.action).toBe('allow');
  });

  it('applyTidyPlan dryRun=false 仍需审批（能力登记 requiresApproval）', () => {
    const decision = evaluateToolPolicy(
      'applyTidyPlan',
      { requireApprovalFor: [] },
      { dryRun: false, moves: tidyMoves },
    );
    expect(decision.action).toBe('confirm');
  });

  it('applyTidyPlan 未传 dryRun（缺省 false，真正执行）仍需审批', () => {
    const decision = evaluateToolPolicy(
      'applyTidyPlan',
      { requireApprovalFor: [] },
      { moves: tidyMoves },
    );
    expect(decision.action).toBe('confirm');
  });

  it('astEdit 未传 dryRun（默认预检）直接放行，不受 write 审批配置影响', () => {
    const decision = evaluateToolPolicy('astEdit', APPROVE_ALL, {
      path: 'src/a.ts',
      operations: astOps,
    });
    expect(decision.action).toBe('allow');
  });

  it('astEdit dryRun=true 直接放行', () => {
    const decision = evaluateToolPolicy('astEdit', APPROVE_ALL, {
      path: 'src/a.ts',
      dryRun: true,
      operations: astOps,
    });
    expect(decision.action).toBe('allow');
  });

  it('astEdit dryRun=false 按 write 级参与 requireApprovalFor 判定', () => {
    const withApproval = evaluateToolPolicy('astEdit', APPROVE_ALL, {
      path: 'src/a.ts',
      dryRun: false,
      operations: astOps,
    });
    expect(withApproval.action).toBe('confirm');

    const withoutApproval = evaluateToolPolicy(
      'astEdit',
      { requireApprovalFor: [] },
      { path: 'src/a.ts', dryRun: false, operations: astOps },
    );
    expect(withoutApproval.action).toBe('allow');
  });

  it('豁免逐工具 opt-in：未登记工具携带 dryRun 参数不豁免', () => {
    const decision = evaluateToolPolicy('applyPatch', APPROVE_ALL, {
      dryRun: true,
      patch: '--- a\n+++ b',
    });
    expect(decision.action).toBe('confirm');
  });
});
