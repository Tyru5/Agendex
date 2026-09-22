import { useTheme } from '../../hooks/useTheme.ts';

function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M16.4 12.6A6.4 6.4 0 0 1 7.4 3.6 6.7 6.7 0 1 0 16.4 12.6Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="4" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M10 1.5v2M10 16.5v2M18.5 10h-2M3.5 10h-2M16 4l-1.4 1.4M5.4 14.6 4 16M16 16l-1.4-1.4M5.4 5.4 4 4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Light/dark switch used by the landing navbar and every marketing subpage. */
export function ThemeToggleButton() {
  const { resolvedTheme, setTheme } = useTheme();
  const next = resolvedTheme === 'dark' ? 'light' : 'dark';

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className="inline-flex size-[30px] shrink-0 items-center justify-center rounded-[7px] border-0 bg-transparent p-0 text-[var(--landing-muted)] transition-colors duration-150 hover:text-[var(--landing-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--landing-accent)]"
    >
      {resolvedTheme === 'dark' ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}
