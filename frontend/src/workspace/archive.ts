import { joinPath, normalizePath } from './pathUtils';
import { createStoreZip, parseStoreZip } from './zipStore';

export const buildZipBlob = async (
  entries: { path: string; data: Uint8Array }[],
): Promise<Blob> => {
  const bytes = createStoreZip(entries);
  return new Blob([bytes], { type: 'application/zip' });
};

export const parseZipEntries = async (
  data: ArrayBuffer,
): Promise<{ path: string; data: Uint8Array; isDirectory: boolean }[]> => {
  return parseStoreZip(data).map((entry) => ({
    path: normalizePath(entry.path),
    data: entry.data,
    isDirectory: entry.isDirectory,
  }));
};

export const resolveExtractTarget = (entryPath: string, targetDir: string) =>
  joinPath(targetDir, entryPath);
