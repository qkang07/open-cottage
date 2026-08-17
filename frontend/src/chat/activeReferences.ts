import {
  type ChatFileReference,
} from './fileReferences';

/** 当前轮用户消息附带的文件引用（发送时写入，供 writeSpreadsheet 等推断上下文） */
let activeReferences: ChatFileReference[] = [];

export const setActiveChatReferences = (
  refs: readonly ChatFileReference[],
): void => {
  activeReferences = [...refs];
};

/** 发送后供工具使用的显式引用（不含当前打开文件上下文） */
export const setActiveChatReferencesForSend = (
  explicitRefs: readonly ChatFileReference[],
): void => {
  activeReferences = [...explicitRefs];
};

export const getActiveChatReferences = (): readonly ChatFileReference[] =>
  activeReferences;

export const clearActiveChatReferences = (): void => {
  activeReferences = [];
};
