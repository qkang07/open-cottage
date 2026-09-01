import { describe, expect, it } from 'vitest';
import {
  requestPlanApproval,
  resolvePendingPlanApproval,
} from './approvalGate';
import { createPlanDefinition, createPlanRun } from './state';

describe('plan/approvalGate', () => {
  it('returns natural-language adjustment feedback to the waiting submitPlan call', async () => {
    const definition = createPlanDefinition(
      {
        goal: '调整计划',
        requirements: [],
        design: '',
        allowedPathPrefixes: ['frontend/src'],
        steps: [{ id: 'step', title: '修改实现' }],
        finalAcceptance: [],
      },
      { sessionId: 'session', workspaceId: 'workspace', capabilities: [] },
    );
    const pending = requestPlanApproval({
      definition,
      run: createPlanRun(definition),
      sessionId: 'session',
    });
    expect(resolvePendingPlanApproval('adjust', 'session', '不要修改公共 API')).toBe(true);
    await expect(pending).resolves.toEqual({
      decision: 'adjust',
      feedback: '不要修改公共 API',
    });
  });
});
