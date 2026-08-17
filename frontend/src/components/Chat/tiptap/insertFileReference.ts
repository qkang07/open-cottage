import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { formatReferenceLabel, type ChatFileReference } from '../../../chat/fileReferences';

export type FileReferenceInsertAttrs = {
  id: string;
  path: string;
  entryType?: 'file' | 'directory';
  anchor?: ChatFileReference['anchor'] | null;
  label?: string;
};

type TextRange = { from: number; to: number };

/** 在文档纯文本中查找 search 的出现范围（可跨 text node）。 */
export function findDocumentTextRange(
  doc: ProseMirrorNode,
  search: string,
  preferNear?: number,
): TextRange | null {
  if (!search) return null;

  let text = '';
  const posAt: number[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    for (let i = 0; i < node.text.length; i++) {
      posAt.push(pos + i);
      text += node.text[i]!;
    }
  });

  const matches: TextRange[] = [];
  let fromIndex = 0;
  while (fromIndex <= text.length - search.length) {
    const index = text.indexOf(search, fromIndex);
    if (index < 0) break;
    const from = posAt[index];
    const last = posAt[index + search.length - 1];
    if (from != null && last != null) {
      matches.push({ from, to: last + 1 });
    }
    fromIndex = index + 1;
  }
  if (!matches.length) return null;
  if (preferNear == null) return matches[0]!;

  let best = matches[0]!;
  let bestDist = Math.min(
    Math.abs(best.from - preferNear),
    Math.abs(best.to - preferNear),
  );
  for (let i = 1; i < matches.length; i++) {
    const m = matches[i]!;
    const dist = Math.min(
      Math.abs(m.from - preferNear),
      Math.abs(m.to - preferNear),
    );
    if (dist < bestDist) {
      best = m;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * 插入文件引用胶囊。若编辑器里已有相同路径纯文本（或 `@路径`），则整段替换为胶囊，
 * 避免出现「路径文字夹着胶囊」的残留。
 */
export function insertFileReferenceNode(
  editor: Editor,
  attrs: FileReferenceInsertAttrs,
  opts?: { at?: number; fallback?: 'selection' | 'end' },
): boolean {
  const path = attrs.path.trim();
  if (!path) return false;

  const preferNear = opts?.at ?? editor.state.selection.from;
  const pathRange =
    findDocumentTextRange(editor.state.doc, `@${path}`, preferNear) ??
    findDocumentTextRange(editor.state.doc, path, preferNear);

  const label =
    attrs.label ??
    formatReferenceLabel({
      id: attrs.id,
      path,
      entryType: attrs.entryType,
      anchor: attrs.anchor ?? undefined,
    });

  const content = {
    type: 'fileReference' as const,
    attrs: {
      id: attrs.id,
      path,
      label,
      entryType: attrs.entryType ?? 'file',
      anchor: attrs.anchor ?? null,
    },
  };

  if (pathRange) {
    return editor
      .chain()
      .focus()
      .insertContentAt({ from: pathRange.from, to: pathRange.to }, content)
      .run();
  }

  if (opts?.at != null) {
    return editor.chain().focus().insertContentAt(opts.at, content).run();
  }

  if (opts?.fallback === 'end') {
    return editor.chain().focus('end').insertContent(content).run();
  }

  return editor.chain().focus().insertContent(content).run();
}
