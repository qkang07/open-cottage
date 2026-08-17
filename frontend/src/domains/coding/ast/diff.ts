export type DiffOperation = {
  type: ' ' | '+' | '-';
  line: string;
  /** 变更行所属区域；上下文行没有 regionId */
  regionId?: number;
};

export type DiffRegion = {
  id: number;
  header: string;
  lines: DiffOperation[];
};

const buildDiffOperations = (oldStr: string, newStr: string): DiffOperation[] => {
  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');
  const m = oldLines.length;
  const n = newLines.length;

  // LCS DP（自底向上）
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] =
        oldLines[i] === newLines[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: DiffOperation[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      out.push({ type: ' ', line: oldLines[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: '-', line: oldLines[i] });
      i++;
    } else {
      out.push({ type: '+', line: newLines[j] });
      j++;
    }
  }
  while (i < m) out.push({ type: '-', line: oldLines[i++] });
  while (j < n) out.push({ type: '+', line: newLines[j++] });
  return out;
};

/** 将相距较远的变更拆成可独立审批的区域。 */
export const diffRegions = (
  oldStr: string,
  newStr: string,
  context = 3,
): DiffRegion[] => {
  if (oldStr === newStr) return [];
  const out = buildDiffOperations(oldStr, newStr);
  const changeIndexes = out
    .map((line, index) => (line.type === ' ' ? -1 : index))
    .filter((index) => index >= 0);
  if (!changeIndexes.length) return [];

  const groups: Array<{ first: number; last: number }> = [];
  for (const index of changeIndexes) {
    const current = groups[groups.length - 1];
    if (!current || index - current.last > context * 2 + 1) {
      groups.push({ first: index, last: index });
    } else {
      current.last = index;
    }
  }

  return groups.map((group, regionId) => {
    const start = Math.max(0, group.first - context);
    const end = Math.min(out.length - 1, group.last + context);
    let oldLine = 0;
    let newLine = 0;
    for (let k = 0; k < start; k++) {
      if (out[k].type !== '-') newLine++;
      if (out[k].type !== '+') oldLine++;
    }
    const lines = out.slice(start, end + 1).map((line, offset) => {
      const absoluteIndex = start + offset;
      return line.type === ' '
        ? line
        : {
            ...line,
            regionId:
              absoluteIndex >= group.first && absoluteIndex <= group.last
                ? regionId
                : line.regionId,
          };
    });
    let oldCount = 0;
    let newCount = 0;
    for (const line of lines) {
      if (line.type !== '-') newCount++;
      if (line.type !== '+') oldCount++;
    }
    return {
      id: regionId,
      header: `@@ -${oldLine + 1},${oldCount} +${newLine + 1},${newCount} @@`,
      lines,
    };
  });
};

/**
 * 只保留选中区域的改动，未选区域恢复为旧内容。
 * 用于把区域审批结果还原成最终可落盘的完整文件。
 */
export const applySelectedDiffRegions = (
  oldStr: string,
  newStr: string,
  selectedRegionIds: ReadonlySet<number>,
): string => {
  if (oldStr === newStr) return oldStr;
  const operations = buildDiffOperations(oldStr, newStr);
  const regions = diffRegions(oldStr, newStr, 3);
  let regionCursor = 0;
  let lastChangeIndex = -1;
  const changeGroups = regions.map((region) => {
    const changeCount = region.lines.filter((line) => line.type !== ' ').length;
    lastChangeIndex += changeCount;
    return { id: region.id, end: lastChangeIndex };
  });
  let changeIndex = 0;
  const result: string[] = [];
  for (const operation of operations) {
    if (operation.type === ' ') {
      result.push(operation.line);
      continue;
    }
    while (
      regionCursor < changeGroups.length - 1 &&
      changeIndex > changeGroups[regionCursor].end
    ) {
      regionCursor++;
    }
    const selected = selectedRegionIds.has(changeGroups[regionCursor]?.id ?? -1);
    if (operation.type === '+' ? selected : !selected) {
      result.push(operation.line);
    }
    changeIndex++;
  }
  return result.join('\n');
};

export type WordSegment = {
  /** ' ' 未变 / '+' 新增片段 / '-' 删除片段 */
  type: ' ' | '+' | '-';
  text: string;
};

const tokenizeLine = (line: string): string[] =>
  line.match(/(\w+|\s+|[^\w\s])/g) ?? [];

/**
 * 词级 diff：对一对被判定为“替换”的行做 token 级 LCS，
 * 返回带 same/added/removed 片段的序列，供行内高亮只标出真正改动的部分。
 * 组件渲染删除行时取 ' ' 与 '-' 片段，渲染新增行时取 ' ' 与 '+' 片段。
 */
export const wordDiff = (oldLine: string, newLine: string): WordSegment[] => {
  if (oldLine === newLine) return oldLine ? [{ type: ' ', text: oldLine }] : [];
  const oldTokens = tokenizeLine(oldLine);
  const newTokens = tokenizeLine(newLine);
  const m = oldTokens.length;
  const n = newTokens.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] =
        oldTokens[i] === newTokens[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const raw: WordSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldTokens[i] === newTokens[j]) {
      raw.push({ type: ' ', text: oldTokens[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      raw.push({ type: '-', text: oldTokens[i] });
      i++;
    } else {
      raw.push({ type: '+', text: newTokens[j] });
      j++;
    }
  }
  while (i < m) raw.push({ type: '-', text: oldTokens[i++] });
  while (j < n) raw.push({ type: '+', text: newTokens[j++] });

  // 合并相邻同类型片段，减少 DOM 节点
  const merged: WordSegment[] = [];
  for (const seg of raw) {
    const last = merged[merged.length - 1];
    if (last && last.type === seg.type) last.text += seg.text;
    else merged.push({ ...seg });
  }
  return merged;
};

/**
 * 判断一对替换行是否值得做行内高亮：
 * 若两行几乎完全不同（公共片段占比过低），行内高亮反而是噪声，改回整行高亮。
 */
export const shouldInlineHighlight = (
  segments: WordSegment[],
  oldLine: string,
  newLine: string,
): boolean => {
  const sameLen = segments
    .filter((s) => s.type === ' ')
    .reduce((sum, s) => sum + s.text.trim().length, 0);
  const longer = Math.max(oldLine.trim().length, newLine.trim().length, 1);
  return sameLen / longer >= 0.25;
};

/**
 * 极简 unified diff（基于行级 LCS）。
 * 适用于单文件 AST 编辑产生的小 diff；大文件 O(m*n) 内存可接受（源码文件通常 < 数千行）。
 */
export const diffLines = (oldStr: string, newStr: string): string => {
  const regions = diffRegions(oldStr, newStr);
  if (!regions.length) return '';

  return regions
    .map(
      (region) =>
        `${region.header}\n${region.lines
          .map((line) => line.type + line.line)
          .join('\n')}`,
    )
    .join('\n');
};
