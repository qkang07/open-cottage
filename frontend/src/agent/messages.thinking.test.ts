import { describe, expect, it } from 'vitest';
import {
  appendAssistantText,
  createAssistantMessage,
  finalizeAssistantStreaming,
} from './messages';

describe('appendAssistantText cottage_thinking', () => {
  it('routes tagged thinking into think section during stream', () => {
    const msg = createAssistantMessage();
    appendAssistantText(msg, '<cottage_thinking>\nplan');
    appendAssistantText(msg, '\n</cottage_thinking>\n\n结果');
    finalizeAssistantStreaming(msg);

    const thinks = msg.sections.filter((s) => s.type === 'think');
    const contents = msg.sections.filter((s) => s.type === 'content');
    expect(thinks).toHaveLength(1);
    expect(thinks[0].type === 'think' && thinks[0].text.trim()).toBe('plan');
    expect(contents).toHaveLength(1);
    expect(contents[0].type === 'content' && contents[0].text.trim()).toBe(
      '结果',
    );
    expect(msg._thinkStream).toBeUndefined();
  });

  it('routes MiniMax tagged thinking into a think section during stream', () => {
    const msg = createAssistantMessage();
    appendAssistantText(msg, '<mm:think>plan');
    appendAssistantText(msg, '</mm:think>result');
    finalizeAssistantStreaming(msg);

    const thinks = msg.sections.filter((s) => s.type === 'think');
    const contents = msg.sections.filter((s) => s.type === 'content');
    expect(thinks).toHaveLength(1);
    expect(thinks[0].type === 'think' && thinks[0].text).toBe('plan');
    expect(contents).toHaveLength(1);
    expect(contents[0].type === 'content' && contents[0].text).toBe('result');
  });
});
