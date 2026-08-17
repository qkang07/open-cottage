/**
 * 通用 DoD（Definition of Done）验收模型。
 *
 * 这一层与任务类型无关：编程、办公、数据任务共用同一套检查项，
 * 由 `platform/verify/engine.ts` 执行，输出结构化 `VerifyReport`，
 * 供 TaskRunner 决策、UI 展示、trace 回放。
 */

export type AcceptanceCheckType =
  /** 文件/目录存在 */
  | 'fileExists'
  /** 文件内容包含子串（not=true 时表示不包含） */
  | 'contentContains'
  /** 文件内容匹配正则 */
  | 'contentMatches'
  /** 文件按 JSON 解析后，指定字段路径等于期望值 */
  | 'jsonField'
  /** 交付清单覆盖：manifest.paths 全部存在，且条目数 >= minCount */
  | 'manifestCoverage';

export interface AcceptanceCheck {
  id?: string;
  type: AcceptanceCheckType;
  /** 目标文件路径（fileExists / content* / jsonField 必填） */
  path?: string;
  /** contentContains: 子串；contentMatches: 正则源；jsonField: 期望值的字符串形式 */
  expected?: string;
  /** contentMatches 的正则 flags，默认 '' */
  flags?: string;
  /** jsonField 的字段路径，如 `a.b[0].c` 或 `routes[0].path` */
  field?: string;
  /** jsonField 期望值（string | number | boolean | null） */
  equals?: unknown;
  /** manifestCoverage 的最少条目数 */
  minCount?: number;
  /** 否定语义：fileExists→不存在；contentContains→不包含 */
  not?: boolean;
  /** 人类可读描述，用于 UI 与 uncovered 列表 */
  description?: string;
}

export interface CheckResult {
  id: string;
  type: AcceptanceCheckType;
  description?: string;
  pass: boolean;
  /** 计划模式使用的显式结论；旧调用方仍可读取 pass。 */
  status?: 'passed' | 'failed' | 'unavailable' | 'manual';
  providerId?: string;
  runtime?: 'browser' | 'worker' | 'remote' | 'local-service' | 'human';
  assurance?: 'structural' | 'functional' | 'human';
  /** 失败原因；通过时留空 */
  reason?: string;
  /** 渲染用：检查目标（路径 / field / manifest） */
  target?: string;
}

export type VerifyVerdict = 'pass' | 'fail' | 'unverified';

export interface VerifyReport {
  verdict: VerifyVerdict;
  checks: CheckResult[];
  /** 未通过项的描述/id 列表，供 prompt 回灌与 UI 高亮 */
  uncovered: string[];
  /** 总体失败原因（兼容旧 VerifyResult.reason） */
  reason?: string;
  runAt: number;
  manifestPathCount: number;
  acceptanceFileCount: number;
  /** 验收脚本是否被执行 */
  scriptRan: boolean;
}
