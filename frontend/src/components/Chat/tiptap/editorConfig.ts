import StarterKit from '@tiptap/starter-kit';
import { FileReferenceNode } from './FileReferenceNode';
import type { Extensions } from '@tiptap/core';

export const createChatEditorExtensions = (): Extensions => [
  StarterKit.configure({
    heading: false,
    bold: false,
    italic: false,
    strike: false,
    code: false,
    blockquote: false,
    bulletList: false,
    orderedList: false,
    listItem: false,
    codeBlock: false,
    horizontalRule: false,
    dropcursor: false,
    gapcursor: false,
  }),
  FileReferenceNode,
];
