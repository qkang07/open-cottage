import type { CheckResult, VerifyReport } from '../platform/verify';

export type PlanStatus =
  | 'draft'
  | 'awaiting_approval'
  | 'running'
  | 'waiting_for_user'
  | 'paused'
  | 'verifying'
  | 'awaiting_acceptance'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type PlanStepStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'skipped';

export type VerificationState =
  | 'not_checked'
  | 'verified'
  | 'partially_verified'
  | 'unverified'
  | 'failed'
  | 'unavailable';

export type VerificationRuntime =
  | 'browser'
  | 'worker'
  | 'remote'
  | 'local-service'
  | 'human';

export type VerificationAssurance = 'structural' | 'functional' | 'human';

export type JsonSchema = Record<string, unknown>;

export interface VerificationCapability {
  providerId: string;
  label: string;
  runtime: VerificationRuntime;
  available: boolean;
  kinds: string[];
  /** Optional for existing v1 definitions; omitted values mean structural v1. */
  version?: string;
  assurance?: VerificationAssurance;
  configSchema?: JsonSchema;
  configSchemaDigest?: string;
  trusted?: boolean;
  reason?: string;
}

export interface AcceptanceCriterion {
  id: string;
  providerId: string;
  description: string;
  required: boolean;
  config: Record<string, unknown>;
}

export interface PlanBudgets {
  maxTurns: number;
  maxChangedFiles: number;
  maxExternalCalls: number;
  maxStepRetries: number;
}

export interface PlanCounters {
  turns: number;
  changedFiles: number;
  externalCalls: number;
}

export type PlanStepKind = 'research' | 'implementation' | 'verification';

export interface PlanStep {
  id: string;
  title: string;
  detail: string;
  kind: PlanStepKind;
  dependsOn: string[];
  allowedPathPrefixes?: string[];
  acceptance: AcceptanceCriterion[];
  skippable?: boolean;
}

export interface MutationEntry {
  path: string;
  kind: 'file' | 'directory';
  beforeHash?: string;
  afterHash?: string;
  size?: number;
}

export interface ToolMutationReport {
  created: MutationEntry[];
  modified: MutationEntry[];
  deleted: MutationEntry[];
  moved: Array<{ from: MutationEntry; to: MutationEntry }>;
}

export interface HumanAcceptanceRecord {
  criterionId: string;
  acceptedBy: string;
  acceptedAt: number;
  note?: string;
  evidence?: ExecutionEvidence[];
}

export interface PlanDefinition {
  schema: 1;
  id: string;
  revision: number;
  sessionId: string;
  workspaceId: string;
  goal: string;
  requirements: string[];
  design: string;
  allowedPathPrefixes: string[];
  steps: PlanStep[];
  finalAcceptance: AcceptanceCriterion[];
  verificationCapabilitySnapshot: VerificationCapability[];
  budgets: PlanBudgets;
  createdAt: number;
  updatedAt: number;
}

export interface ExecutionEvidence {
  id: string;
  kind: 'summary' | 'file' | 'tool' | 'structural-check';
  summary: string;
  path?: string;
  at: number;
}

export interface StepRunState {
  status: PlanStepStatus;
  verificationState: VerificationState;
  attempts: number;
  changedFiles: string[];
  evidence: ExecutionEvidence[];
  checkResults: CheckResult[];
  mutationReports?: ToolMutationReport[];
  failureReason?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface PlanRun {
  schema: 1;
  planId: string;
  sessionId: string;
  workspaceId: string;
  approvedRevision: number;
  status: PlanStatus;
  stepStates: Record<string, StepRunState>;
  currentStepId?: string;
  changedFiles: string[];
  pendingReason?: string;
  recoveryRequired?: boolean;
  repositoryCorrupt?: boolean;
  operatorInstructions: string[];
  counters: PlanCounters;
  finalVerification?: VerifyReport;
  acceptanceRecords?: Record<string, HumanAcceptanceRecord>;
  invalidatedStepIds?: string[];
  requiresHumanAcceptance?: boolean;
  commitId?: string;
  acceptedByUserAt?: number;
  archivedAt?: number;
  recentEvents?: PlanEvent[];
  revisionDiff?: PlanRevisionDiff;
  createdAt: number;
  updatedAt: number;
}

export interface PlanRevisionDiff {
  fromRevision: number;
  toRevision: number;
  addedPaths: string[];
  removedPaths: string[];
  budgetChanges: Partial<Record<keyof PlanBudgets, { before: number; after: number }>>;
  providerChanges: Array<{
    providerId: string;
    beforeVersion?: string;
    afterVersion?: string;
    beforeAssurance?: VerificationAssurance;
    afterAssurance?: VerificationAssurance;
  }>;
  invalidatedStepIds: string[];
}

export interface PlanDraftStep {
  id?: string;
  title: string;
  detail?: string;
  kind?: PlanStepKind;
  dependsOn?: string[];
  allowedPathPrefixes?: string[];
  acceptance?: Array<Partial<AcceptanceCriterion> & { description: string }>;
  skippable?: boolean;
}

export interface PlanDraft {
  planId?: string;
  baseRevision?: number;
  goal: string;
  requirements: string[];
  design: string;
  allowedPathPrefixes: string[];
  steps: PlanDraftStep[];
  finalAcceptance: Array<
    Partial<AcceptanceCriterion> & { description: string }
  >;
  budgets?: Partial<PlanBudgets>;
  preserveStepIds?: string[];
}

export interface PlanManifest {
  planId: string;
  revision: number;
  paths: string[];
  entries?: MutationEntry[];
  mutationReports?: ToolMutationReport[];
  generatedAt: number;
}

export interface PlanEvent {
  type: string;
  at: number;
  revision?: number;
  stepId?: string;
  detail?: Record<string, unknown>;
}

export interface PlanCommit {
  schema: 1;
  commitId: string;
  parentCommitId?: string;
  planId: string;
  definitionRevision: number;
  manifestChecksum?: string;
  verifyChecksum?: string;
  run: PlanRun;
  event: PlanEvent;
  checksum: string;
  createdAt: number;
}

export interface PlanHead {
  schema: 1;
  planId: string;
  commitId: string;
  approvedRevision: number;
  updatedAt: number;
}

export type PlanErrorCode =
  | 'invalid_transition'
  | 'revision_mismatch'
  | 'step_not_found'
  | 'step_not_skippable'
  | 'dependency_not_satisfied'
  | 'repository_corrupt'
  | 'write_lock_unavailable'
  | 'mutation_mismatch';

export interface PlanCommandError {
  code: PlanErrorCode;
  message: string;
  detail?: Record<string, unknown>;
}

export const DEFAULT_PLAN_BUDGETS: PlanBudgets = {
  maxTurns: 25,
  maxChangedFiles: 20,
  maxExternalCalls: 10,
  maxStepRetries: 2,
};
