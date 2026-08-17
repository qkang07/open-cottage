export const normalizePath = (path: string) => {
  const trimmed = path.trim().replace(/\\/g, '/');
  const parts: string[] = [];
  for (const part of trimmed.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join('/');
};

export const splitPath = (path: string) => normalizePath(path).split('/');

export const joinPath = (...parts: string[]) =>
  normalizePath(parts.filter(Boolean).join('/'));

export const isPathUnderPrefix = (path: string, prefix: string) => {
  const p = normalizePath(path);
  const base = normalizePath(prefix);
  if (!base) return true;
  return p === base || p.startsWith(`${base}/`);
};

export const replacePathPrefix = (
  path: string,
  fromPrefix: string,
  toPrefix: string,
) => {
  const p = normalizePath(path);
  const from = normalizePath(fromPrefix);
  const to = normalizePath(toPrefix);
  if (p === from) return to;
  if (p.startsWith(`${from}/`)) {
    const rest = p.slice(from.length + 1);
    return to ? `${to}/${rest}` : rest;
  }
  return p;
};

export const collectPathsUnderPrefixes = (
  allFiles: string[],
  prefixes: string[],
) => {
  const result = new Set<string>();
  for (const prefix of prefixes) {
    const base = normalizePath(prefix);
    for (const file of allFiles) {
      if (isPathUnderPrefix(file, base)) result.add(file);
    }
  }
  return [...result].sort();
};
