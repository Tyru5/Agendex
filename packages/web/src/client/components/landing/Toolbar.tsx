import { useState, type MouseEvent, type ReactNode } from 'react';
import { ThemeToggleButton } from './ThemeToggleButton.tsx';

export const LANDING_LINKS = [
  { href: '/download', label: 'Download' },
  { href: '/docs', label: 'Docs' },
  { href: '/changelog', label: 'Changelog' },
  { href: '/tools', label: 'Stack' },
] as const;

export const GITHUB_URL = 'https://github.com/tyru5/agendex';

export type LandingNavHandlers = {
  onShowDownload?: () => void;
  onShowDocs?: () => void;
  onShowChangelog?: () => void;
  onShowTools?: () => void;
};

/** Returns a click handler that routes in-app when the host supplied one, else lets the anchor navigate. */
export function landingNavClickHandler(
  href: string,
  handlers: LandingNavHandlers,
): ((e: MouseEvent<HTMLAnchorElement>) => void) | undefined {
  const handler =
    href === '/download'
      ? handlers.onShowDownload
      : href === '/docs'
        ? handlers.onShowDocs
        : href === '/changelog'
          ? handlers.onShowChangelog
          : href === '/tools'
            ? handlers.onShowTools
            : undefined;
  if (!handler) return undefined;
  return (e) => {
    if (e.defaultPrevented) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    handler();
  };
}

/**
 * The window toolbar every marketing route shares: brand as the window title,
 * nav as toolbar buttons, theme switch, and the host's auth slot.
 */
export function LandingToolbar({
  current,
  homeHref = '/',
  onHome,
  handlers = {},
  authSlot,
}: {
  /** Path of the current route, for `aria-current`. */
  current?: string;
  homeHref?: string;
  onHome?: (e: MouseEvent<HTMLAnchorElement>) => void;
  handlers?: LandingNavHandlers;
  authSlot?: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  function linkProps(href: string) {
    const handler = landingNavClickHandler(href, handlers);
    return {
      href,
      'aria-current': current === href ? ('page' as const) : undefined,
      onClick: (e: MouseEvent<HTMLAnchorElement>) => {
        handler?.(e);
        setOpen(false);
      },
    };
  }

  return (
    <header className="landing-toolbar-shell">
      <div className="landing-toolbar">
        <a href={homeHref} onClick={onHome} className="landing-toolbar-brand">
          Agendex<em>.</em>
        </a>
        <nav className="landing-toolbar-nav" aria-label="Site">
          {LANDING_LINKS.map((link) => (
            <a key={link.href} className="landing-toolbar-link" {...linkProps(link.href)}>
              {link.label}
            </a>
          ))}
          <a
            className="landing-toolbar-link"
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
        </nav>
        <div className="landing-toolbar-right">
          <ThemeToggleButton />
          {authSlot}
          <button
            type="button"
            className="landing-toolbar-menu landing-action landing-action--secondary landing-action--compact"
            aria-controls="landing-mobile-menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="sr-only">Toggle navigation</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d={open ? 'M6 6l12 12M18 6 6 18' : 'M4 7h16M4 12h16M4 17h16'}
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>
      <div id="landing-mobile-menu" className="landing-mobile-menu" data-open={open}>
        {LANDING_LINKS.map((link) => (
          <a key={link.href} className="landing-toolbar-link" {...linkProps(link.href)}>
            {link.label}
          </a>
        ))}
        <a
          className="landing-toolbar-link"
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub
        </a>
      </div>
    </header>
  );
}

export function DocIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 1.5h5l3 3v10H4z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M9 1.5v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

export function ChevronIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M4 2.5 7.5 6 4 9.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
