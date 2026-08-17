import type { Editor, JSONContent } from '@tiptap/core';
import type { ChatFileReference } from '../../../chat/fileReferences';

export type ExtractedEditorMessage = {
  text: string;
  refs: ChatFileReference[];
};

export function extractMessageFromEditor(editor: Editor): ExtractedEditorMessage {
  const refs: ChatFileReference[] = [];
  let text = '';

  const json = editor.getJSON();
  for (const paragraph of json.content ?? []) {
    if (paragraph.type !== 'paragraph') continue;
    for (const child of (paragraph.content ?? []) as JSONContent[]) {
      if (child.type === 'text') {
        text += (child as JSONContent & { text?: string }).text ?? '';
      } else if (child.type === 'fileReference') {
        const attrs = (child as JSONContent & { attrs?: Record<string, unknown> }).attrs;
        const ref: ChatFileReference = {
          id: String(attrs?.id ?? ''),
          path: String(attrs?.path ?? ''),
          entryType: attrs?.entryType === 'directory' ? 'directory' : 'file',
          anchor: (attrs?.anchor as ChatFileReference['anchor']) ?? undefined,
        };
        refs.push(ref);
        text += `{{ref:${ref.id}|${ref.path}}}`;
      } else if (child.type === 'hardBreak') {
        text += '\n';
      }
    }
    text += '\n';
  }

  return { text: text.trimEnd(), refs };
}
