import { runVerify } from '../platform/verify';
import type { VerifyReport } from '../platform/verify';
import type { TaskManifest, TaskSpec } from './types';

/**
 * 旧版返回结构（{ ok, reason }），保留给不关心逐条结果的调用方。
 * 新调用方应直接使用 {@link runAcceptance} 拿到完整 {@link VerifyReport}。
 */
export interface VerifyResult {
  ok: boolean;
  reason?: string;
  report?: VerifyReport;
}

export const runAcceptance = async (
  spec: TaskSpec,
  manifest: TaskManifest | null,
): Promise<VerifyReport> =>
  runVerify({
    acceptanceFiles: spec.acceptance.files,
    acceptanceScript: spec.acceptance.script,
    checks: spec.acceptance.checks,
    manifest,
  });

/**
 * @deprecated 保留兼容；优先使用 {@link runAcceptance}。
 */
export const verifyAcceptance = async (
  spec: TaskSpec,
  manifest: TaskManifest | null,
): Promise<VerifyResult> => {
  const report = await runAcceptance(spec, manifest);
  return {
    ok: report.verdict === 'pass',
    reason: report.reason,
    report,
  };
};
