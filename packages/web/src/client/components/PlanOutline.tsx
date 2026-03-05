import { useScrollSpy } from '../hooks/useScrollSpy.ts';
import type { HeadingEntry } from '../lib/extract-headings.ts';

export function PlanOutline({ headings }: { headings: HeadingEntry[] }) {
  const activeId = useScrollSpy(headings.map((h) => h.id));

  const scrollTo = (id: string) => {
    const container = document.querySelector('.main-scroll');
    const target = document.getElementById(id);
    if (!container || !target) return;
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const top = targetRect.top - containerRect.top + container.scrollTop - 24;
    container.scrollTo({ top, behavior: 'smooth' });
  };

  return (
    <div className="plan-outline-dock">
      {/* Visible hint — tiny pills showing structure exists */}
      <div className="plan-outline-hint" aria-hidden="true">
        {headings.slice(0, 5).map((h) => (
          <div
            key={h.id}
            className="plan-outline-hint-tick"
            data-level={h.level}
            data-active={h.id === activeId || undefined}
          />
        ))}
        {headings.length > 5 && <div className="plan-outline-hint-tick" data-level={2} />}
      </div>

      {/* Slide-in panel */}
      <nav className="plan-outline-panel">
        {headings.map((h) => (
          <button
            key={h.id}
            type="button"
            className="plan-outline-item"
            data-level={h.level}
            data-active={h.id === activeId || undefined}
            onClick={() => scrollTo(h.id)}
          >
            {h.text}
          </button>
        ))}
      </nav>
    </div>
  );
}
