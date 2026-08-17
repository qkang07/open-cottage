import type {
  PresentationAnchor,
  SpreadsheetAnchor,
  TextAnchor,
  WordAnchor,
} from './fileReferences';
import {
  normalizeSpreadsheetAnchor,
  textAnchorFromOffsets,
  textAnchorFromSnippet,
} from './fileReferences';

const WORD_BLOCK_SELECTOR =
  'p, h1, h2, h3, h4, h5, h6, li, td, th, blockquote, pre';

export const getTextAnchorFromTextarea = (
  source: string,
  start: number,
  end: number,
): TextAnchor | null => {
  if (start === end) return null;
  return textAnchorFromOffsets(source, start, end);
};

export const getTextAnchorFromWindowSelection = (
  source: string,
  root?: HTMLElement | null,
): TextAnchor | null => {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (root && !root.contains(range.commonAncestorContainer)) return null;
  const snippet = sel.toString();
  if (!snippet) return null;
  return textAnchorFromSnippet(source, snippet);
};

export const getWordAnchorFromSelection = (
  container: HTMLElement,
): WordAnchor | null => {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;

  const selectedText = sel.toString().trim();
  const blocks = [
    ...container.querySelectorAll<HTMLElement>(WORD_BLOCK_SELECTOR),
  ];
  if (!blocks.length) {
    if (!selectedText) return null;
    return {
      kind: 'word',
      startParagraph: 1,
      endParagraph: 1,
      selectedText,
    };
  }

  let startParagraph = 0;
  let endParagraph = 0;
  blocks.forEach((block, index) => {
    const para = index + 1;
    if (!rangeIntersectsNode(range, block)) return;
    if (!startParagraph) startParagraph = para;
    endParagraph = para;
  });

  if (!startParagraph) {
    startParagraph = 1;
    endParagraph = 1;
  }

  return {
    kind: 'word',
    startParagraph,
    endParagraph,
    selectedText: selectedText || undefined,
  };
};

export const getPresentationAnchorFromSelection = (
  container: HTMLElement,
): PresentationAnchor | null => {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;

  const selectedText = sel.toString().trim();
  const slideCard = findClosest(
    range.commonAncestorContainer,
    (el) =>
      el instanceof HTMLElement &&
      el.classList.contains('presentation-slide-card'),
  );
  if (!slideCard) return null;

  const title = slideCard.querySelector('.ant-card-head-title')?.textContent ?? '';
  const slideMatch = title.match(/幻灯片\s*(\d+)/);
  const slideIndex = slideMatch ? Number(slideMatch[1]) : 1;

  const listItems = [...slideCard.querySelectorAll('.presentation-slide-texts li')];
  let textIndex: number | undefined;
  listItems.forEach((li, index) => {
    if (rangeIntersectsNode(range, li)) {
      textIndex = index + 1;
    }
  });

  return {
    kind: 'presentation',
    slideIndex,
    textIndex,
    selectedText: selectedText || undefined,
  };
};

export type CellCoord = { row: number; col: number };

export const spreadsheetAnchorFromCells = (
  sheet: string,
  anchor: CellCoord,
  focus: CellCoord,
): SpreadsheetAnchor =>
  normalizeSpreadsheetAnchor(
    sheet,
    anchor.row,
    anchor.col,
    focus.row,
    focus.col,
  );

const rangeIntersectsNode = (range: Range, node: Node): boolean => {
  try {
    return range.intersectsNode(node);
  } catch {
    const nodeRange = document.createRange();
    nodeRange.selectNodeContents(node);
    return (
      range.compareBoundaryPoints(Range.END_TO_START, nodeRange) < 0 &&
      range.compareBoundaryPoints(Range.START_TO_END, nodeRange) > 0
    );
  }
};

const findClosest = (
  node: Node,
  match: (el: HTMLElement) => boolean,
): HTMLElement | null => {
  let current: Node | null = node;
  while (current) {
    if (current instanceof HTMLElement && match(current)) return current;
    current = current.parentNode;
  }
  return null;
};
