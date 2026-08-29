import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react';
import { useScrollSpy } from '../hooks/useScrollSpy.ts';
import type { OutlineEntry } from '../lib/extract-headings.ts';
import { getVerticalScrollContainer, isViewportScrollContainer } from '../lib/scroll-container.ts';

const ITEM_SPACING = 8;

function resolveIndexFromPointer(
  itemCount: number,
  railTop: number,
  railHeight: number,
  pointerY: number,
): number {
  if (itemCount <= 1 || railHeight <= 0) return 0;
  const progress = Math.max(0, Math.min(1, (pointerY - railTop) / railHeight));
  return Math.round(progress * (itemCount - 1));
}

function getSectionPreview(id: string): string {
  const target =
    document.querySelector(`[data-agendex-anchor="${id}"]`) ?? document.getElementById(id);
  if (!target) return '';

  const parts: string[] = [];
  let sibling = target.nextElementSibling;
  while (sibling && parts.join(' ').length < 220) {
    if (/^H[1-4]$/.test(sibling.tagName) || sibling.hasAttribute('data-agendex-anchor')) break;
    const text = sibling.textContent?.trim().replace(/\s+/g, ' ');
    if (text) parts.push(text);
    sibling = sibling.nextElementSibling;
  }

  const preview = parts.join(' ');
  return preview.length > 220 ? `${preview.slice(0, 217).trimEnd()}…` : preview;
}

type PlanOutlineProps = {
  entries: OutlineEntry[];
  hidden?: boolean;
};

export function PlanOutline({ entries, hidden }: PlanOutlineProps) {
  const activeId = useScrollSpy(entries.map((entry) => entry.id));
  const dockRef = useRef<HTMLElement | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [dockLeft, setDockLeft] = useState(12);
  const hasEnoughEntries = entries.filter((entry) => entry.source !== 'fallback_root').length >= 2;
  const activeIndex = Math.max(
    0,
    entries.findIndex((entry) => entry.id === activeId),
  );

  useLayoutEffect(() => {
    const mainPane = dockRef.current?.closest('.agendex-main-pane');
    if (!mainPane) return;

    const updatePosition = () => setDockLeft(mainPane.getBoundingClientRect().left + 12);
    updatePosition();

    const observer = new ResizeObserver(updatePosition);
    observer.observe(mainPane);
    window.addEventListener('resize', updatePosition);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updatePosition);
    };
  }, [hasEnoughEntries]);

  useEffect(() => {
    if (hidden) setHoveredIndex(null);
  }, [hidden]);

  const scrollTo = (index: number) => {
    const id = entries[index]?.id;
    if (!id) return;
    const target =
      document.querySelector(`[data-agendex-anchor="${id}"]`) ?? document.getElementById(id);
    if (!target) return;
    const container = getVerticalScrollContainer(target);
    const offset = 24;
    if (isViewportScrollContainer(container)) {
      const top = target.getBoundingClientRect().top + container.scrollTop - offset;
      container.scrollTo({ top, behavior: 'smooth' });
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const top = targetRect.top - containerRect.top + container.scrollTop - offset;
    container.scrollTo({ top, behavior: 'smooth' });
  };

  const indexFromMouseEvent = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return resolveIndexFromPointer(entries.length, rect.top, rect.height, event.clientY);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const current = hoveredIndex ?? activeIndex;
    let next = current;
    if (event.key === 'ArrowUp') next = Math.max(0, current - 1);
    else if (event.key === 'ArrowDown') next = Math.min(entries.length - 1, current + 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = entries.length - 1;
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      scrollTo(current);
      return;
    } else return;

    event.preventDefault();
    setHoveredIndex(next);
  };

  const naturalHeight = Math.max(2, (entries.length - 1) * ITEM_SPACING + 2);
  const previewEntry = hoveredIndex === null ? null : entries[hoveredIndex];
  const previewText = previewEntry ? getSectionPreview(previewEntry.id) : '';
  const previewPosition =
    hoveredIndex === null || entries.length <= 1 ? 0 : (hoveredIndex / (entries.length - 1)) * 100;
  const previewTransform =
    hoveredIndex === 0 ? '0%' : hoveredIndex === entries.length - 1 ? '-100%' : '-50%';
  const style = {
    '--plan-outline-left': `${dockLeft}px`,
    '--plan-outline-height': `${naturalHeight}px`,
  } as CSSProperties;

  if (!hasEnoughEntries) return null;

  return (
    <nav
      ref={dockRef}
      className="plan-outline-dock"
      data-hovered={hoveredIndex === null ? undefined : 'true'}
      data-hidden={hidden || undefined}
      aria-label="Plan outline"
      aria-hidden={hidden || undefined}
      style={style}
      onMouseLeave={() => setHoveredIndex(null)}
    >
      <button
        type="button"
        className="plan-outline-rail"
        aria-label="Plan outline. Use arrow keys to choose a section and Enter to navigate."
        tabIndex={hidden ? -1 : 0}
        onMouseMove={(event) => setHoveredIndex(indexFromMouseEvent(event))}
        onClick={(event) => scrollTo(indexFromMouseEvent(event))}
        onFocus={() => setHoveredIndex(activeIndex)}
        onBlur={() => setHoveredIndex(null)}
        onKeyDown={handleKeyDown}
      >
        {entries.map((entry, index) => {
          const distance = hoveredIndex === null ? null : Math.abs(index - hoveredIndex);
          return (
            <span
              key={entry.id}
              className="plan-outline-tick"
              data-distance={distance !== null && distance <= 2 ? distance : undefined}
              data-in-view={index === activeIndex || undefined}
              style={{ top: `${entries.length <= 1 ? 0 : (index / (entries.length - 1)) * 100}%` }}
              aria-hidden="true"
            />
          );
        })}
      </button>

      {previewEntry && (
        <div
          className="plan-outline-preview"
          style={{ top: `${previewPosition}%`, transform: `translateY(${previewTransform})` }}
          aria-hidden="true"
        >
          <div className="plan-outline-preview-title">{previewEntry.text}</div>
          {previewText && <div className="plan-outline-preview-text">{previewText}</div>}
        </div>
      )}
    </nav>
  );
}
