import type {
  ApplyPatchesInput,
  ColumnPatch,
  LinePatch,
  LinePatchAction,
  RegexPatch,
} from './patchFile';

const LINE_ACTIONS = new Set<LinePatchAction>([
  'replace',
  'delete',
  'insert_before',
  'insert_after',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireArray = (value: unknown, field: string) => {
  if (!Array.isArray(value)) {
    throw new Error(`${field} 必须是数组`);
  }
  return value;
};

const parseLinePatch = (value: unknown, index: number): LinePatch => {
  if (!isRecord(value)) {
    throw new Error(`lines[${index}] 必须是对象`);
  }
  const start = value.start;
  const action = value.action;
  if (typeof start !== 'number') {
    throw new Error(`lines[${index}].start 必须是数字`);
  }
  if (typeof action !== 'string' || !LINE_ACTIONS.has(action as LinePatchAction)) {
    throw new Error(
      `lines[${index}].action 必须是 replace | delete | insert_before | insert_after`,
    );
  }
  const patch: LinePatch = {
    start,
    action: action as LinePatchAction,
  };
  if (value.end !== undefined) {
    if (typeof value.end !== 'number') {
      throw new Error(`lines[${index}].end 必须是数字`);
    }
    patch.end = value.end;
  }
  if (value.content !== undefined) {
    if (typeof value.content !== 'string') {
      throw new Error(`lines[${index}].content 必须是字符串`);
    }
    patch.content = value.content;
  }
  return patch;
};

const parseColumnPatch = (value: unknown, index: number): ColumnPatch => {
  if (!isRecord(value)) {
    throw new Error(`columns[${index}] 必须是对象`);
  }
  const { line, start, content } = value;
  if (typeof line !== 'number') {
    throw new Error(`columns[${index}].line 必须是数字`);
  }
  if (typeof start !== 'number') {
    throw new Error(`columns[${index}].start 必须是数字`);
  }
  if (typeof content !== 'string') {
    throw new Error(`columns[${index}].content 必须是字符串`);
  }
  const patch: ColumnPatch = { line, start, content };
  if (value.end !== undefined) {
    if (typeof value.end !== 'number') {
      throw new Error(`columns[${index}].end 必须是数字`);
    }
    patch.end = value.end;
  }
  return patch;
};

const parseRegexPatch = (value: unknown, index: number): RegexPatch => {
  if (!isRecord(value)) {
    throw new Error(`regex[${index}] 必须是对象`);
  }
  const { pattern, replacement } = value;
  if (typeof pattern !== 'string') {
    throw new Error(`regex[${index}].pattern 必须是字符串`);
  }
  if (typeof replacement !== 'string') {
    throw new Error(`regex[${index}].replacement 必须是字符串`);
  }
  const patch: RegexPatch = { pattern, replacement };
  if (value.flags !== undefined) {
    if (typeof value.flags !== 'string') {
      throw new Error(`regex[${index}].flags 必须是字符串`);
    }
    patch.flags = value.flags;
  }
  if (value.maxReplacements !== undefined) {
    if (typeof value.maxReplacements !== 'number') {
      throw new Error(`regex[${index}].maxReplacements 必须是数字`);
    }
    patch.maxReplacements = value.maxReplacements;
  }
  return patch;
};

export const parsePatchArgs = (args: Record<string, unknown>): {
  path: string;
  patches: ApplyPatchesInput;
} => {
  const path = args.path;
  if (typeof path !== 'string' || !path.trim()) {
    throw new Error('path 必须是字符串');
  }

  const patches: ApplyPatchesInput = {};

  if (args.lines !== undefined) {
    patches.lines = requireArray(args.lines, 'lines').map(parseLinePatch);
  }
  if (args.columns !== undefined) {
    patches.columns = requireArray(args.columns, 'columns').map(parseColumnPatch);
  }
  if (args.regex !== undefined) {
    patches.regex = requireArray(args.regex, 'regex').map(parseRegexPatch);
  }

  return { path: path.trim(), patches };
};
