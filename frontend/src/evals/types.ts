import type { StoredMessage } from '../agent/messages';
import type {
  CottageModelEvent,
  CottageModelMessage,
  CottageModelRuntimeIdentity,
} from '../agent/runtime/model';
import type { CottageTool } from '../agent/runtime/tool';
import type { CottageEvent } from '../platform/events';
import type { PolicyGateInput } from '../platform/policy';
import type { SessionEvent } from '../session/eventLog';

export interface EvalWorkspaceExpectation {
  files?: Record<string, string>;
  absent?: string[];
  changedPaths?: string[];
}

export interface EvalEventExpectation {
  type: string;
  count?: number;
  fields?: Record<string, unknown>;
}

export interface EvalRequestExpectation {
  count?: number;
  messageIncludes?: string[];
  toolNamesInclude?: string[];
}

export interface EvalLimits {
  maxModelCalls?: number;
  maxToolCalls?: number;
}

export interface EvalRegressionProvenance {
  id: string;
  source: 'historical' | 'synthetic';
  symptom: string;
  invariant: string;
}

export interface EvalStagingExpectation {
  pendingPaths?: string[];
  persistedPaths?: string[];
}

export interface EvalApprovalDecision {
  toolName?: string;
  allowed?: boolean;
  waitForAction?: boolean;
  reason?: string;
}

export interface EvalToolFault {
  target: 'tool';
  toolName: string;
  occurrence?: number;
  phase: 'before' | 'after';
  error: string;
}

export type AgentEvalAction =
  | { type: 'send'; text: string; waitForCompletion?: boolean }
  | { type: 'awaitTurn' }
  | { type: 'resolveApproval'; toolName?: string; allowed: boolean; reason?: string }
  | { type: 'abort' }
  | { type: 'abortAfterStaged' }
  | { type: 'approveStaged'; paths?: string[] }
  | { type: 'discardStaged'; paths?: string[] }
  | { type: 'deferStaged' }
  | { type: 'destroyAgent' }
  | { type: 'restoreAgent'; corruptEventLogTail?: boolean };

export interface AgentEvalScenario {
  schemaVersion: 1;
  id: string;
  title: string;
  tags?: string[];
  regression?: EvalRegressionProvenance;
  mode?: 'chat' | 'plan';
  systemPrompt?: string;
  /** 兼容单回合场景；提供 actions 时忽略。 */
  prompt?: string;
  actions?: AgentEvalAction[];
  initialHistory?: StoredMessage[];
  workspace?: Record<string, string>;
  staging?: { enabled: boolean };
  planGuard?: {
    allowedPathPrefixes: string[];
    currentStepKind?: 'research' | 'implementation' | 'verification';
    maxChangedFiles?: number;
    changedFiles?: string[];
    maxExternalCalls?: number;
    externalCalls?: number;
  };
  model: {
    streams: readonly (readonly CottageModelEvent[])[];
    identity?: Partial<CottageModelRuntimeIdentity>;
    assertExhausted?: boolean;
  };
  approvalDecisions?: EvalApprovalDecision[];
  faults?: EvalToolFault[];
  extraTools?: CottageTool[];
  expected?: {
    workspace?: EvalWorkspaceExpectation;
    staging?: EvalStagingExpectation;
    trace?: EvalEventExpectation[];
    uiEvents?: EvalEventExpectation[];
    requests?: EvalRequestExpectation;
    approvals?: Array<{ toolName: string; count?: number; allowed?: boolean }>;
    finalResponseIncludes?: string[];
    limits?: EvalLimits;
    planBlocksInclude?: string[];
  };
}

export interface EvalApprovalRequest {
  toolName: string;
  callId: string;
  message?: string;
  args: unknown;
  decision: EvalApprovalDecision;
}

export interface EvalModelRequestArtifact {
  operation: 'stream' | 'generate' | 'generateObject';
  messages: CottageModelMessage[];
  toolNames: string[];
}

export interface EvalAssertionResult {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface AgentEvalReport {
  schemaVersion: 1;
  scenarioId: string;
  title: string;
  tags?: string[];
  regression?: EvalRegressionProvenance;
  passed: boolean;
  durationMs: number;
  assertions: EvalAssertionResult[];
  artifacts: {
    initialWorkspace: Record<string, string>;
    finalWorkspace: Record<string, string>;
    changedPaths: string[];
    trace: unknown[];
    uiEvents: unknown[];
    modelRequests: EvalModelRequestArtifact[];
    approvals: EvalApprovalRequest[];
    planBlocks: string[];
    history: StoredMessage[];
  };
  error?: string;
}

export interface AgentEvalSuiteReport {
  schemaVersion: 1;
  passed: boolean;
  scenarioCount: number;
  passedCount: number;
  failedCount: number;
  durationMs: number;
  reports: AgentEvalReport[];
}

export type EvalRecordedTraceEvent = SessionEvent;
export type EvalRecordedUiEvent = CottageEvent;

export interface EvalPolicyScript {
  decisions: EvalApprovalDecision[];
  requests: EvalApprovalRequest[];
  gate(input: PolicyGateInput): Promise<{ allowed: boolean; reason?: string }>;
  resolvePending(input: {
    toolName?: string;
    allowed: boolean;
    reason?: string;
  }): Promise<void>;
  pendingCount(): number;
  assertExhausted(): void;
}
