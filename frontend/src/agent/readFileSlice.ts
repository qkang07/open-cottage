/** readFile 默认返回内容的字符上限，防止大文件撑爆上下文 */
export const READ_FILE_DEFAULT_MAX_CHARS = 100_000;

export interface SliceTextFileOptions {
  /** 1-based 起始行；缺省为 1 */
  offset?: number;
  /** 最多返回行数；缺省到文件末尾 */
  limit?: number;
  /** 返回内容最大字符数；缺省 READ_FILE_DEFAULT_MAX_CHARS */
  maxChars?: number;
}

export interface SlicedTextFile {
  content: string;
  /** 文件总行数 */
  totalLines: number;
  /** 实际返回的起始行（1-based） */
  startLine: number;
  /** 实际返回的结束行（1-based，含） */
  endLine: number;
  truncatedByLines: boolean;
  truncatedByChars: boolean;
}

/**
 * 按行 offset/limit 与字符上限切片纯文本。
 * offset/limit 均按「行」计；maxChars 在切片后再截断。
 */
export const sliceTextFileContent = (
  content: string,
  options: SliceTextFileOptions = {},
): SlicedTextFile => {
  const lines = content.split('\n');
  const totalLines = lines.length;
  const startLine = Math.max(1, Math.floor(options.offset ?? 1));
  const maxLines =
    options.limit != null
      ? Math.max(1, Math.floor(options.limit))
      : totalLines;
  const endExclusive = Math.min(totalLines, startLine - 1 + maxLines);
  const slicedLines = lines.slice(startLine - 1, endExclusive);
  const truncatedByLines = endExclusive < totalLines || startLine > 1;
  let text = slicedLines.join('\n');
  const maxChars = Math.max(
    1,
    Math.floor(options.maxChars ?? READ_FILE_DEFAULT_MAX_CHARS),
  );
  const truncatedByChars = text.length > maxChars;
  if (truncatedByChars) {
    text = text.slice(0, maxChars);
  }
  return {
    content: text,
    totalLines,
    startLine: totalLines === 0 ? 0 : Math.min(startLine, totalLines),
    endLine: totalLines === 0 ? 0 : Math.max(startLine - 1, endExclusive),
    truncatedByLines: truncatedByLines && totalLines > 0,
    truncatedByChars,
  };
};
