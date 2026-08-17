import type { CottageAgent } from '../agent/CottageAgent';
import { createCottageAgent } from '../agent/createCottageAgent';
import type { LlmModelConfig } from '../config/constants';
import type { ProviderSecrets } from '../config/secrets';
import type { WorkspaceSkillIndexEntry } from '../agent/workspaceSkills';
import type { Artifact, OrchestrationStep } from './types';
import { createOrchestratorSubTools } from './orchestratorTools';

export interface CreateSubAgentOptions {
  step: OrchestrationStep;
  contextArtifacts: Artifact[];
  modelConfig: LlmModelConfig;
  secrets: ProviderSecrets;
  enabledTools: string[];
  workspaceSkills?: WorkspaceSkillIndexEntry[];
  projectInstructionsBlock?: string;
  onWorkspaceMutate?: () => void | Promise<void>;
  onReportArtifact: (artifact: Omit<Artifact, 'createdAt'>) => Promise<Artifact>;
  onCompleteStep: (result?: string) => void;
  onFailStep: (reason: string) => void;
  onAskHuman: (question: string) => Promise<string>;
}

function formatArtifactForSubAgent(artifact: Artifact): string {
  let prefix = `[${artifact.type}] ${artifact.name}`;
  if (artifact.filePath) {
    prefix += ` (file: ${artifact.filePath})`;
  }
  const preview = artifact.content ?? '';
  const maxLen = 800;
  const body =
    preview.length > maxLen ? `${preview.slice(0, maxLen)}…` : preview;
  return `${prefix}\n${body}`;
}

export function buildSubAgentUserMessage(
  step: OrchestrationStep,
  contextArtifacts: Artifact[],
): string {
  const lines = [
    `## 当前步骤: ${step.title}`,
    '',
    step.description ?? '',
    '',
    '请完成此步骤。你可以使用所有可用工具。',
    '如需提交产物，请调用 orch_reportArtifact。',
    '完成后必须调用 orch_completeStep。',
    '若无法完成，请调用 orch_failStep 说明原因。',
  ];

  if (contextArtifacts.length > 0) {
    lines.push(
      '',
      '## 可用上下文产物',
      ...contextArtifacts.map(formatArtifactForSubAgent),
    );
  }

  return lines.filter(Boolean).join('\n');
}

export function createSubAgent(options: CreateSubAgentOptions): CottageAgent {
  const extraTools = createOrchestratorSubTools({
    reportArtifact: options.onReportArtifact,
    completeStep: options.onCompleteStep,
    failStep: options.onFailStep,
    askHuman: options.onAskHuman,
  });

  return createCottageAgent({
    mode: 'chat',
    llmConfig: options.modelConfig,
    secrets: options.secrets,
    enabledTools: options.enabledTools,
    workspaceSkills: options.workspaceSkills,
    projectInstructionsBlock: options.projectInstructionsBlock,
    onWorkspaceMutate: options.onWorkspaceMutate,
    extraTools,
  });
}

export function createSubAgentInput(
  step: OrchestrationStep,
  contextArtifacts: Artifact[],
): string {
  return buildSubAgentUserMessage(step, contextArtifacts);
}
