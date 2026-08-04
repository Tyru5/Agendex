import { type RefObject, useEffect, useRef } from 'react';
import { PLAN_PATH_COPY_EVENT, PLAN_PATH_OPEN_EVENT } from '../components/PlanPathLink.tsx';

const FOCUSED_ATTR = 'data-path-focused';

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      'button, a, input, textarea, select, summary, [role="button"], [contenteditable="true"]',
    ),
  );
}

/**
 * Keyboard walk over validated path nodes in the rendered plan:
 * j/k move, o/Enter open, y copy, Escape clears focus.
 */
export function usePlanPathNavigation({
  rootRef,
  enabled,
  contentKey,
}: {
  rootRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  /** Resets focus when the rendered plan content changes. */
  contentKey: string;
}) {
  const focusedIndexRef = useRef(-1);

  useEffect(() => {
    focusedIndexRef.current = -1;
    const root = rootRef.current;
    if (!root) return;
    for (const node of Array.from(root.querySelectorAll(`[${FOCUSED_ATTR}]`))) {
      node.removeAttribute(FOCUSED_ATTR);
    }
  }, [contentKey, rootRef]);

  useEffect(() => {
    if (!enabled) return;

    const clearFocus = () => {
      const root = rootRef.current;
      if (!root) return;
      for (const node of Array.from(root.querySelectorAll(`[${FOCUSED_ATTR}]`))) {
        node.removeAttribute(FOCUSED_ATTR);
      }
    };

    const dismissFocus = () => {
      focusedIndexRef.current = -1;
      clearFocus();
    };

    const focusNode = (nodes: Element[], index: number) => {
      clearFocus();
      const node = nodes[index];
      if (!node) return;
      node.setAttribute(FOCUSED_ATTR, 'true');
      node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };

    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      const root = rootRef.current;
      if (!root) return;
      const pathNode =
        event.target instanceof Element ? event.target.closest('[data-agendex-path]') : null;
      if (pathNode && root.contains(pathNode)) {
        // Keep keyboard focus in sync with the path the user clicked so
        // subsequent o/y shortcuts target that file, not a prior j/k selection.
        const nodes = Array.from(root.querySelectorAll('[data-agendex-path]'));
        const index = nodes.indexOf(pathNode);
        if (index >= 0) {
          focusedIndexRef.current = index;
          clearFocus();
          pathNode.setAttribute(FOCUSED_ATTR, 'true');
        }
        return;
      }
      dismissFocus();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTextEntryTarget(event.target)) return;

      const root = rootRef.current;
      if (!root) return;
      const nodes = Array.from(root.querySelectorAll('[data-agendex-path]'));
      if (nodes.length === 0) return;

      const focused = focusedIndexRef.current;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

      if (key === 'j' || key === 'k') {
        const delta = key === 'j' ? 1 : -1;
        const next =
          focused < 0
            ? key === 'j'
              ? 0
              : nodes.length - 1
            : Math.min(nodes.length - 1, Math.max(0, focused + delta));
        focusedIndexRef.current = next;
        focusNode(nodes, next);
        event.preventDefault();
        return;
      }

      if (focused < 0 || !nodes[focused]) return;

      if (key === 'o' || event.key === 'Enter') {
        // Don't steal Enter from buttons/links the user just activated.
        if (event.key === 'Enter' && isInteractiveTarget(event.target)) {
          const pathNode =
            event.target instanceof Element ? event.target.closest('[data-agendex-path]') : null;
          if (!pathNode || pathNode !== nodes[focused]) return;
        }
        nodes[focused].dispatchEvent(new CustomEvent(PLAN_PATH_OPEN_EVENT));
        event.preventDefault();
        return;
      }
      if (key === 'y') {
        nodes[focused].dispatchEvent(new CustomEvent(PLAN_PATH_COPY_EVENT));
        event.preventDefault();
        return;
      }
      if (event.key === 'Escape') {
        dismissFocus();
      }
    };

    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
      clearFocus();
    };
  }, [enabled, rootRef]);
}
