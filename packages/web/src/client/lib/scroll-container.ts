/** Nearest ancestor (or document) that actually scrolls the given element vertically. */
export function getVerticalScrollContainer(from: Element): HTMLElement {
  for (let el: Element | null = from; el; el = el.parentElement) {
    if (!(el instanceof HTMLElement)) continue;
    const { overflowY } = getComputedStyle(el);
    if (overflowY !== 'auto' && overflowY !== 'scroll' && overflowY !== 'overlay') continue;
    if (el === document.documentElement || el === document.body) {
      const se = document.scrollingElement;
      return se instanceof HTMLElement ? se : document.documentElement;
    }
    if (el.scrollHeight > el.clientHeight) {
      return el;
    }
  }
  const se = document.scrollingElement;
  return se instanceof HTMLElement ? se : document.documentElement;
}

export function isViewportScrollContainer(el: HTMLElement): boolean {
  const root = document.scrollingElement ?? document.documentElement;
  return el === root || el === document.body || el === document.documentElement;
}
