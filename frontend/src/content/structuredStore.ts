import { workspace } from '../workspace/FileSystemWorkspace';
import type { ContentRef } from './types';
import { contentCacheKey } from './contentRegistry';

const STRUCTURED_DIR = 'structured';
const EXTRACT_DIR = 'extract';

export const structuredPathFor = (path: string): string =>
  `${STRUCTURED_DIR}/${contentCacheKey(path)}.json`;

export const extractedTextPathFor = (path: string): string =>
  `${EXTRACT_DIR}/${contentCacheKey(path)}.txt`;

export const saveStructuredContent = async (
  sourcePath: string,
  structured: unknown,
  extractedText?: string,
): Promise<Pick<ContentRef, 'structuredPath' | 'extractedTextPath'>> => {
  const structuredPath = structuredPathFor(sourcePath);
  await workspace.writeCottagePath(structuredPath, structured);

  let extractedTextPath: string | undefined;
  if (extractedText !== undefined) {
    extractedTextPath = extractedTextPathFor(sourcePath);
    await workspace.writeCottageText(extractedTextPath, extractedText);
  }
  return { structuredPath, extractedTextPath };
};

export const loadStructuredContent = async <T>(
  sourcePath: string,
): Promise<T | null> => workspace.readCottagePath<T>(structuredPathFor(sourcePath));
