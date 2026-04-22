import { useEffect, useState } from 'react';
import { getVerticalScrollContainer, isViewportScrollContainer } from '../lib/scroll-container.ts';

export function useScrollSpy(headingIds: string[]): string | null {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (!headingIds.length) return;

    const firstId = headingIds[0];
    if (!firstId) return;

    const firstEl =
      document.querySelector(`[data-agendex-anchor="${firstId}"]`) ??
      document.getElementById(firstId);
    if (!firstEl) return;

    const scrollEl = getVerticalScrollContainer(firstEl);
    const observerRoot = isViewportScrollContainer(scrollEl) ? null : scrollEl;
    const searchRoot: ParentNode = observerRoot ?? document;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (visible.length > 0 && visible[0]) {
          setActiveId(visible[0].target.id);
        }
      },
      { root: observerRoot, rootMargin: '0px 0px -80% 0px', threshold: 0 },
    );

    const elements = headingIds.flatMap((id) => {
      const el =
        searchRoot.querySelector(`[data-agendex-anchor="${id}"]`) ??
        searchRoot.querySelector(`#${CSS.escape(id)}`);
      return el ? [el] : [];
    });

    for (const el of elements) observer.observe(el);

    return () => observer.disconnect();
  }, [headingIds]);

  return activeId;
}
