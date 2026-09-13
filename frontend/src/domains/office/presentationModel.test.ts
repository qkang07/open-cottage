import { describe, expect, it } from 'vitest';
import { buildPresentationScene, PRESENTATION_LAYOUTS } from './presentationModel';

describe('presentation scene model', () => {
  it('keeps the legacy title and bullets contract', () => {
    const scene = buildPresentationScene({
      slides: [
        { title: '封面', subtitle: '副标题' },
        { title: '结论', bullets: ['要点一', '要点二'] },
      ],
    });
    expect(scene.slides).toHaveLength(2);
    expect(scene.slides[0].elements.some((item) => item.id === 'title')).toBe(true);
    expect(scene.slides[1].elements.find((item) => item.id === 'body')?.text).toContain('要点一');
  });

  it('normalizes every semantic layout into bounded scene elements', () => {
    for (const layout of PRESENTATION_LAYOUTS) {
      const scene = buildPresentationScene({
        theme: { name: 'product-vibrant' },
        slides: [{
          layout,
          title: layout,
          subtitle: '说明',
          bullets: ['A', 'B'],
          items: [
            { title: 'A', value: '42%', text: 'Alpha', path: 'assets/a.png' },
            { title: 'B', value: '18%', text: 'Beta' },
          ],
          quote: 'Quote',
          attribution: 'Open Cottage',
        }],
      });
      expect(scene.slides[0].elements.every((item) =>
        item.x >= 0 && item.y >= 0 && item.x + item.w <= 13.333 && item.y + item.h <= 7.5,
      )).toBe(true);
    }
  });

  it('rejects duplicate explicit element ids before writing', () => {
    expect(() => buildPresentationScene({
      slides: [{ layout: 'blank', elements: [
        { id: 'same', type: 'text', text: 'A' },
        { id: 'same', type: 'shape', shapeType: 'rect' },
      ] }],
    })).toThrow('重复元素 id');
  });

  it('keeps intentional ghost text out of readability warnings', () => {
    const scene = buildPresentationScene({
      theme: { name: 'dark-tech' },
      slides: [{
        layout: 'blank',
        elements: [
          { id: 'ghost', type: 'text', text: '01', x: 7, y: 1, w: 5, h: 3, fontSize: 120, color: '151C31', decorative: true },
          { id: 'title', type: 'text', text: '章节标题', x: 1, y: 2.5, w: 8, h: 1, color: 'E5E7EB' },
        ],
      }],
    });
    expect(scene.warnings.some((warning) => warning.elementId === 'ghost')).toBe(false);
  });

  it('warns when most content slides reuse one semantic layout', () => {
    const scene = buildPresentationScene({
      slides: [
        { layout: 'cover', title: '封面' },
        ...Array.from({ length: 4 }, (_, index) => ({
          layout: 'metric-cards' as const,
          title: `指标 ${index + 1}`,
          items: [{ value: `${index + 1}`, label: '结果' }],
        })),
        { layout: 'timeline', title: '时间线', items: [{ title: '现在' }] },
      ],
    });
    expect(scene.warnings.some((warning) => warning.code === 'repetitive_layout')).toBe(true);
  });
});
