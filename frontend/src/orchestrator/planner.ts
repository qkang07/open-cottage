import type { CottageModelDriver } from '../agent/runtime/model';
import { z } from 'zod';
import type {
  OrchestrationPlanInput,
  OrchestrationPlanOutput,
  OrchestrationStep,
} from './types';

const PLANNER_SYSTEM_PROMPT = `You are a workflow planner for an AI coding assistant.
Your job is to break a complex user request into a clear, ordered plan of the ACTUAL CHANGES to be made.

CRITICAL — the plan is shown to the user for approval BEFORE execution, so it must describe WHAT WILL BE CHANGED, not how you will investigate:
- Do NOT create steps for exploration, investigation, inspecting, reading, understanding, analyzing, or "designing" the codebase.
- Assume the necessary code reading and understanding happens implicitly INSIDE each change step.
- Every step MUST represent a concrete change/deliverable that moves toward the goal (e.g. "Modify X to do Y", "Add Z", "Update the persistence helper"), NOT a preparatory research task.
- If the goal is purely a question with no code change, produce a single synthesis step.

Rules:
1. Use the minimum number of steps necessary; prefer fewer, meaningful change steps over micromanagement.
2. Each step must have a unique id (lowercase snake_case), a short title, and an optional description.
3. Step type must be one of:
   - "agent": delegate a concrete implementation change to a sub-agent (most common)
   - "tool": a single, well-defined tool call
   - "llm": a pure LLM synthesis/summarization step
   - "human": pause and ask the user for input or confirmation
4. Use "dependencies" to declare which step ids must finish before this step starts.
5. If a step can be parallelized, omit dependencies; otherwise list prerequisites.

Output ONLY a JSON object with this shape (no markdown code fences):
{
  "steps": [
    { "id": "step_1", "title": "...", "description": "...", "type": "agent", "dependencies": [] },
    { "id": "step_2", "title": "...", "description": "...", "type": "agent", "dependencies": ["step_1"] }
  ]
}`;

function buildPlannerPrompt(input: OrchestrationPlanInput): string {
  const lines = [
    '# Goal',
    input.goal,
  ];

  if (input.context?.trim()) {
    lines.push('', '# Context', input.context.trim());
  }

  if (input.availableTools && input.availableTools.length > 0) {
    lines.push(
      '',
      '# Available Tools',
      ...input.availableTools.map(
        (t) => `- ${t.name}: ${t.description ?? ''}`,
      ),
    );
  }

  lines.push('', '# Plan');
  return lines.join('\n');
}

const orchestrationPlanSchema = z.object({
  steps: z.array(
    z.object({
      id: z.string().optional(),
      title: z.string().optional(),
      description: z.string().optional(),
      type: z.enum(['agent', 'tool', 'llm', 'human']).optional(),
      dependencies: z.array(z.string()).optional(),
    }),
  ),
});

function normalizePlanOutput(
  parsed: z.infer<typeof orchestrationPlanSchema>,
): OrchestrationPlanOutput {
  const steps = parsed.steps.map((step, index) => {
    const id = step.id?.trim() || `step_${index + 1}`;
    return {
      id,
      title: step.title?.trim() || id,
      description: step.description?.trim() || undefined,
      type: step.type ?? 'agent',
      dependencies: (step.dependencies ?? []).map((item) => item.trim()).filter(Boolean),
    };
  });
  return { steps };
}

export interface GeneratePlanOptions {
  model: CottageModelDriver;
  input: OrchestrationPlanInput;
  signal?: AbortSignal;
  maxRetries?: number;
}

export async function generatePlan(
  options: GeneratePlanOptions,
): Promise<OrchestrationStep[]> {
  const { model, input, signal } = options;
  const response = await model.generateObject(
    {
      messages: [
        { role: 'system', content: PLANNER_SYSTEM_PROMPT },
        { role: 'user', content: buildPlannerPrompt(input) },
      ],
      schema: orchestrationPlanSchema,
      schemaName: 'orchestration_plan',
      schemaDescription: '可执行的编排步骤列表',
    },
    signal,
  );
  const plan = normalizePlanOutput(response.value);

  return plan.steps.map(
    (step): OrchestrationStep => ({
      ...step,
      status: 'pending',
      artifactIds: [],
      dependencies: step.dependencies ?? [],
    }),
  );
}
