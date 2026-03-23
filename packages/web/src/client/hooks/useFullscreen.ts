import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';

// Vendor-prefix detection (standard + webkit for Safari < 16.4)
interface FullscreenAPI {
  requestFullscreen: string;
  exitFullscreen: string;
  fullscreenElement: string;
  fullscreenEnabled: string;
  fullscreenchange: string;
}

const methodMap: [string, string, string, string, string][] = [
  [
    'requestFullscreen',
    'exitFullscreen',
    'fullscreenElement',
    'fullscreenEnabled',
    'fullscreenchange',
  ],
  [
    'webkitRequestFullscreen',
    'webkitExitFullscreen',
    'webkitFullscreenElement',
    'webkitFullscreenEnabled',
    'webkitfullscreenchange',
  ],
];

function detectAPI(): FullscreenAPI | null {
  if (typeof document === 'undefined') return null;
  for (const m of methodMap) {
    if (m[1] in document) {
      return {
        requestFullscreen: m[0],
        exitFullscreen: m[1],
        fullscreenElement: m[2],
        fullscreenEnabled: m[3],
        fullscreenchange: m[4],
      };
    }
  }
  return null;
}

const fsAPI = detectAPI();

export function useFullscreen<T extends HTMLElement = HTMLElement>(): {
  ref: RefObject<T | null>;
  isFullscreen: boolean;
  isSupported: boolean;
  enter: () => Promise<void>;
  exit: () => Promise<void>;
  toggle: () => Promise<void>;
} {
  const ref = useRef<T | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const isSupported = Boolean(fsAPI && (document as any)[fsAPI.fullscreenEnabled]);

  useEffect(() => {
    if (!fsAPI) return;

    const handleChange = () => {
      const el = (document as any)[fsAPI.fullscreenElement];
      setIsFullscreen(el === ref.current);
    };

    document.addEventListener(fsAPI.fullscreenchange, handleChange);
    return () => document.removeEventListener(fsAPI.fullscreenchange, handleChange);
  }, []);

  const enter = useCallback(async () => {
    if (!fsAPI || !ref.current) return;
    try {
      await (ref.current as any)[fsAPI.requestFullscreen]();
    } catch {
      setIsFullscreen(false);
    }
  }, []);

  const exit = useCallback(async () => {
    if (!fsAPI) return;
    const el = (document as any)[fsAPI.fullscreenElement];
    if (!el) return;
    try {
      await (document as any)[fsAPI.exitFullscreen]();
    } catch {}
  }, []);

  const toggle = useCallback(async () => {
    const el = (document as any)?.[fsAPI?.fullscreenElement ?? ''];
    if (el === ref.current) {
      await exit();
    } else {
      await enter();
    }
  }, [enter, exit]);

  return { ref, isFullscreen, isSupported, enter, exit, toggle };
}
