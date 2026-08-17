import { describe, expect, it } from 'vitest';
import {
  createCottageThinkStreamState,
  extractThinkingFromContent,
  feedCottageThinkingChunk,
  flushCottageThinkingCarry,
  splitCottageThinking,
} from './cottageThinking';

describe('splitCottageThinking', () => {
  it('returns plain content unchanged', () => {
    expect(splitCottageThinking('hello')).toEqual([
      { type: 'content', text: 'hello' },
    ]);
  });

  it('splits think and content', () => {
    const text =
      '<cottage_thinking>\nwhy\n</cottage_thinking>\n\nanswer';
    expect(splitCottageThinking(text)).toEqual([
      { type: 'think', text: '\nwhy\n' },
      { type: 'content', text: '\n\nanswer' },
    ]);
  });

  it('extractThinkingFromContent strips tags', () => {
    expect(
      extractThinkingFromContent(
        '<cottage_thinking>\nwhy\n</cottage_thinking>\n\nanswer',
      ),
    ).toEqual({ content: 'answer', thinking: 'why' });
  });

  it('recognizes MiniMax thinking tags and removes orphan closing tags', () => {
    expect(
      extractThinkingFromContent(
        '<mm:think>plan</mm:think>\nanswer</mm:think>',
      ),
    ).toEqual({ content: 'answer', thinking: 'plan' });
  });
});

describe('feedCottageThinkingChunk', () => {
  it('handles tags split across chunks', () => {
    const state = createCottageThinkStreamState();
    const a = feedCottageThinkingChunk(state, '<cottage_thin');
    expect(a).toEqual([]);
    expect(state.carry).toBe('<cottage_thin');

    const b = feedCottageThinkingChunk(state, 'king>\nidea');
    expect(b).toEqual([{ type: 'think', text: '\nidea' }]);
    expect(state.mode).toBe('think');

    const c = feedCottageThinkingChunk(state, '</cottage_thinking>\nHi');
    expect(c).toEqual([
      { type: 'content', text: '\nHi' },
    ]);
    expect(state.mode).toBe('content');
  });

  it('handles MiniMax tags split across chunks', () => {
    const state = createCottageThinkStreamState();
    expect(feedCottageThinkingChunk(state, '<mm:thi')).toEqual([]);
    expect(feedCottageThinkingChunk(state, 'nk>plan</mm:think>answer')).toEqual([
      { type: 'think', text: 'plan' },
      { type: 'content', text: 'answer' },
    ]);
    expect(state.mode).toBe('content');
  });

  it('flushes incomplete tag carry as content', () => {
    const state = createCottageThinkStreamState();
    feedCottageThinkingChunk(state, 'a <cot');
    const flushed = flushCottageThinkingCarry(state);
    expect(flushed).toEqual({ type: 'content', text: '<cot' });
  });

  it('keeps normal < in content', () => {
    const state = createCottageThinkStreamState();
    expect(feedCottageThinkingChunk(state, 'a < b')).toEqual([
      { type: 'content', text: 'a < b' },
    ]);
  });
});
