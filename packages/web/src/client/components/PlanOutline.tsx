import { useScrollSpy } from '../hooks/useScrollSpy.ts';
import type { OutlineEntry } from '../lib/extract-headings.ts';

export function PlanOutline({ entries, pinned }: { entries: OutlineEntry[]; pinned?: boolean }) {
  const activeId = useScrollSpy(entries.map((entry) => entry.id));

  const scrollTo = (id: string) => {
    const container = document.querySelector('.main-scroll');
    const target =
      document.querySelector(`[data-agendex-anchor="${id}"]`) ?? document.getElementById(id);
    if (!container || !target) return;
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const top = targetRect.top - containerRect.top + container.scrollTop - 24;
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
