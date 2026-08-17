import type { CottageModelDriver } from '../agent/runtime/model';
import type { CottageTool } from '@/agent/runtime/tool';
import type { LlmModelConfig } from '../config/constants';
import type { ProviderSecrets } from '../config/secrets';
import type { WorkspaceSkillIndexEntry } from '../agent/workspaceSkills';
import { ArtifactStore } from './artifactStore';
import {
  loadLargeArtifactContent,
  persistLargeArtifactContent,
  saveOrchestration,
} from './persistence';
import {
  addArtifactToState,
  createOrchestrationState,
  findReadySteps,
  hasRunningSteps,
  isTerminalState,
  setSteps,
  transitionState,
  updateStepStatus,
} from './state';
import { createSubAgent, createSubAgentInput } from './subAgent';
import { executeStep } from './executor';
import { generatePlan } from './planner';
import type {
  Artifact,
  OrchestrationEvent,
  OrchestrationEventType,
  OrchestrationState,
  OrchestrationStep,
} from './types';

export interface OrchestratorOptions {
  orchestrationId?: string;
  chatSessionId: string;
  goal: string;
  model: CottageModelDriver;
  tools: CottageTool[];
  modelConfig: LlmModelConfig;
  secrets: ProviderSecrets;
  enabledTools: string[];
  workspaceSkills?: WorkspaceSkillIndexEntry[];
  projectInstructionsBlock?: string;
  onWorkspaceMutate?: () => void | Promise<void>;
  onEvent?: (event: OrchestrationEvent) => void;
}

const waitFor = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });

export class Orchestrator {
  readonly id: string;
  readonly chatSessionId: string;
  readonly goal: string;
  state: OrchestrationState;
  readonly artifacts: ArtifactStore;

  private readonly options: OrchestratorOptions;
  private abortController: AbortController | null = null;
  private runningPromise: Promise<void> | null = null;
  private pausedByHuman = false;
  private humanResolve: ((value: string) => void) | null = null;
  private humanQuestionValue: string | null = null;
  private readonly listeners = new Map<
    OrchestrationEventType,
    Set<(event: OrchestrationEvent) => void>
  >();

  constructor(options: OrchestratorOptions) {
    this.id = options.orchestrationId ?? crypto.randomUUID();
    this.chatSessionId = options.chatSessionId;
    this.goal = options.goal;
    this.options = options;
    this.state = createOrchestrationState(
      this.id,
      this.chatSessionId,
      this.goal,
    );
    this.artifacts = new ArtifactStore({
      orchestrationId: this.id,
      persistLargeContent: (artifactId, name, content) =>
        persistLargeArtifactContent(this.id, artifactId, name, content),
      loadLargeContent: loadLargeArtifactContent,
    });
  }

  watch(
    event: OrchestrationEventType,
    listener: (event: OrchestrationEvent) => void,
  ): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
  }

  unwatch(
    event: OrchestrationEventType,
    listener: (event: OrchestrationEvent) => void,
  ): void {
    this.listeners.get(event)?.delete(listener);
  }

  private emit(
    type: OrchestrationEventType,
    payload?: { stepId?: string; artifactId?: string },
  ): void {
    const event: OrchestrationEvent = {
      type,
      orchestrationId: this.id,
      stepId: payload?.stepId,
      artifactId: payload?.artifactId,
    };
    this.options.onEvent?.(event);
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }

  get isRunning(): boolean {
    return this.runningPromise !== null;
  }

  get humanQuestion(): string | null {
    return this.humanQuestionValue;
  }

  async start(): Promise<void> {
    if (this.runningPromise) return this.runningPromise;
    if (isTerminalState(this.state)) return;

    this.abortController = new AbortController();
    this.runningPromise = this.run();
    try {
      await this.runningPromise;
    } finally {
      this.runningPromise = null;
      this.abortController = null;
    }
  }

  pause(): void {
    this.pausedByHuman = false;
    this.abortController?.abort();
  }

  cancel(): void {
    this.abortController?.abort();
    if (!isTerminalState(this.state)) {
      this.state = transitionState(this.state, 'failed');
      this.emit('finished');
      void this.persist();
    }
  }

  async resume(): Promise<void> {
    if (this.state.status !== 'paused' || this.runningPromise) return;
    this.state = transitionState(this.state, 'running');
    await this.start();
  }

  /** 用户批准计划后开始执行 */
  async approvePlan(): Promise<void> {
    if (this.state.status !== 'awaiting_approval' || this.runningPromise) return;
    await this.start();
  }

  answerHuman(answer: string): void {
    if (this.humanResolve) {
      this.humanResolve(answer);
      this.humanResolve = null;
      this.humanQuestionValue = null;
      this.pausedByHuman = false;
    }
  }

  importState(state: OrchestrationState, artifacts: Artifact[]): void {
    this.state = state;
    this.artifacts.importAll(artifacts);
  }

  private async run(): Promise<void> {
    const signal = this.abortController!.signal;

    try {
      if (this.state.steps.length === 0) {
        const steps = await generatePlan({
          model: this.options.model,
          input: {
            goal: this.goal,
            availableTools: this.options.tools.map((t) => ({
              name: t.name,
              description: t.description ?? '',
            })),
          },
          signal,
        });
        // setSteps 会切到 'awaiting_approval'：先停下等用户批准，不自动执行
        this.state = setSteps(this.state, steps);
        await this.persist();
        this.emit('update');
        return;
      }

      if (
        this.state.status === 'planning' ||
        this.state.status === 'awaiting_approval'
      ) {
        this.state = transitionState(this.state, 'running');
      }

      while (this.state.status === 'running') {
        if (signal.aborted && !this.pausedByHuman) {
          this.state = transitionState(this.state, 'paused');
          break;
        }

        if (this.pausedByHuman) {
          await waitFor(100);
          continue;
        }

        const readySteps = findReadySteps(this.state);
        if (readySteps.length === 0) {
          if (hasRunningSteps(this.state)) {
            await waitFor(100);
            continue;
          }
          const allDone = this.state.steps.every((s) => s.status === 'done');
          this.state = transitionState(
            this.state,
            allDone ? 'completed' : 'failed',
          );
          break;
        }

        // v1: 串行执行，避免并发竞争
        const step = readySteps[0];
        await this.executeStep(step);
      }
    } catch (error) {
      if (!isTerminalState(this.state)) {
        this.state = transitionState(this.state, 'failed');
      }
      this.emit('update');
    } finally {
      // 停在「待批准」时不收尾、不发 finished，等用户批准后再执行
      if (this.state.status !== 'awaiting_approval') {
        if (!isTerminalState(this.state) && this.state.status !== 'paused') {
          this.state = transitionState(this.state, 'failed');
        }
        this.emit('finished');
        await this.persist();
      }
    }
  }

  private async executeStep(step: OrchestrationStep): Promise<void> {
    this.state = updateStepStatus(this.state, step.id, 'doing');
    this.emit('stepStart', { stepId: step.id });
    await this.persist();

    const context = {
      orchestrationId: this.id,
      state: this.state,
      artifacts: this.artifacts,
      model: this.options.model,
      tools: this.options.tools,
      signal: this.abortController!.signal,
      onUpdate: () => {
        this.emit('update');
      },
      reportArtifact: this.reportArtifact,
      completeStep: this.completeStep,
      failStep: this.failStep,
      askHuman: this.askHumanForStep,
      runSubAgent: this.runSubAgent,
    };

    try {
      await executeStep(step, context);
      const current = this.state.steps.find((s) => s.id === step.id);
      if (current?.status === 'doing') {
        // 执行器未显式完成，按成功收尾
        this.completeStep(step.id, current.result);
      }
    } catch (error) {
      this.failStep(
        step.id,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private runSubAgent = async (step: OrchestrationStep): Promise<string> => {
    const contextArtifacts = this.getContextArtifactsForStep(step);
    const subAgent = createSubAgent({
      step,
      contextArtifacts,
      modelConfig: this.options.modelConfig,
      secrets: this.options.secrets,
      enabledTools: this.options.enabledTools,
      workspaceSkills: this.options.workspaceSkills,
      projectInstructionsBlock: this.options.projectInstructionsBlock,
      onWorkspaceMutate: this.options.onWorkspaceMutate,
      onReportArtifact: this.reportArtifactForStep(step.id),
      onCompleteStep: (result) => this.completeStep(step.id, result),
      onFailStep: (reason) => this.failStep(step.id, reason),
      onAskHuman: this.askHumanForSubAgent,
    });

    const input = createSubAgentInput(step, contextArtifacts);

    const signal = this.abortController!.signal;
    const onAbort = () => subAgent.abort();
    signal.addEventListener('abort', onAbort);

    try {
      await subAgent.next(input);
    } finally {
      signal.removeEventListener('abort', onAbort);
    }

    const stepState = this.state.steps.find((s) => s.id === step.id);
    if (stepState?.status === 'done' && stepState.result) {
      return stepState.result;
    }

    const lastAssistant = [...subAgent.messages]
      .reverse()
      .find((m) => m.role === 'assistant');
    return (
      lastAssistant?.sections
        .filter((s) => s.type === 'content')
        .map((s) => s.text)
        .join('\n') ?? ''
    );
  };

  private getContextArtifactsForStep(step: OrchestrationStep): Artifact[] {
    if (step.dependencies.length === 0) {
      return this.artifacts.getAll();
    }
    const depIds = new Set(step.dependencies);
    return this.artifacts.getAll().filter((a) => depIds.has(a.producerStepId));
  }

  private reportArtifactForStep =
    (stepId: string) =>
    async (artifact: Omit<Artifact, 'createdAt'>): Promise<Artifact> => {
      const withProducer = { ...artifact, producerStepId: stepId };
      const added = await this.artifacts.add(withProducer);
      this.state = addArtifactToState(this.state, added);
      this.emit('artifactAdd', { artifactId: added.id, stepId });
      await this.persist();
      return added;
    };

  private reportArtifact = async (
    artifact: Omit<Artifact, 'createdAt'>,
  ): Promise<Artifact> => {
    const producerStepId =
      artifact.producerStepId ?? this.state.currentStepId ?? 'unknown';
    const withProducer = { ...artifact, producerStepId };
    const added = await this.artifacts.add(withProducer);
    this.state = addArtifactToState(this.state, added);
    this.emit('artifactAdd', {
      artifactId: added.id,
      stepId: producerStepId,
    });
    await this.persist();
    return added;
  };

  private completeStep = (stepId: string, result?: string): void => {
    this.state = updateStepStatus(this.state, stepId, 'done', { result });
    this.emit('stepComplete', { stepId });
    this.emit('update');
    void this.persist();
  };

  private failStep = (stepId: string, error: string): void => {
    this.state = updateStepStatus(this.state, stepId, 'failed', { error });
    this.emit('stepFail', { stepId });
    this.emit('update');
    void this.persist();
  };

  private askHumanForStep = async (
    stepId: string,
    question: string,
  ): Promise<string> => {
    void stepId;
    return this.askHumanInternal(stepId, question);
  };

  private askHumanForSubAgent = async (question: string): Promise<string> => {
    return this.askHumanInternal(this.state.currentStepId ?? 'unknown', question);
  };

  private askHumanInternal = async (
    stepId: string,
    question: string,
  ): Promise<string> => {
    void stepId;
    this.pausedByHuman = true;
    this.humanQuestionValue = question;
    this.emit('update');
    await this.persist();

    return new Promise((resolve) => {
      this.humanResolve = resolve;
    });
  };

  private async persist(): Promise<void> {
    await saveOrchestration(
      this.id,
      this.state,
      this.artifacts.exportAll(),
    );
  }
}
