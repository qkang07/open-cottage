export type OrchestrationStatus =
  | 'planning'
  | 'awaiting_approval'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed';

export type OrchestrationStepType = 'agent' | 'tool' | 'llm' | 'human';

export type OrchestrationStepStatus =
  | 'pending'
  | 'doing'
  | 'done'
  | 'failed';

export interface OrchestrationStep {
  id: string;
  title: string;
  description?: string;
  type: OrchestrationStepType;
  status: OrchestrationStepStatus;
  dependencies: string[];
  artifactIds: string[];
  result?: string;
  error?: string;
}

export interface Artifact {
  id: string;
  type: 'text' | 'json' | 'file' | 'code';
  name: string;
  content?: string;
  filePath?: string;
  producerStepId: string;
  createdAt: number;
}

export interface OrchestrationState {
  id: string;
  chatSessionId: string;
  goal: string;
  status: OrchestrationStatus;
  steps: OrchestrationStep[];
  artifactIds: string[];
  createdAt: number;
  updatedAt: number;
  currentStepId?: string;
}

export type OrchestrationEventType =
  | 'update'
  | 'stepStart'
  | 'stepComplete'
  | 'stepFail'
  | 'artifactAdd'
  | 'finished';

export interface OrchestrationEvent {
  type: OrchestrationEventType;
  orchestrationId: string;
  stepId?: string;
  artifactId?: string;
}

export interface OrchestrationPlanInput {
  goal: string;
  context?: string;
  availableTools?: Array<{ name: string; description: string }>;
}

export interface OrchestrationPlanOutput {
  steps: Array<{
    id: string;
    title: string;
    description?: string;
    type: OrchestrationStepType;
    dependencies?: string[];
  }>;
}

export interface SerializedOrchestration {
  state: OrchestrationState;
  artifacts: Artifact[];
}
