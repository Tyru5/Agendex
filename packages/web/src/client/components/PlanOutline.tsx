import { useScrollSpy } from '../hooks/useScrollSpy.ts';
import type { OutlineEntry } from '../lib/extract-headings.ts';
import { getVerticalScrollContainer, isViewportScrollContainer } from '../lib/scroll-container.ts';

export function PlanOutline({ entries, pinned }: { entries: OutlineEntry[]; pinned?: boolean }) {
  const activeId = useScrollSpy(entries.map((entry) => entry.id));

  const scrollTo = (id: string) => {
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

  return (
    <div className="plan-outline-dock" data-pinned={pinned || undefined}>
      {/* Visible hint — tiny pills showing structure exists */}
      <div className="plan-outline-hint" aria-hidden="true">
        {entries.slice(0, 5).map((entry) => (
          <div
            key={entry.id}
            className="plan-outline-hint-tick"
            data-level={entry.level}
            data-active={entry.id === activeId || undefined}
          />
        ))}
        {entries.length > 5 && <div className="plan-outline-hint-tick" data-level={2} />}
      </div>

      {/* Slide-in panel */}
      <nav className="plan-outline-panel">
        {entries.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="plan-outline-item"
            data-level={entry.level}
            data-active={entry.id === activeId || undefined}
            onClick={() => scrollTo(entry.id)}
          >
            {entry.text}
          </button>
        ))}
      </nav>
    </div>
  );
}
