/**
 * 下载 createPdf 所需的 Noto Sans SC（SubsetOTF）到 public/fonts。
 * 来源：googlefonts/noto-cjk（SIL OFL 1.1）
 *
 * 用法：node scripts/fetch-pdf-fonts.mjs
 */
import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '../public/fonts');
const OUT_FILE = join(OUT_DIR, 'NotoSansSC-Regular.otf');
const FONT_URL =
  'https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf';

const force = process.argv.includes('--force');

if (existsSync(OUT_FILE) && !force) {
  const size = statSync(OUT_FILE).size;
  console.log(`已存在 ${OUT_FILE} (${(size / 1024 / 1024).toFixed(1)} MB)，跳过。加 --force 可重新下载。`);
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });
console.log(`下载 ${FONT_URL}`);
const res = await fetch(FONT_URL);
if (!res.ok || !res.body) {
  console.error(`下载失败：HTTP ${res.status}`);
  process.exit(1);
}
await pipeline(Readable.fromWeb(res.body), createWriteStream(OUT_FILE));
const size = statSync(OUT_FILE).size;
console.log(`已写入 ${OUT_FILE} (${(size / 1024 / 1024).toFixed(1)} MB)`);
