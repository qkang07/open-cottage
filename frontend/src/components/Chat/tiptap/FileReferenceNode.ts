import { Node, mergeAttributes, type NodeViewProps } from '@tiptap/core';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import type { Component } from 'vue';
import FileReferenceChip from './FileReferenceChip.vue';

export const FileReferenceNode = Node.create({
  name: 'fileReference',

  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      id: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-id') ?? '',
        renderHTML: (attributes) => {
          if (!attributes.id) return {};
          return { 'data-id': attributes.id };
        },
      },
      path: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-path') ?? '',
        renderHTML: (attributes) => {
          if (!attributes.path) return {};
          return { 'data-path': attributes.path };
        },
      },
      label: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-label') ?? '',
        renderHTML: (attributes) => {
          if (!attributes.label) return {};
          return { 'data-label': attributes.label };
        },
      },
      entryType: {
        default: 'file',
        parseHTML: (element) => element.getAttribute('data-entry-type') ?? 'file',
        renderHTML: (attributes) => {
          const entryType =
            attributes.entryType === 'directory' ? 'directory' : 'file';
          return { 'data-entry-type': entryType };
        },
      },
      anchor: {
        default: null,
        parseHTML: (element) => {
          const raw = element.getAttribute('data-anchor');
          if (!raw) return null;
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        },
        renderHTML: (attributes) => {
          if (!attributes.anchor) return {};
          return { 'data-anchor': JSON.stringify(attributes.anchor) };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="file-reference"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(
        { 'data-type': 'file-reference' },
        HTMLAttributes,
      ),
    ];
  },

  renderText() {
    return '';
  },

  addNodeView() {
    // *.vue shim 无法携带 NodeViewProps，需断言以匹配 VueNodeViewRenderer 签名
    return VueNodeViewRenderer(FileReferenceChip as Component<NodeViewProps>);
  },
});
