/**
 * 从单条助手消息中提取本次回复改动/生成的文件清单。
 * 完全基于工具调用（section）确定性推导，不依赖模型回复文本：
 * - 文本文件改动工具（writeFile/editFile 等）：从工具参数提取 path；
 * - 生成类工具（office/pdf/图片等）：从工具结果 JSON 提取输出路径；
 * - applyPatch 可能涉及多文件：优先解析结果中的 files 列表。
 */

import type { CottageMessage, CottageSection } from '../agent/messages';
import { extractPartialJsonString } from '../agent/parseStreamingToolArgs';

export type ChangedFileKind = 'created' | 'modified' | 'generated' | 'deleted';

export type ChangedFileReset =
  | { kind: 'delete' }
  | { kind: 'restoreText'; content: string };

export interface MessageChangedFile {
  path: string;
  kind: ChangedFileKind;
  /** 最近一次影响此路径的工具调用，用于区分重置后的新改动。 */
  changeId?: string;
  /** 会话内首次改动前的可恢复基线。 */
  reset?: ChangedFileReset;
}

type CallSection = Extract<CottageSection, { type: 'call' }>;

/** 与 CottageAgent.normalizeToolName 一致：模型可能传 write_file 等变体 */
const normalizeName = (name: string): string =>
  name.toLowerCase().replace(/_/g, '');

/** 直接改动文本文件、目标路径在参数里的工具 */
const ARG_PATH_MUTATING_TOOLS = new Set(
  ['writeFile', 'createFile', 'appendFile', 'patchFile', 'editFile'].map(
    normalizeName,
  ),
);

/** 移动/重命名类工具：改动后的新路径在参数 to 里 */
const ARG_MOVE_TOOLS = new Set(['rename', 'move', 'copy'].map(normalizeName));

/** 删除类工具：目标路径在参数 path 里（旧名兼容历史会话） */
const ARG_DELETE_TOOLS = new Set(
  ['deleteFile', 'deleteEntry'].map(normalizeName),
);

/** 写入/生成文件，产物路径需从工具结果提取的工具 */
const RESULT_WRITE_TOOLS = new Set(
  [
    'applyPatch',
    'writeWord',
    'writePresentation',
    'writeSpreadsheet',
    'renderOfficeTemplate',
    'batchGenerateOfficeDocs',
    'createPdf',
    'createPdfFromHtml',
    'mergePdfs',
    'splitPdf',
    'renderMermaid',
    'generateImage',
    'editImage',
    'saveChatAttachment',
    'compress',
  ].map(normalizeName),
);

const looksLikePath = (value: string): boolean => {
  const path = value.trim();
  if (!path || /\s/.test(path)) return false;
  return !/^https?:\/\//i.test(path);
};

/** 从调用参数提取目标路径；参数仍在流式生成时做部分提取 */
const parseArgsPath = (section: CallSection): string | undefined =>
  parseArgsField(section, 'path') ??
  parseArgsField(section, 'filePath') ??
  parseArgsField(section, 'filepath') ??
  parseArgsField(section, 'targetPath');

/** 从调用参数提取指定字段的路径值（兼容流式部分提取） */
function parseArgsField(
  section: CallSection,
  field: string,
): string | undefined {
  try {
    const parsed = JSON.parse(section.arguments) as Record<string, unknown>;
    const raw = parsed[field];
    if (typeof raw === 'string' && looksLikePath(raw)) return raw.trim();
  } catch {
    // 参数 JSON 尚不完整，落到部分提取
  }
  const fragment = extractPartialJsonString(section.arguments, field);
  return fragment && looksLikePath(fragment) ? fragment.trim() : undefined;
}

/** 参数数组类工具（deleteFiles）提取路径列表；兼容 paths 为单个字符串 */
function parseArgsPathList(section: CallSection, field: string): string[] {
  try {
    const parsed = JSON.parse(section.arguments) as Record<string, unknown>;
    const raw = parsed[field];
    if (typeof raw === 'string') {
      return looksLikePath(raw) ? [raw.trim()] : [];
    }
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (item): item is string =>
        typeof item === 'string' && looksLikePath(item),
    );
  } catch {
    return [];
  }
}

/** 已有结果但非正常 JSON 对象：调用失败/被阻断，不计入变更 */
const hasFailedResult = (section: CallSection): boolean => {
  if (section.result === undefined) return false;
  const parsed = parseJsonSafe(section.result);
  return !parsed || typeof parsed !== 'object' || Array.isArray(parsed);
};

const parseJsonSafe = (raw: string | undefined): unknown => {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
};

interface ResultPathEntry {
  path: string;
  created?: boolean;
  deleted?: boolean;
}

/** 从工具结果对象中收集产物路径（兼容各写工具的返回结构） */
const collectResultPaths = (
  value: unknown,
  out: ResultPathEntry[],
): void => {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectResultPaths(item, out);
    return;
  }
  const rec = value as Record<string, unknown>;
  if (typeof rec.outputPath === 'string' && looksLikePath(rec.outputPath)) {
    out.push({ path: rec.outputPath.trim(), created: true });
  }
  const savedTo = rec.savedTo;
  if (typeof savedTo === 'string') {
    if (looksLikePath(savedTo)) out.push({ path: savedTo.trim(), created: true });
  } else if (Array.isArray(savedTo)) {
    for (const item of savedTo) {
      if (typeof item === 'string' && looksLikePath(item)) {
        out.push({ path: item.trim(), created: true });
      }
    }
  }
  // applyPatch：{ files: [{ path, written?, created?, deleted? }] }
  if (Array.isArray(rec.files)) {
    for (const item of rec.files) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      if (typeof row.path !== 'string' || !looksLikePath(row.path)) continue;
      out.push({
        path: row.path.trim(),
        created: Boolean(row.created),
        deleted: Boolean(row.deleted),
      });
    }
  }
  // 嵌套结构：splitPdf 的 outputs / batchGenerateOfficeDocs 的 generated
  if (Array.isArray(rec.outputs)) collectResultPaths(rec.outputs, out);
  if (Array.isArray(rec.generated)) collectResultPaths(rec.generated, out);
  // office / 表格写入：{ path, written: true }
  if (
    rec.written === true &&
    typeof rec.path === 'string' &&
    looksLikePath(rec.path)
  ) {
    out.push({ path: rec.path.trim() });
  }
};

/**
 * 提取一条消息内所有被改动/生成的文件（按出现顺序去重）。
 * 同一文件多次出现时保留首次类别，但后续的「删除」会覆盖之前类别。
 */
export const collectMessageChangedFiles = (
  message: CottageMessage,
  options?: { includeResetState?: boolean },
): MessageChangedFile[] => {
  if (message.role !== 'assistant') return [];
  const seen = new Map<string, MessageChangedFile>();
  const push = (
    path: string,
    kind: ChangedFileKind,
    section: CallSection,
  ) => {
    if (!looksLikePath(path)) return;
    const reset: ChangedFileReset | undefined =
      section.created === true || kind === 'created'
        ? { kind: 'delete' }
        : section.before !== undefined
          ? { kind: 'restoreText', content: section.before }
          : undefined;
    const existing = seen.get(path);
    if (!existing) {
      seen.set(
        path,
        options?.includeResetState
          ? { path, kind, changeId: section.id, reset }
          : { path, kind },
      );
      return;
    }
    if (options?.includeResetState) existing.changeId = section.id;
    if (kind === 'deleted') existing.kind = 'deleted';
  };

  for (const section of message.sections) {
    if (section.type !== 'call') continue;
    // 文件树的可重置状态只接收已结束的调用，避免与运行中写入竞争。
    // 消息卡片的普通改动列表仍保留原有的流式预览行为。
    if (options?.includeResetState && section.result === undefined) continue;
    const name = normalizeName(section.name);

    if (ARG_PATH_MUTATING_TOOLS.has(name)) {
      // 失败/被阻断的调用不算变更：已有结果时必须是正常 JSON 对象
      // （运行中 result 为 undefined，仍按参数提前展示）
      if (hasFailedResult(section)) continue;
      const path = parseArgsPath(section);
      if (!path) continue;
      const created =
        name === normalizeName('createFile') || section.created === true;
      push(path, created ? 'created' : 'modified', section);
      continue;
    }

    if (ARG_MOVE_TOOLS.has(name)) {
      if (hasFailedResult(section)) continue;
      const to = parseArgsField(section, 'to');
      if (!to) continue;
      // copy 产生新副本；rename/move 视为原文件位置变化
      push(to, name === normalizeName('copy') ? 'created' : 'modified', section);
      continue;
    }

    if (name === normalizeName('copyPaths')) {
      if (hasFailedResult(section)) continue;
      try {
        const parsed = JSON.parse(section.arguments) as {
          items?: { from?: string; to?: string }[];
        };
        for (const item of parsed.items ?? []) {
          if (typeof item?.to === 'string' && looksLikePath(item.to)) {
            push(item.to.trim(), 'created', section);
          }
        }
      } catch {
        // 参数尚不完整，跳过
      }
      continue;
    }

    if (ARG_DELETE_TOOLS.has(name)) {
      if (hasFailedResult(section)) continue;
      const path = parseArgsField(section, 'path');
      if (path) push(path, 'deleted', section);
      continue;
    }

    if (
      name === normalizeName('deleteFiles') ||
      name === normalizeName('deletePaths') // 旧名兼容历史会话
    ) {
      if (hasFailedResult(section)) continue;
      for (const path of parseArgsPathList(section, 'paths')) {
        push(path, 'deleted', section);
      }
      continue;
    }

    if (!RESULT_WRITE_TOOLS.has(name)) continue;
    const entries: ResultPathEntry[] = [];
    collectResultPaths(parseJsonSafe(section.result), entries);
    if (!entries.length) {
      // 执行中（尚无结果）的 applyPatch 先展示参数中的目标文件；已有结果但解析不出路径则视为失败，不计入
      if (
        name === normalizeName('applyPatch') &&
        section.result === undefined
      ) {
        const path = parseArgsPath(section);
        if (path) push(path, 'modified', section);
      }
      continue;
    }
    for (const entry of entries) {
      const kind: ChangedFileKind = entry.deleted
        ? 'deleted'
        : name === normalizeName('applyPatch')
          ? entry.created
            ? 'created'
            : 'modified'
          : 'generated';
      push(entry.path, kind, section);
    }
  }

  return [...seen.values()];
};
