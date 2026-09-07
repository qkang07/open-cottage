import type { CottageModelUsage } from '../../agent/runtime/model';
import type { LlmProviderId } from '../../config/llmProviders';
import type {
  PlanDefinition,
  PlanEvent,
  PlanRun,
  ToolMutationReport,
} from '../../plan/types';

export interface LiveEvalBudgetConfig {
  maxCases: number;
  maxModelCalls: number;
  maxTotalTokens: number;
  maxDurationMs: number;
  maxOutputTokens: number;
}

export interface LiveEvalConfig {
  enabled: boolean;
  dryRun: boolean;
  provider: LlmProviderId;
  model: string;
  connectionId: string;
  apiKeyEnv: string;
  apiKey: string;
  baseUrl?: string;
  caseIds: string[];
  tags: string[];
  budget: LiveEvalBudgetConfig;
  minimumScore: number;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
  reportPath: string;
}

export interface LiveEvalUsageTotals extends CottageModelUsage {
  modelCalls: number;
  durationMs: number;
}

export interface LiveEvalModelCallRecord {
  sequence: number;
  phase: string;
  kind: 'stream' | 'generate' | 'generateObject';
  messageCount: number;
  messageCharacters: number;
  toolCount: number;
  durationMs: number;
  usage: CottageModelUsage;
}

export interface LiveEvalCheckResult {
  id: string;
  passed: boolean;
  weight: number;
  detail?: string;
}

export interface LiveEvalCaseReport {
  caseId: string;
  title: string;
  tags: string[];
  passed: boolean;
  score: number;
  checks: LiveEvalCheckResult[];
  usage: LiveEvalUsageTotals;
  modelCallDetails?: LiveEvalModelCallRecord[];
  toolCalls: Array<{ name: string; status: string }>;
  changedPaths: string[];
  responseExcerpt: string;
  error?: string;
  plan?: LiveEvalPlanTrace;
}

export interface LiveEvalPlanTrace {
  suggestion?: { goal: string; reason?: string; accepted: boolean };
  drafts: PlanDefinition[];
  approvals: Array<{
    planId: string;
    revision: number;
    decision: 'approved' | 'adjust' | 'cancel';
  }>;
  transitions: PlanEvent[];
  mutations: Array<{
    stepId?: string;
    predictedPaths: string[];
    report: ToolMutationReport;
  }>;
  /** v1 早期报告可能没有该字段。 */
  stepCompletions?: Array<{
    stepId: string;
    hintedChangedFiles?: string[];
    actualChangedFiles: string[];
  }>;
  verification: Array<{
    scope: 'step' | 'final';
    stepId?: string;
    results: Array<{ id: string; status: string; assurance?: string }>;
  }>;
  checkpoints: Array<{
    stepId: string;
    paths: string[];
    files: Record<string, string | null>;
  }>;
  finalDefinition?: PlanDefinition;
  finalRun?: PlanRun;
  finalWorkspace: Record<string, string>;
  /** 评测状态提交序号；后续接入 commit/head 恢复 case 时可用于对照。 */
  headSequence: number;
}

export interface LiveEvalReport {
  schemaVersion: 1;
  kind: 'live-model-eval';
  generatedAt: string;
  dryRun: boolean;
  model: {
    provider: LlmProviderId;
    model: string;
    connectionId: string;
    baseUrl?: string;
  };
  budget: LiveEvalBudgetConfig;
  selection: { caseIds: string[]; tags: string[] };
  summary: {
    passed: boolean;
    caseCount: number;
    passedCount: number;
    averageScore: number;
    usage: LiveEvalUsageTotals;
    estimatedCost?: number;
  };
  cases: LiveEvalCaseReport[];
  configurationErrors?: string[];
}
