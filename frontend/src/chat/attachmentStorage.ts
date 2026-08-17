import type { ChatAttachment } from './attachments';
import { getCottageConfig } from '../config/store';
import { workspace } from '../workspace/FileSystemWorkspace';

/**
 * 附件持久化：workspace-file 模式下把 base64 图片落盘到工作区，
 * 历史中只存相对路径（约定：data 不以 `data:` 开头即为工作区路径）。
 */

const DEFAULT_ATTACHMENTS_DIR = '.cottage/attachments';

/** 附件读写 IO（默认用全局工作区单例；单测可注入） */
export interface AttachmentIo {
  isOpen: boolean;
  writeFileBytes: (path: string, data: Uint8Array) => Promise<unknown>;
  readFileBytes: (path: string) => Promise<Uint8Array>;
}

const workspaceIo = (): AttachmentIo => ({
  isOpen: workspace.isOpen,
  writeFileBytes: (path, data) => workspace.writeFileBytes(path, data),
  readFileBytes: (path) => workspace.readFileBytes(path),
});

/** data 字段是否为工作区路径（而非内联 data URL） */
export const isAttachmentPath = (data: string): boolean =>
  !data.startsWith('data:');

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
};

const extFromMime = (mimeType: string): string =>
  MIME_EXT[mimeType.toLowerCase()] ?? 'png';

const EXT_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(MIME_EXT).map(([mime, ext]) => [ext, mime]),
);

/** 按扩展名推断图片 MIME（工具回传的路径态附件用），缺省 image/png */
export const mimeFromPath = (path: string): string => {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'jpeg') return 'image/jpeg';
  return EXT_MIME[ext] ?? 'image/png';
};

/** 解析 data URL 为字节与 MIME */
export const dataUrlToBytes = (
  dataUrl: string,
): { bytes: Uint8Array; mimeType: string } => {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error('无效的 data URL');
  const mimeType = match[1] || 'application/octet-stream';
  const payload = match[3] ?? '';
  if (match[2]) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return { bytes, mimeType };
  }
  return { bytes: new TextEncoder().encode(decodeURIComponent(payload)), mimeType };
};

/** 字节转 base64 data URL（分块避免栈溢出） */
export const bytesToDataUrl = (bytes: Uint8Array, mimeType: string): string => {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
};

/**
 * 发送前持久化附件：workspace-file 模式下写入工作区并把 data 换成相对路径。
 * inline-base64 模式、已是路径、工作区未打开或写入失败时原样返回（内联兜底）。
 */
export const persistAttachment = async (
  att: ChatAttachment,
  io: AttachmentIo = workspaceIo(),
): Promise<ChatAttachment> => {
  const vision = getCottageConfig().vision;
  if ((vision?.storage ?? 'workspace-file') === 'inline-base64') return att;
  if (isAttachmentPath(att.data)) return att;
  if (!io.isOpen) return att;
  try {
    const { bytes } = dataUrlToBytes(att.data);
    const dir = (vision?.attachmentsDir ?? DEFAULT_ATTACHMENTS_DIR).replace(
      /\/+$/,
      '',
    );
    const path = `${dir}/${att.id}.${extFromMime(att.mimeType)}`;
    await io.writeFileBytes(path, bytes);
    return { ...att, data: path };
  } catch {
    return att;
  }
};

export const persistAttachments = async (
  attachments: readonly ChatAttachment[],
  io: AttachmentIo = workspaceIo(),
): Promise<ChatAttachment[]> =>
  Promise.all(attachments.map((att) => persistAttachment(att, io)));

/**
 * 把附件 data 解析为可发给模型 / 渲染的 data URL。
 * 路径态读工作区文件；文件缺失或读取失败返回 null（调用方跳过该图）。
 */
export const resolveAttachmentDataUrl = async (
  att: ChatAttachment,
  io: AttachmentIo = workspaceIo(),
): Promise<string | null> => {
  if (!isAttachmentPath(att.data)) return att.data;
  if (!io.isOpen) return null;
  try {
    const bytes = await io.readFileBytes(att.data);
    if (!bytes.byteLength) return null;
    return bytesToDataUrl(bytes, att.mimeType);
  } catch {
    return null;
  }
};
