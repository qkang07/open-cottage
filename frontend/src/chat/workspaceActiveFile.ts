/** 预览区当前打开的文件（用户未 @ 引用时的默认上下文） */
let activeFilePath: string | null = null;

export const setWorkspaceActiveFile = (path: string | null): void => {
  activeFilePath = path?.trim() ? path.replace(/\\/g, '/') : null;
};

export const getWorkspaceActiveFile = (): string | null => activeFilePath;
