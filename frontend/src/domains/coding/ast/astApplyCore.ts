import { diffLines } from './diff';
import type { AstEditResult, AstOperation, AstOps } from './types';

export interface AstApplyOutcome {
  output: string;
  applied: number;
  diff: string;
  notes: string[];
}

export const applyAstOperations = (
  ops: AstOps,
  content: string,
  operations: AstOperation[],
): AstApplyOutcome => {
  let current = content;
  let applied = 0;
  const notes: string[] = [];

  for (const op of operations) {
    let r: AstEditResult;
    switch (op.kind) {
      case 'renameSymbol':
        r = ops.renameSymbol(current, op.selector, op.newName);
        break;
      case 'addImport':
        r = ops.addImport(current, op.spec);
        break;
      case 'removeImport':
        r = ops.removeImport(current, op.spec);
        break;
      case 'insertStatement':
        r = ops.insertStatement(current, op.anchor, op.code);
        break;
      case 'replacePropDefault':
        r = ops.replacePropDefault(current, op.spec);
        break;
      default:
        r = {
          output: current,
          diff: '',
          applied: 0,
          note: `未知操作：${(op as { kind: string }).kind}`,
        };
    }
    if (r.applied > 0) {
      current = r.output;
      applied += r.applied;
    }
    if (r.note) notes.push(`${op.kind}: ${r.note}`);
  }

  return {
    output: current,
    applied,
    diff: diffLines(content, current),
    notes,
  };
};
