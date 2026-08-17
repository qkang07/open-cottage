/** 在工作空间内生成不冲突的相对路径 */
export const uniqueEntryPath = (
  existingFiles: readonly string[],
  dir: string,
  baseName: string,
  extension = '',
): string => {
  const normalizedDir = dir.replace(/\\/g, '/').replace(/\/+$/, '');
  const prefix = normalizedDir ? `${normalizedDir}/` : '';
  const ext = extension.startsWith('.') ? extension : extension ? `.${extension}` : '';

  for (let n = 0; n < 1000; n += 1) {
    const stem = n === 0 ? baseName : `${baseName}-${n}`;
    const candidate = `${prefix}${stem}${ext}`;
    if (!existingFiles.includes(candidate)) {
      return candidate;
    }
  }
  return `${prefix}${baseName}${ext}`;
};

export const parentDirOf = (path: string): string => {
  const normalized = path.replace(/\\/g, '/');
  if (!normalized.includes('/')) return '';
  return normalized.split('/').slice(0, -1).join('/');
};

export const basenameOf = (path: string): string => {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = normalized.split('/');
  return parts[parts.length - 1] ?? normalized;
};

/** 在目录下拼接新名称（名称不得含 /） */
export const joinPathInDir = (dir: string, name: string): string => {
  const trimmed = name.trim().replace(/\\/g, '/');
  if (!trimmed) throw new Error('名称不能为空');
  if (trimmed.includes('/')) {
    throw new Error('名称不能包含 /');
  }
  const parent = dir.replace(/\\/g, '/').replace(/\/+$/, '');
  return parent ? `${parent}/${trimmed}` : trimmed;
};

export const defaultNewTextFilePath = (
  existingFiles: readonly string[],
  contextDir: string,
): string =>
  uniqueEntryPath(existingFiles, contextDir, 'untitled', '.txt');

export const defaultNewFolderPath = (
  existingFiles: readonly string[],
  contextDir: string,
): string =>
  uniqueEntryPath(existingFiles, contextDir, 'new-folder', '');
