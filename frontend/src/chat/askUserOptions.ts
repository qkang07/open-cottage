/**
 * askUser 的快捷选项。
 *
 * 模型通常会按工具 schema 返回字符串；但部分模型会自然地补充说明，输出
 * `{ label, description }`。两种格式都统一为这一显示结构，提交给模型的
 * 回答仍始终是 label，避免把展示说明混入工具结果。
 */
export type AskUserOption = {
  label: string;
  description?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizeOption = (value: unknown): AskUserOption | null => {
  if (typeof value === 'string') {
    const label = value.trim();
    return label ? { label } : null;
  }
  if (!isRecord(value) || typeof value.label !== 'string') return null;
  const label = value.label.trim();
  if (!label) return null;
  const description =
    typeof value.description === 'string' && value.description.trim()
      ? value.description.trim()
      : undefined;
  return { label, description };
};

export const normalizeAskUserOptions = (value: unknown): AskUserOption[] =>
  Array.isArray(value)
    ? value
        .map(normalizeOption)
        .filter((option): option is AskUserOption => option !== null)
    : [];
