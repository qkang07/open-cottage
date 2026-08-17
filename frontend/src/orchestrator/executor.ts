import type { CottageModelDriver } from '../agent/runtime/model';
import type { CottageTool } from '@/agent/runtime/tool';
import { z } from 'zod';
import type { Artifact, OrchestrationState, OrchestrationStep } from './types';
import type { ArtifactStore } from './artifactStore';

export interface ExecuteStepContext {
  orchestrationId: string;
  state: OrchestrationState;
  artifacts: ArtifactStore;
  model: CottageModelDriver;
  tools: CottageTool[];
  signal: AbortSignal;
  onUpdate: () => void;
  reportArtifact: (artifact: Omit<Artifact, 'createdAt'>) => Promise<Artifact>;
  completeStep: (stepId: string, result?: string) => void;
  failStep: (stepId: string, error: string) => void;
  askHuman: (stepId: string, question: string) => Promise<string>;
  runSubAgent: (step: OrchestrationStep) => Promise<string>;
}

const toolSelectionSchema = z.object({
  tool: z.string().min(1),
  args: z.record(z.unknown()).optional(),
});

async function executeAgentStep(
  step: OrchestrationStep,
  context: ExecuteStepContext,
): Promise<void> {
  const result = await context.runSubAgent(step);
  context.completeStep(step.id, result);
}

async function executeLlmStep(
  step: OrchestrationStep,
  context: ExecuteStepContext,
): Promise<void> {
  const prompt = [
    step.title,
    step.description ?? '',
    'Please produce a concise result.',
  ]
    .filter(Boolean)
    .join('\n\n');

  const response = await context.model.generate(
    { messages: [{ role: 'user', content: prompt }] },
    context.signal,
  );
  const result = response.content;
  context.completeStep(step.id, result);
}

async function executeToolStep(
  step: OrchestrationStep,
  context: ExecuteStepContext,
): Promise<void> {
  const toolNames = context.tools.map((t) => t.name).join(', ');
  const prompt = [
    `You need to perform this action: ${step.title}`,
    step.description ?? '',
    `Available tools: ${toolNames}`,
    'Reply with a JSON object in this exact format (no markdown fences):',
    '{ "tool": "tool_name", "args": { ... } }',
  ]
    .filter(Boolean)
    .join('\n\n');

  const response = await context.model.generateObject(
    {
      messages: [
        {
          role: 'system',
          content:
            'You are a tool selector. Output only valid JSON with "tool" and "args".',
        },
        { role: 'user', content: prompt },
      ],
      schema: toolSelectionSchema,
      schemaName: 'tool_selection',
      schemaDescription: '要执行的工具名称及其参数',
    },
    context.signal,
  );

  const toolName = response.value.tool;
  const args = response.value.args ?? {};

  const tool = context.tools.find((t) => t.name === toolName);
  if (!tool) {
    context.failStep(step.id, `未知工具: ${toolName}`);
    return;
  }

  const output = await tool.invoke(args, { signal: context.signal });
  const result = typeof output === 'string' ? output : JSON.stringify(output);
  context.completeStep(step.id, result);
}

async function executeHumanStep(
  step: OrchestrationStep,
  context: ExecuteStepContext,
): Promise<void> {
  const question = step.description ?? step.title;
  const answer = await context.askHuman(step.id, question);
  context.completeStep(step.id, answer);
}

export async function executeStep(
  step: OrchestrationStep,
  context: ExecuteStepContext,
): Promise<void> {
  switch (step.type) {
    case 'agent':
      await executeAgentStep(step, context);
      break;
    case 'llm':
      await executeLlmStep(step, context);
      break;
    case 'tool':
      await executeToolStep(step, context);
      break;
    case 'human':
      await executeHumanStep(step, context);
      break;
    default:
      context.failStep(step.id, `未知步骤类型: ${String(step.type)}`);
  }
}
