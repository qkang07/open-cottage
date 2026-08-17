import {
  ArchiveOutline,
  DocumentOutline,
  DocumentTextOutline,
  EaselOutline,
  FolderOutline,
  GridOutline,
  ImageOutline,
  LogoHtml5,
  VideocamOutline,
  WarningOutline,
  } from '@vicons/ionicons5';
import { NIcon } from '@/ui/element-plus-primitives';
import { h, type VNode } from 'vue';
import {
  getDeferredDirTooltip,
  type DeferredDirInfo,
} from '../../workspace/deferredDirs';
import { isTraverseSkippedDirName } from '../../workspace/traverseIgnore';
import type { ExplorerEntry, ExplorerSortKey, ExplorerSortOrder } from '../../workspace/explorerTypes';
import { getPreviewKind } from '../../workspace/previewKind';

export const formatBytes = (bytes: number | null): string => {
  if (bytes === null) return '—';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
};

export const formatModified = (timestamp: number | null): string => {
  if (timestamp === null) return '—';
  return new Date(timestamp).toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const getTypeLabel = (entry: ExplorerEntry): string => {
  if (entry.kind === 'directory') return '文件夹';
  if (!entry.extension) return '文件';
  const kind = getPreviewKind(entry.path);
  switch (kind) {
    case 'markdown':
      return 'Markdown 文档';
    case 'html':
      return 'HTML 文档';
    case 'image':
      return `${entry.extension.toUpperCase()} 图像`;
    case 'video':
      return `${entry.extension.toUpperCase()} 视频`;
    case 'spreadsheet':
      return '电子表格';
    case 'word':
      return 'Word 文档';
    case 'presentation':
      return '演示文稿';
    default:
      if (entry.extension === 'pdf') return 'PDF 文档';
      if (entry.extension === 'zip') return 'ZIP 压缩包';
      return `${entry.extension.toUpperCase()} 文件`;
  }
};

const iconClass = (suffix: string) => `explorer-entry-icon ${suffix}`;

export const getEntryIcon = (entry: ExplorerEntry): VNode => {
  if (entry.kind === 'directory') {
    if (entry.deferred) {
      return h(NIcon, {
        class: iconClass('folder deferred'),
        component: WarningOutline,
      });
    }
    return h(NIcon, { class: iconClass('folder'), component: FolderOutline });
  }

  const kind = getPreviewKind(entry.path);
  switch (kind) {
    case 'markdown':
      return h(NIcon, { class: iconClass('markdown'), component: DocumentTextOutline });
    case 'html':
      return h(NIcon, { class: iconClass('html'), component: LogoHtml5 });
    case 'image':
      return h(NIcon, { class: iconClass('image'), component: ImageOutline });
    case 'video':
      return h(NIcon, { class: iconClass('video'), component: VideocamOutline });
    case 'spreadsheet':
      return h(NIcon, { class: iconClass('spreadsheet'), component: GridOutline });
    case 'word':
      return h(NIcon, { class: iconClass('word'), component: DocumentTextOutline });
    case 'presentation':
      return h(NIcon, { class: iconClass('presentation'), component: EaselOutline });
    default:
      if (entry.extension === 'pdf') {
        return h(NIcon, { class: iconClass('pdf'), component: DocumentOutline });
      }
      if (entry.extension === 'zip') {
        return h(NIcon, { class: iconClass('zip'), component: ArchiveOutline });
      }
      if (['txt', 'json', 'ts', 'tsx', 'js', 'jsx', 'css', 'yaml', 'yml'].includes(entry.extension)) {
        return h(NIcon, { class: iconClass('text'), component: DocumentTextOutline });
      }
      return h(NIcon, { class: iconClass('generic'), component: DocumentOutline });
  }
};

export const sortEntries = (
  entries: ExplorerEntry[],
  sortKey: ExplorerSortKey,
  sortOrder: ExplorerSortOrder,
  resolveSize?: (entry: ExplorerEntry) => number,
): ExplorerEntry[] => {
  const direction = sortOrder === 'asc' ? 1 : -1;

  const compare = (a: ExplorerEntry, b: ExplorerEntry): number => {
    if (a.kind !== b.kind) {
      return a.kind === 'directory' ? -1 : 1;
    }

    switch (sortKey) {
      case 'size': {
        const av = resolveSize ? resolveSize(a) : (a.size ?? -1);
        const bv = resolveSize ? resolveSize(b) : (b.size ?? -1);
        return (av - bv) * direction;
      }
      case 'type':
        return getTypeLabel(a).localeCompare(getTypeLabel(b), undefined, {
          sensitivity: 'base',
        }) * direction;
      case 'modified': {
        const av = a.modified ?? 0;
        const bv = b.modified ?? 0;
        return (av - bv) * direction;
      }
      case 'name':
      default:
        return a.name.localeCompare(b.name, undefined, {
          numeric: true,
          sensitivity: 'base',
        }) * direction;
    }
  };

  return [...entries].sort(compare);
};

export const splitPathSegments = (dirPath: string): string[] =>
  dirPath.split('/').filter(Boolean);

export const joinDirSegments = (segments: string[]): string =>
  segments.join('/');

/** 合并 snapshot 的 deferredDirs 与按名匹配的忽略目录，得到 entry 的 deferred 信息 */
export function resolveEntryDeferred(
  entry: ExplorerEntry,
  deferredDirs: Record<string, DeferredDirInfo> = {},
): DeferredDirInfo | null {
  if (entry.kind !== 'directory') return null;
  if (entry.deferred) {
    return {
      reason: entry.deferred,
      entryCount: entry.deferredEntryCount,
    };
  }
  if (deferredDirs[entry.path]) return deferredDirs[entry.path];
  if (isTraverseSkippedDirName(entry.name)) return { reason: 'ignored' };
  return null;
}

/** 给条目打上 deferred 信息后返回新 entry（用于 listDirectoryContents 后合并） */
export function enrichEntriesWithDeferred(
  entries: ExplorerEntry[],
  deferredDirs: Record<string, DeferredDirInfo> = {},
): ExplorerEntry[] {
  return entries.map((entry) => {
    const info = resolveEntryDeferred(entry, deferredDirs);
    if (!info) return entry;
    return {
      ...entry,
      deferred: info.reason,
      deferredEntryCount: info.entryCount,
    };
  });
}

/** 延迟目录的悬浮提示文字 */
export function getEntryDeferredTooltip(
  entry: ExplorerEntry,
  deferredDirs: Record<string, DeferredDirInfo> = {},
): string | null {
  const info = resolveEntryDeferred(entry, deferredDirs);
  if (!info) return null;
  return getDeferredDirTooltip(info, entry.name);
}

/** 延迟目录条目附加的 class（用于淡色文字等样式） */
export const deferredEntryClass = (entry: ExplorerEntry): string =>
  entry.deferred ? 'explorer-entry-deferred' : '';
