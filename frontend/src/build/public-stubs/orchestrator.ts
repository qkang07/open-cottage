import type {
  Artifact,
  OrchestrationState,
} from '../../orchestrator/types';

interface OrchestratorOptions {
  orchestrationId?: string;
  chatSessionId: string;
  goal: string;
}

export class Orchestrator {
  readonly id: string;
  readonly state: OrchestrationState;

  constructor(options: OrchestratorOptions) {
    this.id = options.orchestrationId ?? crypto.randomUUID();
    const now = Date.now();
    this.state = {
      id: this.id,
      chatSessionId: options.chatSessionId,
      goal: options.goal,
      status: 'failed',
      steps: [],
      artifactIds: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  get isRunning(): boolean {
    return false;
  }

  async start(): Promise<void> {}
  pause(): void {}
  cancel(): void {}
  async resume(): Promise<void> {}
  async approvePlan(): Promise<void> {}
  answerHuman(_answer: string): void {}
  importState(_state: OrchestrationState, _artifacts: Artifact[]): void {}
}

