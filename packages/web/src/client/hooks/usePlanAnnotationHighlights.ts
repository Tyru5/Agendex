import { useEffect, type RefObject } from 'react';
import type { PlanAnnotationRecord } from '../lib/annotations.ts';

const SKIP_TAGS = new Set(['CODE', 'PRE', 'SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'MARK']);

function unwrapExistingMarks(root: HTMLElement): void {
  const marks = Array.from(root.querySelectorAll('mark[data-agendex-annotation-id]'));
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  }
}

function shouldSkipNode(node: Node): boolean {
  let current = node.parentElement;
  while (current) {
    if (SKIP_TAGS.has(current.tagName)) return true;
    current = current.parentElement;
  }
  return false;
}

function annotationQuote(annotation: PlanAnnotationRecord): string | undefined {
  if (annotation.type === 'global_comment') return undefined;
  return annotation.anchor.quote?.trim() || undefined;
}

type TextSegment = {
  node: Text;
  start: number;
  end: number;
};

function findNthOccurrence(value: string, needle: string, occurrenceIndex: number): number {
  let searchFrom = 0;
  for (let occurrence = 0; occurrence <= occurrenceIndex; occurrence++) {
    const index = value.indexOf(needle, searchFrom);
    if (index < 0) return -1;
    if (occurrence === occurrenceIndex) return index;
    searchFrom = index + needle.length;
  }
  return -1;
}

function createRangeFromTextIndex(
  segments: TextSegment[],
  index: number,
  quoteLength: number,
): Range | null {
  const endIndex = index + quoteLength;
  const startSegment = segments.find((segment) => index >= segment.start && index < segment.end);
  const endSegment = segments.find(
    (segment) => endIndex > segment.start && endIndex <= segment.end,
  );
  if (!startSegment || !endSegment) return null;

  const range = document.createRange();
  range.setStart(startSegment.node, index - startSegment.start);
  range.setEnd(endSegment.node, endIndex - endSegment.start);
  return range;
}

function findQuoteRange(root: HTMLElement, annotation: PlanAnnotationRecord): Range | null {
  const quote = annotationQuote(annotation);
  if (!quote) return null;

  const segments: TextSegment[] = [];
  let textContent = '';

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (shouldSkipNode(node)) return NodeFilter.FILTER_REJECT;
      return node.textContent ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });

  let node = walker.nextNode();
  while (node) {
    const text = node.textContent ?? '';
    segments.push({
      node: node as Text,
      start: textContent.length,
      end: textContent.length + text.length,
    });
    textContent += text;
    node = walker.nextNode();
  }

  const offset = annotation.anchor.startOffset;
  if (
    typeof offset === 'number' &&
    offset >= 0 &&
    textContent.slice(offset, offset + quote.length) === quote
  ) {
    return createRangeFromTextIndex(segments, offset, quote.length);
  }

  const occurrenceIndex = Math.max(0, Math.floor(annotation.anchor.occurrenceIndex ?? 0));
  const index = findNthOccurrence(textContent, quote, occurrenceIndex);
  if (index < 0) return null;

  return createRangeFromTextIndex(segments, index, quote.length);
}

function surroundRange(range: Range, mark: HTMLElement): void {
  try {
    range.surroundContents(mark);
  } catch {
    // surroundContents throws HierarchyRequestError when the range partially
    // intersects an element boundary, such as bold or italic spans in markdown.
    mark.appendChild(range.extractContents());
    range.insertNode(mark);
  }
}

function highlightFirstQuote(root: HTMLElement, annotation: PlanAnnotationRecord): boolean {
  const range = findQuoteRange(root, annotation);
  if (!range) return false;

  const mark = document.createElement('mark');
  mark.dataset.agendexAnnotationId = annotation.id;
  mark.className = `plan-annotation-mark plan-annotation-mark--${annotation.type}`;
  mark.setAttribute('tabindex', '0');
  mark.setAttribute('role', 'button');
  mark.setAttribute('aria-label', `Plan annotation: ${annotation.type.replace('_', ' ')}`);

  surroundRange(range, mark);
  return true;
}

export function usePlanAnnotationHighlights({
  rootRef,
  annotations,
  selectedAnnotationId,
  onSelectAnnotation,
}: {
  rootRef: RefObject<HTMLElement | null>;
  annotations: PlanAnnotationRecord[];
  selectedAnnotationId?: string | null;
  onSelectAnnotation?: (id: string | null) => void;
}) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    unwrapExistingMarks(root);
    for (const annotation of annotations) {
      if (annotation.status === 'resolved') continue;
      highlightFirstQuote(root, annotation);
      if (annotation.id === selectedAnnotationId) {
        const mark = root.querySelector<HTMLElement>(
          `mark[data-agendex-annotation-id="${CSS.escape(annotation.id)}"]`,
        );
        mark?.classList.add('plan-annotation-mark--selected');
      }
    }

    function handleClick(event: MouseEvent) {
      const target = event.target instanceof Element ? event.target : null;
      const mark = target?.closest<HTMLElement>('mark[data-agendex-annotation-id]');
      if (!mark) return;
      onSelectAnnotation?.(mark.dataset.agendexAnnotationId ?? null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const target = event.target instanceof Element ? event.target : null;
      const mark = target?.closest<HTMLElement>('mark[data-agendex-annotation-id]');
      if (!mark) return;
      event.preventDefault();
      onSelectAnnotation?.(mark.dataset.agendexAnnotationId ?? null);
    }

    root.addEventListener('click', handleClick);
    root.addEventListener('keydown', handleKeyDown);

    return () => {
      root.removeEventListener('click', handleClick);
      root.removeEventListener('keydown', handleKeyDown);
      unwrapExistingMarks(root);
    };
  }, [annotations, onSelectAnnotation, rootRef, selectedAnnotationId]);
}
