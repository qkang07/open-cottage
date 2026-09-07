import { runScriptInWorker } from '../../agent/runScript';
import { workspace } from '../../workspace/FileSystemWorkspace';
import type { TaskManifest } from '../../task/types';
import type {
  AcceptanceCheck,
  CheckResult,
  VerifyReport,
} from './types';

const describeCheck = (check: AcceptanceCheck): string => {
  if (check.description?.trim()) return check.description.trim();
  switch (check.type) {
    case 'fileExists':
      return `${check.not ? '不存在' : '存在'}：${check.path ?? ''}`;
    case 'contentContains':
      return `${check.path ?? ''} ${check.not ? '不包含' : '包含'} "${check.expected ?? ''}"`;
    case 'contentMatches':
      return `${check.path ?? ''} 匹配 /${check.expected ?? ''}/${check.flags ?? ''}`;
    case 'jsonField':
      return `${check.path ?? ''} 字段 ${check.field ?? ''} === ${JSON.stringify(check.equals)}`;
    case 'manifestCoverage':
      return `交付清单覆盖（>= ${check.minCount ?? 0}）`;
  }
};

const targetOf = (check: AcceptanceCheck): string => {
  switch (check.type) {
    case 'fileExists':
    case 'contentContains':
    case 'contentMatches':
    case 'jsonField':
      return check.path ?? '';
    case 'manifestCoverage':
      return 'manifest';
  }
};

const ensurePath = (check: AcceptanceCheck): string | null => {
  const path = check.path?.trim();
  if (!path) return null;
  return path;
};

const readFileSafe = async (path: string): Promise<string | null> => {
  if (!(await workspace.exists(path))) return null;
  try {
    const { content } = await workspace.readFile(path);
    return content;
  } catch {
    return null;
  }
};

/** 按 `a.b[0].c` 解析 JSON 字段路径。 */
const readJsonField = (root: unknown, fieldPath: string): unknown => {
  const tokens = fieldPath
    .split(/\.|\[(\d+)\]/)
    .filter((t) => t !== undefined && t !== '');
  let current: unknown = root;
  for (const token of tokens) {
    if (current === null || current === undefined) return undefined;
    if (/^\d+$/.test(token)) {
      const arr = Array.isArray(current) ? current : null;
      const idx = Number(token);
      if (!arr || idx < 0 || idx >= arr.length) return undefined;
      current = arr[idx];
    } else {
      current = (current as Record<string, unknown>)[token];
    }
  }
  return current;
};

const valuesEqual = (a: unknown, b: unknown): boolean => {
  if (typeof a === 'string' && typeof b === 'string') return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
};

export const runAcceptanceCheck = async (check: AcceptanceCheck): Promise<CheckResult> => {
  const id = check.id ?? `${check.type}:${check.path ?? check.field ?? ''}`;
  const base: CheckResult = {
    id,
    type: check.type,
    description: describeCheck(check),
    target: targetOf(check),
    pass: false,
  };

  switch (check.type) {
    case 'fileExists': {
      const path = ensurePath(check);
      if (!path) return { ...base, pass: false, reason: '未提供 path' };
      const exists = await workspace.exists(path);
      const pass = check.not ? !exists : exists;
      return {
        ...base,
        pass,
        reason: pass ? undefined : check.not ? `路径仍存在：${path}` : `路径不存在：${path}`,
      };
    }

    case 'contentContains': {
      const path = ensurePath(check);
      if (!path) return { ...base, pass: false, reason: '未提供 path' };
      const content = await readFileSafe(path);
      if (content === null) {
        return { ...base, pass: false, reason: `文件不存在或不可读：${path}` };
      }
      const needle = check.expected ?? '';
      const hit = content.includes(needle);
      const pass = check.not ? !hit : hit;
      return {
        ...base,
        pass,
        reason: pass
          ? undefined
          : check.not
            ? `文件仍包含 "${needle}"`
            : `文件未包含 "${needle}"`,
      };
    }

    case 'contentMatches': {
      const path = ensurePath(check);
      if (!path) return { ...base, pass: false, reason: '未提供 path' };
      const content = await readFileSafe(path);
      if (content === null) {
        return { ...base, pass: false, reason: `文件不存在或不可读：${path}` };
      }
      let regex: RegExp;
      try {
        regex = new RegExp(check.expected ?? '', check.flags ?? '');
      } catch (error) {
        return {
          ...base,
          pass: false,
          reason: `正则非法：${error instanceof Error ? error.message : String(error)}`,
        };
      }
      const hit = regex.test(content);
      const pass = check.not ? !hit : hit;
      return {
        ...base,
        pass,
        reason: pass ? undefined : check.not ? '文件仍匹配该正则' : '文件未匹配该正则',
      };
    }

    case 'jsonField': {
      const path = ensurePath(check);
      if (!path) return { ...base, pass: false, reason: '未提供 path' };
      if (!check.field) return { ...base, pass: false, reason: '未提供 field' };
      const content = await readFileSafe(path);
      if (content === null) {
        return { ...base, pass: false, reason: `文件不存在或不可读：${path}` };
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch (error) {
        return {
          ...base,
          pass: false,
          reason: `JSON 解析失败：${error instanceof Error ? error.message : String(error)}`,
        };
      }
      const actual = readJsonField(parsed, check.field);
      const pass = valuesEqual(actual, check.equals);
      return {
        ...base,
        pass,
        reason: pass
          ? undefined
          : `字段 ${check.field} 期望 ${JSON.stringify(check.equals)}，实际 ${JSON.stringify(actual)}`,
      };
    }

    case 'manifestCoverage': {
      return { ...base, pass: true };
    }
  }
};

/** 把旧的 `acceptance.files` 合成为 fileExists 检查项，保留兼容。 */
const synthesizeFileChecks = (files: string[] | undefined): AcceptanceCheck[] =>
  (files ?? [])
    .filter(Boolean)
    .map((path) => ({
      type: 'fileExists' as const,
      path,
      description: `验收文件存在：${path}`,
    }));

export interface RunVerifyInput {
  acceptanceFiles?: string[];
  acceptanceScript?: string;
  checks?: AcceptanceCheck[];
  manifest: TaskManifest | null;
}

const runAcceptanceScript = async (
  script: string,
): Promise<CheckResult> => {
  const result: CheckResult = {
    id: 'acceptanceScript',
    type: 'contentMatches',
    description: '验收脚本返回 { ok: true }',
    target: 'script',
    pass: false,
  };
  try {
    const { result: raw } = await runScriptInWorker(script);
    const ok =
      typeof raw === 'object' &&
      raw !== null &&
      'ok' in raw &&
      (raw as { ok: boolean }).ok === true;
    return {
      ...result,
      pass: ok,
      reason: ok ? undefined : `脚本未返回 ok:true：${JSON.stringify(raw)}`,
    };
  } catch (error) {
    return {
      ...result,
      pass: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
};

const manifestCoverageCheck: AcceptanceCheck = {
  id: 'manifestCoverage',
  type: 'manifestCoverage',
  description: '交付清单路径全部存在',
};

/**
 * 执行验收：结构化 checks > 合成的 fileExists > manifest 覆盖 > 脚本。
 * 任一类型缺失则跳过；全部缺失且无 manifest/files/script 时报告 fail。
 */
export const runVerify = async (input: RunVerifyInput): Promise<VerifyReport> => {
  const checks: AcceptanceCheck[] = [];
  const explicit = (input.checks ?? []).filter(
    (c) => c && c.type && c.type !== 'manifestCoverage',
  );
  if (explicit.length > 0) checks.push(...explicit);
  else checks.push(...synthesizeFileChecks(input.acceptanceFiles));

  const results: CheckResult[] = [];
  for (const check of checks) {
    results.push(await runAcceptanceCheck(check));
  }

  // manifestCoverage：独立处理，需要 manifest
  const manifest = input.manifest;
  if (manifest) {
    const missing: string[] = [];
    for (const entry of manifest.paths) {
      if (!(await workspace.exists(entry.path))) missing.push(entry.path);
    }
    const minCount = manifestCoverageCheck.minCount ?? 0;
    const countOk = manifest.paths.length >= minCount;
    results.push({
      id: 'manifestCoverage',
      type: 'manifestCoverage',
      description: '交付清单路径全部存在',
      target: 'manifest',
      pass: missing.length === 0 && countOk,
      reason:
        missing.length > 0
          ? `清单路径不存在：${missing.join(', ')}`
          : countOk
            ? undefined
            : `清单条目数 ${manifest.paths.length} 少于 ${minCount}`,
    });
  }

  const scriptRan = Boolean(input.acceptanceScript?.trim());
  if (scriptRan) {
    results.push(await runAcceptanceScript(input.acceptanceScript!.trim()));
  }

  const uncovered = results
    .filter((r) => !r.pass)
    .map((r) => r.reason ?? r.description ?? r.id);

  const verdict: VerifyReport['verdict'] =
    results.length === 0 ? 'unverified' : uncovered.length === 0 ? 'pass' : 'fail';

  const reason =
    verdict === 'pass'
      ? undefined
      : verdict === 'unverified'
        ? '没有可执行的验收检查，不能视为验证通过'
        : `验收未通过：${uncovered.length} 项未满足（${uncovered.join('；')}）`;

  return {
    verdict,
    checks: results,
    uncovered,
    reason,
    runAt: Date.now(),
    manifestPathCount: manifest?.paths.length ?? 0,
    acceptanceFileCount: input.acceptanceFiles?.length ?? 0,
    scriptRan,
  };
};

/** 是否需要再跑一轮：verdict=fail 且非空检查。 */
export const isVerifyFailed = (report: VerifyReport): boolean =>
  report.verdict !== 'pass';
