import type { ToolInvocationSource } from '../agent/toolInvocation';
import { toolRisk } from '../agent/toolDescriptions';
import { toolNameIn } from '../agent/toolNames';
import type { CapabilityRiskLevel } from '../platform/capabilities';
import { normalizePath } from '../workspace/pathUtils';
import { workspace } from '../workspace/FileSystemWorkspace';
import { capturePlanStepPaths } from './checkpoints';
import type { PlanDefinition, PlanRun, ToolMutationReport } from './types';
import {
  workspaceWriteCoordinator,
  type WorkspaceWriteLease,
} from './workspaceLock';

export interface PlanGuardInput {
  toolName: string;
  args: unknown;
  source: ToolInvocationSource;
}

export interface PlanGuardVerdict {
  allowed: boolean;
  reason?: string;
  paths: string[];
  risk: CapabilityRiskLevel | 'control';
  lease?: WorkspaceWriteLease;
  mutationScopePrefixes?: string[];
  planId?: string;
  stepId?: string;
}

export interface PlanToolGuard {
  check(input: PlanGuardInput): PlanGuardVerdict;
  block(verdict: PlanGuardVerdict): Promise<void>;
  beforeExecute(verdict: PlanGuardVerdict): Promise<void>;
  afterExecute(
    verdict: PlanGuardVerdict,
    succeeded: boolean,
    report?: ToolMutationReport,
  ): Promise<void>;
}

export interface CreatePlanToolGuardOptions {
  getContext: () => { definition: PlanDefinition; run: PlanRun } | null;
  onBlocked: (reason: string) => void | Promise<void>;
  onMutation: (
    report: ToolMutationReport,
    risk: CapabilityRiskLevel | 'control',
    predictedPaths: string[],
  ) => void | Promise<void>;
  /** 记录已经实际发起的外部调用；审批拒绝和范围预检失败不计入预算。 */
  onExternalCall: (succeeded: boolean) => void | Promise<void>;
}

const CONTROL_TOOLS = new Set([
  'askUser',
  'loadTools',
  'submitPlan',
  'completePlanStep',
  'blockPlanStep',
  'requestPlanRevision',
  'completePlanRun',
  'failPlanRun',
  'dispatchPlanResearch',
]);

const PATH_KEYS = new Set([
  'path',
  'paths',
  'from',
  'to',
  'targetPath',
  'outputPath',
  'targetDir',
  'outputDir',
  'outputPrefix',
  'archivePath',
  'filePath',
  'files',
]);

const collectPathValues = (value: unknown, key?: string, out = new Set<string>()) => {
  if (typeof value === 'string') {
    if (key && PATH_KEYS.has(key) && value.trim()) out.add(value.trim());
    if (key === 'patch' || key === 'diff') {
      for (const match of value.matchAll(/^(?:\+\+\+|---)\s+(?:[ab]\/)?([^\r\n]+)$/gm)) {
        if (match[1] && match[1] !== '/dev/null') out.add(match[1].trim());
      }
    }
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPathValues(item, key, out);
    return out;
  }
  if (!value || typeof value !== 'object') return out;
  for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
    collectPathValues(child, childKey, out);
  }
  return out;
};

const collectMutationPaths = (
  toolName: string,
  args: Record<string, unknown>,
): Set<string> => {
  const out = new Set<string>();
  if (toolName === 'copy') {
    collectPathValues(args.to, 'to', out);
    return out;
  }
  if (toolName === 'copyPaths' && Array.isArray(args.items)) {
    for (const item of args.items) {
      if (item && typeof item === 'object') {
        collectPathValues((item as Record<string, unknown>).to, 'to', out);
      }
    }
    return out;
  }
  if (toolName === 'compress') {
    collectPathValues(args.outputPath, 'outputPath', out);
    return out;
  }
  if (toolName === 'extract') {
    collectPathValues(args.targetDir, 'targetDir', out);
    return out;
  }
  if (['writeSpreadsheet', 'writeWord', 'writePresentation'].includes(toolName)) {
    collectPathValues(args.path, 'path', out);
    return out;
  }
  if (toolName === 'renderOfficeTemplate') {
    collectPathValues(args.outputPath, 'outputPath', out);
    return out;
  }
  if (toolName === 'batchGenerateOfficeDocs') {
    collectPathValues(args.outputDir, 'outputDir', out);
    return out;
  }
  if (['generateImage', 'editImage'].includes(toolName)) {
    collectPathValues(args.outputDir, 'outputDir', out);
    return out;
  }
  if (toolName === 'mergePdfs') {
    collectPathValues(args.outputPath, 'outputPath', out);
    return out;
  }
  return collectPathValues(args, undefined, out);
};

const normalizeCandidate = (value: string): string | null => {
  const raw = value.replace(/\\/g, '/').trim();
  if (!raw || raw.startsWith('/') || /^[a-zA-Z]:\//.test(raw)) return null;
  if (raw.split('/').some((part) => part === '..')) return null;
  const normalized = normalizePath(raw).replace(/\/$/, '');
  if (!normalized || normalized === '.cottage' || normalized.startsWith('.cottage/')) return null;
  return normalized;
};

const pathWithin = (path: string, prefixes: readonly string[]) => {
  const candidate = path.toLowerCase();
  return prefixes.some((prefix) => {
    const root = prefix.toLowerCase();
    return candidate === root || candidate.startsWith(`${root}/`);
  });
};

const reportPaths = (report: ToolMutationReport) => [
  ...report.created.map((entry) => entry.path),
  ...report.modified.map((entry) => entry.path),
  ...report.deleted.map((entry) => entry.path),
  ...report.moved.flatMap((entry) => [entry.from.path, entry.to.path]),
];

const resolveExistingAncestor = async (path: string): Promise<string[] | null> => {
  const root = workspace.rootHandle;
  if (!root) return null;
  const parts = path.split('/').filter(Boolean);
  let current: FileSystemDirectoryHandle = root;
  let resolved: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!;
    try {
      if (index === parts.length - 1) {
        let handle: FileSystemHandle;
        try {
          handle = await current.getDirectoryHandle(part);
        } catch {
          handle = await current.getFileHandle(part);
        }
        return (await root.resolve(handle)) ?? null;
      }
      current = await current.getDirectoryHandle(part);
      resolved = (await root.resolve(current)) ?? [];
    } catch {
      return [...resolved, ...parts.slice(index)];
    }
  }
  return resolved;
};

export const createPlanToolGuard = (
  options: CreatePlanToolGuardOptions,
): PlanToolGuard => {
  return {
    check(input) {
      // 控制类工具归一化匹配，避免 snake_case / 大小写变体绕过豁免
      if (toolNameIn(CONTROL_TOOLS, input.toolName)) {
        return { allowed: true, paths: [], risk: 'control' };
      }
      const risk = input.toolName.startsWith('mcp__')
        ? 'external'
        : toolRisk(input.toolName) ?? 'external';
      // 草拟阶段允许只读探索；外部读取仍由 PolicyGate 单独确认。
      if (risk === 'read') {
        return { allowed: true, paths: [], risk };
      }
      const context = options.getContext();
      const rawPaths = [
        ...collectMutationPaths(
          input.toolName,
          input.args && typeof input.args === 'object'
            ? (input.args as Record<string, unknown>)
            : {},
        ),
      ];
      const paths = rawPaths.map(normalizeCandidate).filter((path): path is string => Boolean(path));
      if (rawPaths.length !== paths.length) {
        const reason = '工具参数包含绝对路径、路径穿越或内部 .cottage 路径';
        return { allowed: false, reason, paths, risk };
      }
      if (risk === 'external') {
        if (
          context?.run.status === 'running' &&
          context.run.counters.externalCalls >= context.definition.budgets.maxExternalCalls
        ) {
          const reason = `外部调用次数达到预算 ${context.definition.budgets.maxExternalCalls}`;
          return { allowed: false, reason, paths: [], risk };
        }
        if (paths.length === 0) return { allowed: true, paths: [], risk };
      }
      if (!context || context.run.status !== 'running') {
        const reason = '计划尚未批准或当前未处于执行状态';
        return { allowed: false, reason, paths: [], risk: 'control' };
      }
      if (context.run.approvedRevision !== context.definition.revision) {
        const reason =
          `执行版本不一致：已批准 revision ${context.run.approvedRevision}，` +
          `当前定义为 revision ${context.definition.revision}`;
        return { allowed: false, reason, paths, risk };
      }
      const activeStep = context.definition.steps.find(
        (step) => step.id === context.run.currentStepId,
      );
      if (activeStep?.kind === 'research') {
        const reason = `只读研究步骤「${activeStep.title}」不能执行写入`;
        return { allowed: false, reason, paths, risk };
      }
      if (input.toolName === 'runScript' && paths.length === 0) {
        return { allowed: true, paths: [], risk };
      }
      if (paths.length === 0) {
        const reason = `无法确定写工具 ${input.toolName} 的目标路径`;
        return { allowed: false, reason, paths, risk };
      }
      const prefixes = activeStep?.allowedPathPrefixes?.length
        ? activeStep.allowedPathPrefixes
        : context.definition.allowedPathPrefixes;
      const outside = paths.find((path) => !pathWithin(path, prefixes));
      if (outside) {
        const reason = `路径超出已批准范围：${outside}`;
        return { allowed: false, reason, paths, risk };
      }
      const unique = new Set([...context.run.changedFiles, ...paths]);
      if (unique.size > context.definition.budgets.maxChangedFiles) {
        const reason = `预计修改文件数超过预算 ${context.definition.budgets.maxChangedFiles}`;
        return { allowed: false, reason, paths, risk };
      }
      return {
        allowed: true,
        paths: [...new Set(paths)],
        risk,
        mutationScopePrefixes: [...prefixes],
        planId: context.definition.id,
        stepId: activeStep?.id,
      };
    },
    async block(verdict) {
      if (!verdict.allowed) {
        await options.onBlocked(verdict.reason ?? '该操作未被批准');
      }
    },
    async beforeExecute(verdict) {
      if (!verdict.allowed || verdict.risk === 'read' || verdict.risk === 'control' || verdict.paths.length === 0) return;
      const context = options.getContext();
      const stepId = context?.run.currentStepId;
      if (typeof navigator === 'undefined' || !('locks' in navigator)) {
        const reason = '当前浏览器不支持 Web Locks；Plan 自动写入已暂停，请改为逐次人工授权';
        await options.onBlocked(reason);
        throw new Error(reason);
      }
      if (!context || !stepId) throw new Error('计划没有当前执行步骤');
      const lease = await workspaceWriteCoordinator.acquire(
        context.definition.workspaceId,
        context.definition.id,
      );
      if (!lease) {
        const reason = '另一个计划正在写入当前工作区，本计划已在写入前暂停';
        await options.onBlocked(reason);
        throw new Error(reason);
      }
      verdict.lease = lease;
      for (const path of verdict.paths) {
        const resolved = await resolveExistingAncestor(path);
        if (!resolved || resolved.join('/').toLowerCase() !== path.toLowerCase()) {
          const reason = `路径无法确认位于当前工作区：${path}`;
          await options.onBlocked(reason);
          lease.release();
          verdict.lease = undefined;
          throw new Error(reason);
        }
      }
      try {
        await capturePlanStepPaths(context.definition.id, stepId, verdict.paths);
      } catch (error) {
        lease.release();
        verdict.lease = undefined;
        throw error;
      }
    },
    async afterExecute(verdict, succeeded, report) {
      if (verdict.risk === 'read' || verdict.risk === 'control') return;
      try {
        if (verdict.risk === 'external') {
          await options.onExternalCall(succeeded);
        }
        const hasMutation = Boolean(
          report &&
            (report.created.length ||
              report.modified.length ||
              report.deleted.length ||
              report.moved.length),
        );
        if (report && hasMutation) {
          await options.onMutation(report, verdict.risk, verdict.paths);
        }
        const unexpected = report && verdict.paths.length
          ? reportPaths(report).find((actual) =>
              !verdict.paths.some((predicted) =>
                pathWithin(actual, [predicted]) || pathWithin(predicted, [actual]),
              ),
            )
          : undefined;
        if (unexpected) {
          await options.onBlocked(`实际变更超出工具参数预检范围：${unexpected}`);
          throw new Error(`实际变更与预检不一致：${unexpected}`);
        }
        if (!succeeded && hasMutation) {
          await options.onBlocked('工具失败前已产生部分工作区变更；现场已保留并暂停');
        }
      } catch (error) {
        await options.onBlocked(
          `工具已返回但计划状态持久化失败：${error instanceof Error ? error.message : String(error)}`,
        );
        throw error;
      } finally {
        verdict.lease?.release();
        verdict.lease = undefined;
      }
    },
  };
};
