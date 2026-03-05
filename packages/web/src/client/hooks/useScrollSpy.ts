import { useEffect, useState } from 'react';

export function useScrollSpy(headingIds: string[]): string | null {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (!headingIds.length) return;

    const root = document.querySelector('.main-scroll') as HTMLElement | null;
    if (!root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (visible.length > 0 && visible[0]) {
          setActiveId(visible[0].target.id);
        }
      },
      { root, rootMargin: '0px 0px -80% 0px', threshold: 0 },
    );

    const elements = headingIds
      .map((id) => root.querySelector(`#${CSS.escape(id)}`))
      .filter(Boolean) as Element[];

    for (const el of elements) observer.observe(el);

    return () => observer.disconnect();
  }, [headingIds]);

  return activeId;
}
