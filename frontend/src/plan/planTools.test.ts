import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { createPlanTools, type PlanToolCallbacks } from './planTools';

const callbacks = {} as PlanToolCallbacks;

describe('Plan tools schema', () => {
  it('accepts baseRevision 0 for a new plan so execution can normalize it', () => {
    const submit = createPlanTools(callbacks).find((tool) => tool.name === 'submitPlan');
    if (!submit) throw new Error('submitPlan tool missing');
    const schema = submit?.schema as z.ZodTypeAny;
    const result = schema.safeParse({
      baseRevision: 0,
      goal: 'goal',
      requirements: ['requirement'],
      design: 'design',
      allowedPathPrefixes: ['output.txt'],
      steps: [{
        title: 'write output',
        kind: 'implementation',
        acceptance: [{ description: 'content is correct' }],
      }],
      finalAcceptance: [{ description: 'final content is correct' }],
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.baseRevision).toBe(0);
  });

  it('normalizes baseRevision 0 to an omitted draft revision', async () => {
    let observedBaseRevision: number | undefined = -1;
    const submit = createPlanTools({
      ...callbacks,
      async registerPlan(draft) {
        observedBaseRevision = draft.baseRevision;
        throw new Error('captured');
      },
    }).find((tool) => tool.name === 'submitPlan');
    if (!submit) throw new Error('submitPlan tool missing');
    await expect(submit.invoke({
      baseRevision: 0,
      goal: 'goal',
      requirements: ['requirement'],
      design: 'design',
      allowedPathPrefixes: ['output.txt'],
      steps: [{ title: 'write output', acceptance: [{ description: 'correct' }] }],
      finalAcceptance: [{ description: 'final correct' }],
    })).rejects.toThrow('captured');
    expect(observedBaseRevision).toBeUndefined();
  });

  it('allows completePlanStep to omit the non-authoritative changedFiles hint', () => {
    const complete = createPlanTools(callbacks).find((tool) => tool.name === 'completePlanStep');
    if (!complete) throw new Error('completePlanStep tool missing');
    const schema = complete?.schema as z.ZodTypeAny;
    expect(schema.safeParse({ stepId: 'write-output', summary: 'done' }).success).toBe(true);
  });
});
