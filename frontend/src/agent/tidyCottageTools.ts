import { cottageTool, type CottageTool } from '@/agent/runtime/tool';
import { z } from 'zod';
import { trackMutation } from '../history/autoCheckpoint';
import { workspace } from '../workspace/FileSystemWorkspace';
import { normalizePath } from '../workspace/pathUtils';

export interface TidyToolsOptions {
  /** 改动工作区后的回调（刷新文件树等） */
  onMutate?: () => void | Promise<void>;
}

/** 单次方案允许的最大移动项数（超出应在提示词层面分批） */
const MAX_MOVES_PER_PLAN = 100;
const MAX_MKDIRS_PER_PLAN = 40;

/** 依名称排除的目录段（与隐藏目录规则叠加） */
const EXCLUDED_SEGMENTS = new Set(['node_modules']);

/** 整理禁区：任一路径段为隐藏目录（以 . 开头）或在排除名单中 */
const isExcludedPath = (path: string): boolean =>
  path.split('/').some((seg) => seg.startsWith('.') || EXCLUDED_SEGMENTS.has(seg));

interface MoveItem {
  from: string;
  to: string;
}

interface TidyIssue {
  path: string;
  reason: string;
}

/**
 * 校验整理方案，返回标准化路径与问题清单。
 * 规则：禁区过滤、源存在/目标不存在、不得移入自身子目录、
 * 目标不得重复、禁止链式搬移（A→B 且 B→C）。
 */
const validatePlan = async (
  mkdirs: string[],
  moves: MoveItem[],
): Promise<{
  issues: TidyIssue[];
  cleanMkdirs: string[];
  cleanMoves: MoveItem[];
}> => {
  const issues: TidyIssue[] = [];
  const cleanMkdirs: string[] = [];
  const cleanMoves: MoveItem[] = [];

  for (const raw of mkdirs) {
    const dir = normalizePath(raw);
    if (!dir) {
      issues.push({ path: raw, reason: '目录路径为空' });
      continue;
    }
    if (isExcludedPath(dir)) {
      issues.push({ path: dir, reason: '位于受保护目录（隐藏目录/依赖目录），不可操作' });
      continue;
    }
    if (await workspace.exists(dir)) {
      // 已存在视为无需创建，不算错误
      continue;
    }
    cleanMkdirs.push(dir);
  }

  const seenFrom = new Set<string>();
  const seenTo = new Set<string>();
  for (const raw of moves) {
    const from = normalizePath(raw.from);
    const to = normalizePath(raw.to);
    if (!from || !to) {
      issues.push({ path: raw.from || raw.to, reason: '路径为空' });
      continue;
    }
    if (from === to) continue;
    if (isExcludedPath(from) || isExcludedPath(to)) {
      issues.push({ path: from, reason: '涉及受保护目录（隐藏目录/依赖目录），不可操作' });
      continue;
    }
    if (seenFrom.has(from)) {
      issues.push({ path: from, reason: '方案内重复的源路径' });
      continue;
    }
    if (seenTo.has(to)) {
      issues.push({ path: to, reason: '方案内重复的目标路径' });
      continue;
    }
    seenFrom.add(from);
    seenTo.add(to);
    if (to.startsWith(`${from}/`)) {
      issues.push({ path: to, reason: '不能移动到自身的子目录' });
      continue;
    }
    if (!(await workspace.exists(from))) {
      issues.push({ path: from, reason: '源路径不存在' });
      continue;
    }
    if (await workspace.exists(to)) {
      issues.push({ path: to, reason: '目标路径已存在' });
      continue;
    }
    cleanMoves.push({ from, to });
  }

  // 链式搬移：某项目的恰为另一项源，执行顺序无法安全确定
  for (const move of cleanMoves) {
    if (seenFrom.has(move.to)) {
      issues.push({
        path: move.to,
        reason: '链式搬移（该目标同时是另一项的源），请拆分为多轮方案',
      });
    }
  }

  return { issues, cleanMkdirs, cleanMoves };
};

/**
 * 工作区整理能力包工具：批量落盘「归类/重命名」整理方案。
 * 方案由模型按提示词纪律先行产出并向用户展示、确认；本工具内置
 * 保护区过滤与冲突校验，dryRun 时只做预检不落盘。
 */
export const createTidyCottageTools = (
  options: TidyToolsOptions = {},
): CottageTool[] => {
  return [
    cottageTool(
      async ({ dryRun, mkdirs, moves }) => {
        const dirs = mkdirs ?? [];
        const items = moves ?? [];
        if (!dirs.length && !items.length) {
          return {
            applied: false,
            error: '方案为空：至少提供一项 mkdirs 或 moves。',
          };
        }

        const { issues, cleanMkdirs, cleanMoves } = await validatePlan(dirs, items);
        if (dryRun) {
          return {
            dryRun: true,
            valid: issues.length === 0,
            plannedDirs: cleanMkdirs,
            plannedMoves: cleanMoves,
            issues,
            hint:
              issues.length === 0
                ? '预检通过。请把方案展示给用户并经确认后，再以 dryRun=false 执行。'
                : '预检发现问题，请先修正方案后重新预检。',
          };
        }
        if (issues.length) {
          return {
            applied: false,
            issues,
            hint: '方案存在问题，未执行。请修正后先 dryRun 预检，再向用户确认。',
          };
        }

        const createdDirs: string[] = [];
        const moved: MoveItem[] = [];
        const failed: { from: string; to: string; error: string }[] = [];

        for (const dir of cleanMkdirs) {
          try {
            await workspace.mkdir(dir);
            createdDirs.push(dir);
          } catch (error) {
            failed.push({ from: '', to: dir, error: String(error) });
          }
        }

        // 先移动浅层源，避免深层源的路径前缀先被改变
        const ordered = [...cleanMoves].sort(
          (a, b) => a.from.split('/').length - b.from.split('/').length,
        );
        for (const move of ordered) {
          try {
            await workspace.move(move.from, move.to);
            moved.push(move);
          } catch (error) {
            failed.push({ ...move, error: String(error) });
          }
        }

        const touched = [
          ...createdDirs,
          ...moved.flatMap((m) => [m.from, m.to]),
        ];
        if (touched.length) trackMutation(touched);
        await options.onMutate?.();

        return {
          applied: true,
          createdDirs,
          moved,
          failed,
          hint: failed.length
            ? '部分操作失败，请向用户如实汇报失败项，勿自行重试全部方案。'
            : '整理完成。请向用户汇报移动/重命名清单，并提醒如有失效引用可请求修复。',
        };
      },
      {
        name: 'applyTidyPlan',
        description:
          '批量落盘工作区整理方案：mkdirs 为需新建的目录，moves 为 {from,to} 移动/重命名映射。' +
          'dryRun=true 仅预检（存在性/冲突/保护区）不落盘；dryRun=false 真正执行。' +
          '隐藏目录（以 . 开头）与 node_modules 等受保护目录一律拒绝；目标已存在即失败，不覆盖。' +
          '执行前必须先向用户展示方案并获确认。',
        schema: z.object({
          dryRun: z
            .boolean()
            .optional()
            .describe('true 仅预检不落盘；缺省 false 直接执行'),
          mkdirs: z
            .array(z.string())
            .max(MAX_MKDIRS_PER_PLAN)
            .optional()
            .describe('需新建的目录（相对路径，支持嵌套）'),
          moves: z
            .array(
              z.object({
                from: z.string().describe('源路径（必须存在）'),
                to: z.string().describe('目标路径（必须不存在）'),
              }),
            )
            .max(MAX_MOVES_PER_PLAN)
            .optional()
            .describe('移动/重命名映射列表'),
        }),
      },
    ),
  ];
};
