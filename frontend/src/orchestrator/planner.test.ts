import type { CottageModelDriver } from '../agent/runtime/model';
import { describe, expect, it } from 'vitest';
import { generatePlan } from './planner';

function createMockModel(output: unknown): CottageModelDriver {
  return {
    getRuntimeIdentity: () => ({
      provider: 'test',
      model: 'planner',
      baseUrl: 'test://planner',
    }),
    stream: async function* () {},
    generate: async () => ({ content: '' }),
    generateObject: async (request) => ({ value: request.schema.parse(output) }),
  };
}

describe('orchestrator/planner', () => {
  it('parses JSON plan without fences', async () => {
    const model = createMockModel({
      steps: [
        { id: 'research', title: 'Research topic', type: 'agent' },
        { id: 'write', title: 'Write summary', type: 'agent', dependencies: ['research'] },
      ],
    });

    const steps = await generatePlan({
      model,
      input: { goal: 'Summarize topic' },
    });

    expect(steps).toHaveLength(2);
    expect(steps[0].id).toBe('research');
    expect(steps[0].dependencies).toEqual([]);
    expect(steps[1].dependencies).toEqual(['research']);
  });

  it('uses the structured output contract', async () => {
    const model = createMockModel({
      steps: [{ id: 's1', title: 'Step', type: 'agent' }],
    });

    const steps = await generatePlan({ model, input: { goal: 'x' } });
    expect(steps).toHaveLength(1);
    expect(steps[0].id).toBe('s1');
  });

  it('fills missing fields with defaults', async () => {
    const model = createMockModel({
      steps: [{ title: 'No id' }],
    });

    const steps = await generatePlan({ model, input: { goal: 'x' } });
    expect(steps[0].id).toBe('step_1');
    expect(steps[0].type).toBe('agent');
    expect(steps[0].dependencies).toEqual([]);
  });

  it('throws on invalid structured output', async () => {
    const model = createMockModel({ steps: 'invalid' });
    await expect(
      generatePlan({ model, input: { goal: 'x' } }),
    ).rejects.toThrow();
  });
});
