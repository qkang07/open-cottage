/**
 * 工作区搜索筛选：文件类型、尺寸、glob 等
 */

import { matchesAnyGlob } from './search';

export interface FileSearchFilters {
  /** 包含 glob，如 **\/*.ts */
  include?: string[];
  /** 排除 glob */
  exclude?: string[];
  /** 扩展名（不含点），如 ts、vue */
  extensions?: string[];
  /** 最小字节数 */
  minSizeBytes?: number;
  /** 最大字节数 */
  maxSizeBytes?: number;
}

export interface FileStat {
  size: number;
  modified: number;
}

const SIZE_UNITS: Record<string, number> = {
  b: 1,
  kb: 1024,
  mb: 1024 ** 2,
  gb: 1024 ** 3,
  tb: 1024 ** 4,
};

/** 解析用户输入的尺寸，如 1KB、10 MB、2048 */
export function parseSizeInput(input: string): number | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?$/i);
  if (!match) return undefined;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 0) return undefined;
  const unit = (match[2] ?? 'b').toLowerCase();
  return Math.round(value * (SIZE_UNITS[unit] ?? 1));
}

export function getPathExtension(path: string): string {
  const base = path.split('/').pop() ?? path;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export function extensionsToIncludeGlobs(extensions: readonly string[]): string[] {
  const normalized = extensions
    .map((ext) => ext.trim().replace(/^\./, '').toLowerCase())
    .filter(Boolean);
  if (!normalized.length) return [];
  if (normalized.length === 1) return [`**/*.${normalized[0]}`];
  return [`**/*.{${normalized.join(',')}}`];
}

export function mergeIncludeGlobs(
  include?: string[],
  extensions?: string[],
): string[] | undefined {
  const fromExt = extensions?.length ? extensionsToIncludeGlobs(extensions) : [];
  const fromInclude = include?.map((s) => s.trim()).filter(Boolean) ?? [];
  const merged = [...fromInclude, ...fromExt];
  return merged.length ? merged : undefined;
}

export function matchesPathFilters(
  path: string,
  filters: FileSearchFilters,
): boolean {
  const include = mergeIncludeGlobs(filters.include, filters.extensions);
  if (include && !matchesAnyGlob(path, include)) return false;
  if (filters.exclude?.length && matchesAnyGlob(path, filters.exclude)) return false;
  return true;
}

export function matchesSizeFilters(
  size: number | null | undefined,
  filters: FileSearchFilters,
): boolean {
  if (size === null || size === undefined) return true;
  if (filters.minSizeBytes !== undefined && size < filters.minSizeBytes) return false;
  if (filters.maxSizeBytes !== undefined && size > filters.maxSizeBytes) return false;
  return true;
}

export const FILE_TYPE_PRESETS: {
  key: string;
  label: string;
  extensions: string[];
}[] = [
  { key: 'code', label: '代码', extensions: ['ts', 'tsx', 'js', 'jsx', 'vue', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'cs', 'rb', 'php', 'swift', 'kt'] },
  { key: 'web', label: 'Web', extensions: ['html', 'css', 'scss', 'less', 'vue', 'jsx', 'tsx'] },
  { key: 'docs', label: '文档', extensions: ['md', 'txt', 'rst', 'adoc'] },
  { key: 'data', label: '数据', extensions: ['json', 'yaml', 'yml', 'toml', 'xml', 'csv'] },
  { key: 'config', label: '配置', extensions: ['json', 'yaml', 'yml', 'toml', 'env', 'ini'] },
  { key: 'image', label: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'] },
];
