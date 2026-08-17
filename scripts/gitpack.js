#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
const outputName = `gitpack-${stamp}.zip`;
const outputPath = path.join(root, outputName);
const password = crypto.randomBytes(4).toString('base64url');

function git(args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.error) {
    console.error('Failed to run git:', result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(result.stderr || `git ${args.join(' ')} failed`);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

function hasHead() {
  const result = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  });
  return result.status === 0;
}

function collectFiles() {
  const files = new Set();

  if (hasHead()) {
    // Staged + unstaged changes vs HEAD (exclude deletions)
    for (const line of git(['diff', '--name-only', '--diff-filter=ACMRTUXB', 'HEAD']).split('\n')) {
      if (line) files.add(line);
    }
  } else {
    // No commits yet: all tracked files in the index
    for (const line of git(['ls-files']).split('\n')) {
      if (line) files.add(line);
    }
  }

  // Untracked files (respect .gitignore)
  for (const line of git(['ls-files', '-o', '--exclude-standard']).split('\n')) {
    if (line) files.add(line);
  }

  return [...files]
    .filter((rel) => {
      if (rel === outputName) return false;
      const full = path.join(root, rel);
      try {
        return fs.statSync(full).isFile();
      } catch {
        return false;
      }
    })
    .sort();
}

const files = collectFiles();

if (files.length === 0) {
  console.error('No changed or untracked files to pack.');
  process.exit(1);
}

const zipResult = spawnSync('zip', ['-r', '-v', '-P', password, outputPath, '-@'], {
  cwd: root,
  input: files.join('\n'),
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});

if (zipResult.error) {
  console.error('Failed to run zip:', zipResult.error.message);
  process.exit(1);
}

if (zipResult.stderr) {
  process.stderr.write(zipResult.stderr);
}

if (zipResult.status !== 0) {
  if (zipResult.stdout) process.stdout.write(zipResult.stdout);
  process.exit(zipResult.status ?? 1);
}

const addingRe = /^\s*adding:\s*(.+?)\t\(in=(\d+)\)\s*\(out=(\d+)\)\s*\((.+)\)\s*$/;
const rows = [];
for (const line of (zipResult.stdout || '').split('\n')) {
  const m = line.match(addingRe);
  if (!m) continue;
  rows.push({
    file: m[1],
    in: Number(m[2]),
    out: Number(m[3]),
    method: m[4],
  });
}

function formatSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} K`;
  return `${(n / (1024 * 1024)).toFixed(2)} M`;
}

function pad(str, width, align = 'left') {
  const s = String(str);
  if (s.length >= width) return s;
  const padLen = width - s.length;
  return align === 'right' ? ' '.repeat(padLen) + s : s + ' '.repeat(padLen);
}

const headers = ['FILE', 'IN', 'OUT', 'METHOD'];
const table = rows.map((r) => [
  r.file,
  formatSize(r.in),
  formatSize(r.out),
  r.method,
]);
const widths = headers.map((h, i) =>
  Math.max(h.length, ...table.map((row) => row[i].length)),
);

console.log(
  headers.map((h, i) => pad(h, widths[i], i === 0 ? 'left' : 'right')).join('  '),
);
console.log(widths.map((w) => '-'.repeat(w)).join('  '));
for (const row of table) {
  console.log(
    row.map((cell, i) => pad(cell, widths[i], i === 0 ? 'left' : 'right')).join('  '),
  );
}

const { size } = fs.statSync(outputPath);
const sizeMb = (size / 1024 / 1024).toFixed(2);
console.log(`\nPacked ${files.length} files: ${outputPath} (${sizeMb} MB)`);
console.log(`Password: ${password}`);
