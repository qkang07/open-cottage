/**
 * 兼容模型把思考过程写进正文标签的情况，例如：
 *   <cottage_thinking>...</cottage_thinking>
 *   <mm:think>...</mm:think>
 * 拆成 think / content，供 UI 按思考样式展示，并避免标签原文泄漏到正文。
 */

export const COTTAGE_THINK_OPEN = '<cottage_thinking>';
export const COTTAGE_THINK_CLOSE = '</cottage_thinking>';
export const MINIMAX_THINK_OPEN = '<mm:think>';
export const MINIMAX_THINK_CLOSE = '</mm:think>';

type ThinkingTag = {
  open: string;
  close: string;
};

const THINKING_TAGS: ThinkingTag[] = [
  { open: COTTAGE_THINK_OPEN, close: COTTAGE_THINK_CLOSE },
  { open: MINIMAX_THINK_OPEN, close: MINIMAX_THINK_CLOSE },
];

export type CottageThinkingPart =
  | { type: 'think'; text: string }
  | { type: 'content'; text: string };

export function containsThinkingTag(text: string): boolean {
  return THINKING_TAGS.some(
    ({ open, close }) => text.includes(open) || text.includes(close),
  );
}

/** 完整文本拆分（历史消息 / 非流式） */
export function splitCottageThinking(text: string): CottageThinkingPart[] {
  if (!text) return [];
  if (!containsThinkingTag(text)) return [{ type: 'content', text }];

  const state = createCottageThinkStreamState();
  const parts = feedCottageThinkingChunk(state, text);
  const tail = flushCottageThinkingCarry(state);
  if (tail) parts.push(tail);
  return mergeAdjacent(parts);
}

/** 从可能含标签的全文抽出干净正文与思考 */
export function extractThinkingFromContent(text: string): {
  content: string;
  thinking: string;
} {
  const parts = splitCottageThinking(text);
  const content = parts
    .filter((p): p is Extract<CottageThinkingPart, { type: 'content' }> => p.type === 'content')
    .map((p) => p.text)
    .join('')
    .replace(/^\n+/, '');
  const thinking = parts
    .filter((p): p is Extract<CottageThinkingPart, { type: 'think' }> => p.type === 'think')
    .map((p) => p.text.trim())
    .filter(Boolean)
    .join('\n\n');
  return { content, thinking };
}

export type CottageThinkStreamState = {
  mode: 'content' | 'think';
  /** 当前思考段匹配的关闭标签 */
  closeTag?: string;
  /** 可能落在标签中间的未消费前缀 */
  carry: string;
};

export function createCottageThinkStreamState(): CottageThinkStreamState {
  return { mode: 'content', carry: '' };
}

/**
 * 流式喂入 chunk，产出可追加的 think/content 片段。
 * 未完成的标签前缀留在 state.carry，下次继续。
 */
export function feedCottageThinkingChunk(
  state: CottageThinkStreamState,
  chunk: string,
): CottageThinkingPart[] {
  const out: CottageThinkingPart[] = [];
  const buf = state.carry + chunk;
  state.carry = '';
  let i = 0;

  while (i < buf.length) {
    const lt = buf.indexOf('<', i);
    if (lt === -1) {
      const rest = buf.slice(i);
      if (rest) out.push({ type: state.mode, text: rest });
      break;
    }
    if (lt > i) out.push({ type: state.mode, text: buf.slice(i, lt) });

    const rest = buf.slice(lt);
    if (state.mode === 'content') {
      const openingTag = findTagAtStart(rest, 'open');
      if (openingTag) {
        state.mode = 'think';
        state.closeTag = openingTag.close;
        i = lt + openingTag.open.length;
        continue;
      }
      const closingTag = findTagAtStart(rest, 'close');
      if (closingTag) {
        // 某些兼容接口会只泄漏关闭标签；将其视为控制标记而非正文。
        i = lt + closingTag.close.length;
        continue;
      }
      if (isPartialTagPrefix(rest, THINKING_TAGS.flatMap(({ open, close }) => [open, close]))) {
        state.carry = rest;
        break;
      }
      out.push({ type: 'content', text: '<' });
      i = lt + 1;
      continue;
    }

    const closeTag = state.closeTag;
    if (closeTag && rest.startsWith(closeTag)) {
      state.mode = 'content';
      state.closeTag = undefined;
      i = lt + closeTag.length;
      continue;
    }
    if (closeTag && isPartialTagPrefix(rest, [closeTag])) {
      state.carry = rest;
      break;
    }
    out.push({ type: 'think', text: '<' });
    i = lt + 1;
  }

  return mergeAdjacent(out);
}

/** 流结束时把残留 carry 冲掉（当作当前 mode 的正文） */
export function flushCottageThinkingCarry(
  state: CottageThinkStreamState,
): CottageThinkingPart | null {
  if (!state.carry) return null;
  const text = state.carry;
  state.carry = '';
  return { type: state.mode, text };
}

function findTagAtStart(
  text: string,
  type: keyof ThinkingTag,
): ThinkingTag | undefined {
  return THINKING_TAGS.find((tag) => text.startsWith(tag[type]));
}

function isPartialTagPrefix(text: string, tags: string[]): boolean {
  return tags.some((tag) => text.length < tag.length && tag.startsWith(text));
}

function mergeAdjacent(parts: CottageThinkingPart[]): CottageThinkingPart[] {
  const merged: CottageThinkingPart[] = [];
  for (const part of parts) {
    if (!part.text) continue;
    const last = merged[merged.length - 1];
    if (last && last.type === part.type) {
      last.text += part.text;
    } else {
      merged.push({ ...part });
    }
  }
  return merged;
}
