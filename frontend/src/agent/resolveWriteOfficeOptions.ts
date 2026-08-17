import type {
  ChatFileReference,
  PresentationAnchor,
  WordAnchor,
} from '../chat/fileReferences';
import { getWorkspaceActiveFile } from '../chat/workspaceActiveFile';
import {
  detectOfficeKind,
  type DocumentWriteContent,
  type PatchOfficeTarget,
} from './officeDocuments';
import {
  toolWritePresentationInputSchema,
  toolWriteWordInputSchema,
} from './officeWriteSchema';
import type { z } from 'zod';

export type WriteWordToolInput = z.infer<typeof toolWriteWordInputSchema>;
export type WritePresentationToolInput = z.infer<
  typeof toolWritePresentationInputSchema
>;

const pathsEqual = (a: string, b: string): boolean =>
  a.replace(/\\/g, '/') === b.replace(/\\/g, '/');

const findWordRef = (
  path: string,
  refs: readonly ChatFileReference[],
): WordAnchor | undefined => {
  for (const ref of refs) {
    if (!pathsEqual(ref.path, path)) continue;
    if (ref.anchor?.kind === 'word') return ref.anchor;
  }
  return undefined;
};

const findPresentationRef = (
  path: string,
  refs: readonly ChatFileReference[],
): PresentationAnchor | undefined => {
  for (const ref of refs) {
    if (!pathsEqual(ref.path, path)) continue;
    if (ref.anchor?.kind === 'presentation') return ref.anchor;
  }
  return undefined;
};

const normalizePathWithFallback = (
  inputPath: string,
  refs: readonly ChatFileReference[],
): string => {
  const activeFile = getWorkspaceActiveFile();
  return inputPath.trim() || activeFile || refs[0]?.path || '';
};

export const resolveWriteWordOptions = (
  input: WriteWordToolInput,
  refs: readonly ChatFileReference[],
): {
  path: string;
  mode: 'replace' | 'patch';
  target?: PatchOfficeTarget;
  content: DocumentWriteContent;
} => {
  const path = normalizePathWithFallback(input.path, refs);
  if (!path) throw new Error('请指定 Word 文件路径，或先在预览区打开目标文件');
  if (detectOfficeKind(path) !== 'word') {
    throw new Error('writeWord 仅支持 .docx');
  }

  const refAnchor = findWordRef(path, refs);
  const mode = input.mode ?? (refAnchor ? 'patch' : 'replace');
  const target = { ...input.target } as PatchOfficeTarget;
  if (mode === 'patch' && !target.wordRange && refAnchor) {
    target.wordRange = {
      startParagraph: refAnchor.startParagraph,
      endParagraph: refAnchor.endParagraph,
    };
  }
  return {
    path,
    mode,
    target,
    content: input.content as DocumentWriteContent,
  };
};

export const resolveWritePresentationOptions = (
  input: WritePresentationToolInput,
  refs: readonly ChatFileReference[],
): {
  path: string;
  mode: 'replace' | 'patch';
  target?: PatchOfficeTarget;
  content: DocumentWriteContent;
} => {
  const path = normalizePathWithFallback(input.path, refs);
  if (!path) throw new Error('请指定 PPT 文件路径，或先在预览区打开目标文件');
  if (detectOfficeKind(path) !== 'presentation') {
    throw new Error('writePresentation 仅支持 .pptx');
  }

  const refAnchor = findPresentationRef(path, refs);
  const mode = input.mode ?? (refAnchor ? 'patch' : 'replace');
  const target = { ...input.target } as PatchOfficeTarget;
  if (mode === 'patch' && !target.presentationTarget && refAnchor) {
    target.presentationTarget = { slideIndex: refAnchor.slideIndex };
  }
  return {
    path,
    mode,
    target,
    content: input.content as DocumentWriteContent,
  };
};
