/**
 * 工具名归一化：模型可能输出 snake_case（ask_user）或大小写变体（AskUser），
 * 统一转为小写去下划线后再比较，与 CottageAgent.toolMap 的别名注册规则一致。
 * 所有对特定工具名的特判都应走这里的比较函数，避免变体名绕过分支。
 */
export const normalizeToolName = (name: string): string =>
  name.toLowerCase().replace(/_/g, '');

/** 是否为用户问询工具 askUser（兼容 ask_user / AskUser 等变体） */
export const isAskUserTool = (name: string | null | undefined): boolean =>
  typeof name === 'string' && normalizeToolName(name) === 'askuser';

/** 归一化后是否命中工具名集合（用于黑名单 / 控制类工具等特判） */
export const toolNameIn = (
  names: ReadonlySet<string> | readonly string[],
  name: string,
): boolean => {
  if (names instanceof Set && names.has(name)) return true;
  const normalized = normalizeToolName(name);
  for (const n of names) {
    if (normalizeToolName(n) === normalized) return true;
  }
  return false;
};
