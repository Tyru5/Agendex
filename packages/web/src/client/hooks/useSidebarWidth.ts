import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'agendex_sidebar_width';
const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 200;
const MAX_WIDTH = 500;

export {
  DEFAULT_WIDTH as SIDEBAR_DEFAULT_WIDTH,
  MIN_WIDTH as SIDEBAR_MIN_WIDTH,
  MAX_WIDTH as SIDEBAR_MAX_WIDTH,
};

export function useSidebarWidth() {
  const [width, setWidth] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = Number(stored);
      if (Number.isFinite(parsed)) {
        return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, parsed));
      }
    }
    return DEFAULT_WIDTH;
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(width));
  }, [width]);

  const setSidebarWidth = useCallback((w: number) => {
    setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w)));
  }, []);

  return [width, setSidebarWidth] as const;
}
