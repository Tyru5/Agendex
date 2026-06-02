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

function highlightFirstQuote(root: HTMLElement, annotation: PlanAnnotationRecord): boolean {
  const quote = annotationQuote(annotation);
  if (!quote) return false;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (shouldSkipNode(node)) return NodeFilter.FILTER_REJECT;
      const text = node.textContent ?? '';
      return text.includes(quote) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });

  const node = walker.nextNode();
  if (!node || !node.textContent) return false;

  const index = node.textContent.indexOf(quote);
  if (index < 0) return false;

  const range = document.createRange();
  range.setStart(node, index);
  range.setEnd(node, index + quote.length);

  const mark = document.createElement('mark');
  mark.dataset.agendexAnnotationId = annotation.id;
  mark.className = `plan-annotation-mark plan-annotation-mark--${annotation.type}`;
  mark.setAttribute('tabindex', '0');
  mark.setAttribute('role', 'button');
  mark.setAttribute('aria-label', `Plan annotation: ${annotation.type.replace('_', ' ')}`);

  range.surroundContents(mark);
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
