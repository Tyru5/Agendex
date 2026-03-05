import { useEffect, useRef, useState } from 'react';
import { useTheme } from '../hooks/useTheme.ts';
import type { ThemePreference } from './ThemeProvider.tsx';

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

function SunMoonIcon({ resolved }: { resolved: 'light' | 'dark' }) {
  if (resolved === 'dark') {
    return (
      <svg
        aria-hidden="true"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={2}
        stroke="currentColor"
        className="w-[14px] h-[14px]"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 8.002-4.248 1 1 0 0 0 1-1.75Z"
        />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      className="w-[14px] h-[14px]"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"
      />
    </svg>
  );
}

export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Toggle theme"
        onClick={() => setOpen((v) => !v)}
        className="w-[30px] h-[30px] rounded-lg border border-border text-text cursor-pointer flex items-center justify-center"
        style={{
          background: open ? 'var(--hover)' : 'transparent',
        }}
      >
        <SunMoonIcon resolved={resolvedTheme} />
      </button>

      {open && (
        <div className="absolute top-[calc(100%+6px)] right-0 min-w-[140px] bg-surface border border-border rounded-[10px] p-1 shadow-[0_8px_24px_rgba(0,0,0,0.12)] z-[100]">
          {OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                setTheme(opt.value);
                setOpen(false);
              }}
              className="w-full flex items-center justify-between gap-2 p-[7px_10px] text-[12.5px] font-[inherit] rounded-[7px] border-0 cursor-pointer"
              style={{
                fontWeight: theme === opt.value ? 550 : 400,
                background: theme === opt.value ? 'var(--hover)' : 'transparent',
                color: theme === opt.value ? 'var(--text)' : 'var(--secondary)',
              }}
            >
              {opt.label}
              {theme === opt.value && (
                <svg
                  aria-hidden="true"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2.5}
                  stroke="currentColor"
                  className="w-3 h-3"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
