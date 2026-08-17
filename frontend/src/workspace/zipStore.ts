import { normalizePath } from './pathUtils';

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

const crc32 = (data: Uint8Array) => {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const encodeName = (path: string) => new TextEncoder().encode(normalizePath(path));

const writeUint16 = (view: DataView, offset: number, value: number) => {
  view.setUint16(offset, value, true);
};

const writeUint32 = (view: DataView, offset: number, value: number) => {
  view.setUint32(offset, value, true);
};

export const createStoreZip = (
  entries: { path: string; data: Uint8Array }[],
): Uint8Array => {
  const normalized = entries.map((e) => ({
    path: normalizePath(e.path),
    data: e.data,
  }));

  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of normalized) {
    const nameBytes = encodeName(entry.path);
    const size = entry.data.byteLength;
    const checksum = crc32(entry.data);

    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    writeUint32(localView, 0, SIG_LOCAL);
    writeUint16(localView, 4, 20);
    writeUint16(localView, 6, 0);
    writeUint16(localView, 8, 0);
    writeUint16(localView, 10, 0);
    writeUint16(localView, 12, 0);
    writeUint32(localView, 14, checksum);
    writeUint32(localView, 18, size);
    writeUint32(localView, 22, size);
    writeUint16(localView, 26, nameBytes.length);
    writeUint16(localView, 28, 0);
    local.set(nameBytes, 30);

    chunks.push(local, entry.data);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    writeUint32(centralView, 0, SIG_CENTRAL);
    writeUint16(centralView, 4, 20);
    writeUint16(centralView, 6, 20);
    writeUint16(centralView, 8, 0);
    writeUint16(centralView, 10, 0);
    writeUint16(centralView, 12, 0);
    writeUint16(centralView, 14, 0);
    writeUint32(centralView, 16, checksum);
    writeUint32(centralView, 20, size);
    writeUint32(centralView, 24, size);
    writeUint16(centralView, 28, nameBytes.length);
    writeUint16(centralView, 30, 0);
    writeUint16(centralView, 32, 0);
    writeUint16(centralView, 34, 0);
    writeUint16(centralView, 36, 0);
    writeUint32(centralView, 38, 0);
    writeUint32(centralView, 42, offset);
    centralHeader.set(nameBytes, 46);
    central.push(centralHeader);

    offset += local.byteLength + entry.data.byteLength;
  }

  const centralSize = central.reduce((sum, part) => sum + part.byteLength, 0);
  const centralStart = offset;

  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  writeUint32(eocdView, 0, SIG_EOCD);
  writeUint16(eocdView, 4, 0);
  writeUint16(eocdView, 6, 0);
  writeUint16(eocdView, 8, normalized.length);
  writeUint16(eocdView, 10, normalized.length);
  writeUint32(eocdView, 12, centralSize);
  writeUint32(eocdView, 16, centralStart);
  writeUint16(eocdView, 20, 0);

  const total =
    chunks.reduce((sum, part) => sum + part.byteLength, 0) +
    centralSize +
    eocd.byteLength;
  const output = new Uint8Array(total);
  let cursor = 0;
  for (const part of [...chunks, ...central, eocd]) {
    output.set(part, cursor);
    cursor += part.byteLength;
  }
  return output;
};

interface ZipEntry {
  path: string;
  data: Uint8Array;
  isDirectory: boolean;
}

export const parseStoreZip = (buffer: ArrayBuffer): ZipEntry[] => {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const eocdOffset = findEocdOffset(bytes);
  if (eocdOffset < 0) throw new Error('无效的 zip 文件');

  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralOffset = view.getUint32(eocdOffset + 16, true);
  const entries: ZipEntry[] = [];
  let cursor = centralOffset;

  for (let i = 0; i < entryCount; i += 1) {
    if (view.getUint32(cursor, true) !== SIG_CENTRAL) {
      throw new Error('zip 中央目录损坏');
    }
    const compression = view.getUint16(cursor + 10, true);
    if (compression !== 0) {
      throw new Error('仅支持未压缩的 zip（store）');
    }
    const crc = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const nameBytes = bytes.slice(cursor + 46, cursor + 46 + nameLength);
    const path = normalizePath(new TextDecoder().decode(nameBytes));
    cursor += 46 + nameLength + extraLength + commentLength;

    if (!path) continue;

    const localSig = view.getUint32(localOffset, true);
    if (localSig !== SIG_LOCAL) throw new Error('zip 本地头损坏');
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = bytes.slice(dataStart, dataStart + compressedSize);

    if (crc32(data) !== crc || data.byteLength !== uncompressedSize) {
      throw new Error(`zip 校验失败: ${path}`);
    }

    const isDirectory = path.endsWith('/') || compressedSize === 0;
    entries.push({
      path: path.replace(/\/$/, ''),
      data,
      isDirectory,
    });
  }

  return entries;
};

const findEocdOffset = (bytes: Uint8Array) => {
  for (let i = bytes.length - 22; i >= 0; i -= 1) {
    if (
      bytes[i] === 0x50 &&
      bytes[i + 1] === 0x4b &&
      bytes[i + 2] === 0x05 &&
      bytes[i + 3] === 0x06
    ) {
      return i;
    }
  }
  return -1;
};
