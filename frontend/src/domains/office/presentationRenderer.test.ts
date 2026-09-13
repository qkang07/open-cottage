import { beforeEach, describe, expect, it, vi } from 'vitest';

const workspaceMock = vi.hoisted(() => ({
  readFileBytes: vi.fn(),
  writeFileBytes: vi.fn(),
}));

vi.mock('../../workspace/FileSystemWorkspace', () => ({ workspace: workspaceMock }));

import { renderPresentation } from './presentationRenderer';
import { editPresentationOoxml, inspectPresentation } from './presentationOoxml';

describe('presentation renderer and OOXML editor', () => {
  beforeEach(() => {
    workspaceMock.readFileBytes.mockReset();
    workspaceMock.writeFileBytes.mockReset();
  });

  it('writes real shape, table and chart parts', async () => {
    await renderPresentation('deck.pptx', {
      version: 2,
      slides: [{ layout: 'blank', elements: [
        { id: 'box', type: 'shape', shapeType: 'roundRect', x: 0.8, y: 1, w: 3, h: 1.2, fill: 'EEF2FF' },
        { id: 'table', type: 'table', x: 0.8, y: 2.5, w: 5, h: 2, rows: [['A', 'B'], ['1', '2']] },
        { id: 'chart', type: 'chart', x: 6.2, y: 1.2, w: 6, h: 4.8, chartType: 'radar', categories: ['A', 'B'], series: [{ name: '值', values: [1, 2] }] },
      ] }],
    });
    const bytes = workspaceMock.writeFileBytes.mock.calls[0][1] as Uint8Array;
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(bytes);
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    expect(slideXml).toContain('roundRect');
    expect(slideXml).toContain('<a:tbl>');
    expect(Object.keys(zip.files).some((name) => /^ppt\/charts\/chart\d+\.xml$/.test(name))).toBe(true);
  });

  it('edits generated text in place without rebuilding the package', async () => {
    await renderPresentation('deck.pptx', {
      slides: [{ title: '旧标题', bullets: ['正文'] }],
    });
    let bytes = workspaceMock.writeFileBytes.mock.calls[0][1] as Uint8Array;
    workspaceMock.readFileBytes.mockImplementation(async () => bytes);
    const before = await inspectPresentation('deck.pptx', { includeElements: true });
    const title = before.slides[0].elements.find((item) => item.texts.includes('旧标题'))!;
    workspaceMock.writeFileBytes.mockClear();
    await editPresentationOoxml('deck.pptx', [{
      op: 'updateElement', slideIndex: 1, elementId: title.id, patch: { text: '新标题' },
    }]);
    bytes = workspaceMock.writeFileBytes.mock.calls[0][1] as Uint8Array;
    const after = await inspectPresentation('deck.pptx', { includeElements: true });
    expect(after.slides[0].texts).toContain('新标题');
  });

  it('preserves decorative semantics when a generated deck is read back', async () => {
    await renderPresentation('deck.pptx', {
      theme: { name: 'dark-tech' },
      slides: [{ layout: 'blank', elements: [{
        id: 'ghost-number', type: 'text', text: '01', x: 7, y: 1.5, w: 5, h: 3,
        fontSize: 120, color: '151C31', decorative: true,
      }] }],
    });
    const bytes = workspaceMock.writeFileBytes.mock.calls[0][1] as Uint8Array;
    workspaceMock.readFileBytes.mockImplementation(async () => bytes);
    const inspected = await inspectPresentation('deck.pptx', { includeElements: true });
    const ghost = inspected.slides[0].elements.find((item) => item.name === 'ghost-number');
    expect(ghost?.decorative).toBe(true);
    expect(inspected.warnings.some((warning) => warning.elementId === ghost?.id)).toBe(false);
  });

  it('adds common elements and safely reorders, duplicates, and removes slides', async () => {
    await renderPresentation('deck.pptx', {
      slides: [{ title: '第一页' }, { title: '第二页' }],
    });
    let bytes = workspaceMock.writeFileBytes.mock.calls[0][1] as Uint8Array;
    workspaceMock.readFileBytes.mockImplementation(async () => bytes);
    workspaceMock.writeFileBytes.mockClear();
    await editPresentationOoxml('deck.pptx', [
      { op: 'addElement', slideIndex: 1, element: { id: 'added', type: 'shape', shapeType: 'ellipse', x: 9, y: 5, w: 1, h: 1 } },
      { op: 'duplicateSlide', slideIndex: 1, targetSlideIndex: 2 },
      { op: 'moveSlide', slideIndex: 3, targetSlideIndex: 1 },
      { op: 'removeSlide', slideIndex: 2 },
      { op: 'addSlide', slideIndex: 2, slide: { layout: 'title-body', title: '新增页', bullets: ['内容'] } },
    ]);
    bytes = workspaceMock.writeFileBytes.mock.calls[0][1] as Uint8Array;
    const after = await inspectPresentation('deck.pptx', { includeElements: true });
    expect(after.slides).toHaveLength(3);
    expect(after.slides[1].texts).toContain('新增页');
  });

  it('does not write when an operation cannot be completed', async () => {
    await renderPresentation('deck.pptx', { slides: [{ title: '保留' }] });
    const bytes = workspaceMock.writeFileBytes.mock.calls[0][1] as Uint8Array;
    workspaceMock.readFileBytes.mockImplementation(async (path: string) => {
      if (path === 'missing.png') throw new Error('missing');
      return bytes;
    });
    workspaceMock.writeFileBytes.mockClear();
    await expect(editPresentationOoxml('deck.pptx', [{
      op: 'addElement', slideIndex: 1,
      element: { type: 'image', path: 'missing.png', x: 1, y: 1, w: 2, h: 2 },
    }])).rejects.toThrow('missing');
    expect(workspaceMock.writeFileBytes).not.toHaveBeenCalled();
  });

  it('updates chart caches and the embedded workbook together', async () => {
    await renderPresentation('deck.pptx', {
      slides: [{ layout: 'blank', elements: [{
        id: 'sales', type: 'chart', chartType: 'bar', x: 1, y: 1, w: 8, h: 4,
        categories: ['Q1', 'Q2'], series: [{ name: '收入', values: [1, 2] }],
      }] }],
    });
    let bytes = workspaceMock.writeFileBytes.mock.calls[0][1] as Uint8Array;
    workspaceMock.readFileBytes.mockImplementation(async () => bytes);
    const before = await inspectPresentation('deck.pptx', { includeElements: true });
    const chart = before.slides[0].elements.find((item) => item.type === 'chart')!;
    workspaceMock.writeFileBytes.mockClear();
    await editPresentationOoxml('deck.pptx', [{
      op: 'updateChartData', slideIndex: 1, elementId: chart.id,
      categories: ['Q1', 'Q2'], series: [{ name: '收入', values: [10, 20] }],
    }]);
    bytes = workspaceMock.writeFileBytes.mock.calls[0][1] as Uint8Array;
    const after = await inspectPresentation('deck.pptx', { includeElements: true });
    expect(after.slides[0].elements.find((item) => item.type === 'chart')?.chart?.series[0].values)
      .toEqual([10, 20]);
  });
});
