import type { CapabilityRiskLevel } from '../capabilities/types';

export type PolicyDecision =
  | { action: 'allow' }
  | { action: 'deny'; reason: string }
  | { action: 'confirm'; message: string; riskLevel: CapabilityRiskLevel };

export interface ToolPolicyVerdict {
  allowed: boolean;
  reason?: string;
}

export interface PolicyGateInput {
  toolName: string;
  args: unknown;
  callId: string;
  signal: AbortSignal;
  /** 进入「等待用户审批」状态时回调（含落盘文案），供 UI / 历史组件立即刷新 */
  onAwaitingApproval?: (info: { message: string }) => void;
}

export type PolicyGate = (input: PolicyGateInput) => Promise<ToolPolicyVerdict>;
