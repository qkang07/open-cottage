import { describe, expect, it } from 'vitest';
import {
  appendAssistantThink,
  appendAssistantText,
  collapseThinkSectionsForDisplay,
  createAssistantMessage,
  finalizeAssistantStreaming,
  mergeAdjacentThinkSections,
  sealAssistantTextStreaming,
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

  it('merges adjacent reasoning streams into one think section', () => {
    const msg = createAssistantMessage();
    appendAssistantThink(msg, 'first thought');
    sealAssistantTextStreaming(msg);
    appendAssistantThink(msg, 'second thought');
    finalizeAssistantStreaming(msg);

    expect(msg.sections).toEqual([
      {
        type: 'think',
        text: 'first thought\n\nsecond thought',
        streaming: false,
      },
    ]);
  });

  it('keeps reasoning separated across a tool-call boundary', () => {
    const sections = mergeAdjacentThinkSections([
      { type: 'think', text: 'before tool' },
      {
        type: 'call',
        id: 'call-1',
        name: 'readFile',
        arguments: '{}',
      },
      { type: 'think', text: 'after tool' },
    ]);

    expect(sections.filter((section) => section.type === 'think')).toHaveLength(2);
  });

  it('uses one collapsed thinking section in chat even across tool calls', () => {
    const sections = collapseThinkSectionsForDisplay([
      { type: 'think', text: 'before tool' },
      {
        type: 'call',
        id: 'call-1',
        name: 'readFile',
        arguments: '{}',
      },
      { type: 'think', text: 'after tool', streaming: true },
      { type: 'content', text: 'answer' },
    ]);

    expect(sections).toEqual([
      {
        type: 'think',
        text: 'before tool\n\nafter tool',
        streaming: true,
      },
      {
        type: 'call',
        id: 'call-1',
        name: 'readFile',
        arguments: '{}',
      },
      { type: 'content', text: 'answer' },
    ]);
  });
});
