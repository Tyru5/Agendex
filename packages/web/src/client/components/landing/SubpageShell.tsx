import type { MouseEvent, ReactNode } from 'react';
import { GitHubIcon } from '../OAuthIcons.tsx';
import { useTheme } from '../../hooks/useTheme.ts';
import { DexMascot } from './DexMascot.tsx';
import { ChevronIcon, GITHUB_URL, LANDING_LINKS, LandingToolbar } from './Toolbar.tsx';

/**
 * Shared chrome for the marketing subpages that hang off the landing page
 * (/docs, /download, /changelog, /tools, /terms, /privacy): the same window
 * toolbar, a reading region, and the status-bar footer, plus the reading
 * primitives every page composes from.
 */

const MONO = "font-['JetBrains_Mono','SF_Mono',ui-monospace,monospace]";

export interface SubpageShellProps {
  children: ReactNode;
  /** Extra class on `<main>` so page-scoped CSS hooks (e.g. `.docs-page`) keep working. */
  pageClass?: string;
  /** Called when the user activates the brand mark or the back link. */
  onBack?: () => void;
  /** Path the brand mark + back link point at. Defaults to "/". */
  homeHref?: string;
  /** Path of this route, for the toolbar's current-page state. */
  current?: string;
  /** Optional links rendered next to the theme toggle. */
  navLinks?: ReactNode;
}

export function useBackHandler(onBack?: () => void) {
  return function handleBack(e: MouseEvent<HTMLAnchorElement>) {
    if (!onBack) return;
    if (e.defaultPrevented) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    onBack();
  };
}

export function SubpageShell({
  children,
  pageClass,
  onBack,
  homeHref = '/',
  current,
  navLinks,
}: SubpageShellProps) {
  const handleBack = useBackHandler(onBack);
  const { resolvedTheme } = useTheme();
  const mainClass = ['landing-page', 'landing-subpage', pageClass].filter(Boolean).join(' ');
  // `docs-page` -> `/docs`; lets the toolbar mark the current route without every page passing it.
  const currentPath = current ?? (pageClass ? `/${pageClass.replace(/-page$/, '')}` : undefined);
  const currentLabel =
    LANDING_LINKS.find((l) => l.href === currentPath)?.label ??
    (currentPath ? currentPath.slice(1).replace(/^\w/, (c) => c.toUpperCase()) : '');

  return (
    <main className={mainClass}>
      <LandingToolbar
        current={currentPath}
        homeHref={homeHref}
        onHome={handleBack}
        authSlot={navLinks}
      />
      <div className="landing-pathbar" aria-hidden="true">
        <div className="landing-pathbar-crumbs">
          <DexMascot variant={resolvedTheme === 'light' ? 'light' : 'dark'} size={20} decorative />
          <b>Agendex</b>
          <ChevronIcon size={10} />
          <span>{currentLabel}</span>
        </div>
      </div>
      <div className="mx-auto min-h-[calc(100dvh-var(--landing-toolbar)-var(--landing-pathbar))] w-full max-w-[1200px] px-[clamp(16px,4vw,40px)] py-[clamp(36px,5vw,56px)]">
        {children}
      </div>
      <footer className="landing-statusbar border-t border-[var(--landing-border)]">
        <span>© 2026 Agendex</span>
        <nav aria-label="Footer">
          {LANDING_LINKS.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
          <a href="/terms">Terms</a>
          <a href="/privacy">Privacy</a>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5"
          >
            <GitHubIcon size={13} />
            GitHub
          </a>
        </nav>
      </footer>
    </main>
  );
}

export function SubpageHeader({
  title,
  lede,
  meta,
  children,
}: {
  title: ReactNode;
  lede?: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="mb-8 max-w-[720px] max-sm:mb-7">
      <h1 className="landing-h2 text-[clamp(30px,3.6vw,42px)]">{title}</h1>
      {lede && <p className="landing-lede">{lede}</p>}
      {meta && <p className="mt-3 mb-0 text-[12.5px] text-[var(--landing-faint)]">{meta}</p>}
      {children}
    </header>
  );
}

export function SubpageSection({
  id,
  title,
  children,
  dense,
}: {
  id: string;
  title: string;
  children: ReactNode;
  /** Tighter rhythm for long reference documents (legal, reference lists). */
  dense?: boolean;
}) {
  return (
    <section
      id={id}
      className={`scroll-mt-20 border-t border-[var(--landing-border)] first:border-t-0 first:pt-0 ${
        dense ? 'py-7' : 'py-10 max-sm:py-8'
      }`}
    >
      <h2
        className={`m-0 font-[750] tracking-[-0.02em] text-[var(--landing-text)] ${
          dense ? 'text-[19px] leading-[1.2]' : 'text-[23px] leading-[1.1]'
        }`}
      >
        {title}
      </h2>
      <div className={`grid ${dense ? 'mt-3 gap-3' : 'mt-4 gap-4'}`}>{children}</div>
    </section>
  );
}

export function SubHeading({ children }: { children: ReactNode }) {
  return <h3 className="mt-3 mb-0 text-[15px] font-bold text-[var(--landing-text)]">{children}</h3>;
}

export function Body({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 max-w-[68ch] text-pretty text-[13.5px] leading-[1.7] text-[var(--landing-muted)]">
      {children}
    </p>
  );
}

export function Callout({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-[68ch] rounded-[7px] border border-[var(--landing-border)] bg-[var(--landing-surface-raised)] px-4 py-3 text-[13px] leading-[1.65] text-[var(--landing-muted)]">
      {children}
    </div>
  );
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  const external = href.startsWith('http');
  return (
    <a
      href={href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      className="font-semibold text-[var(--landing-accent)] underline decoration-[color-mix(in_oklch,var(--landing-accent)_40%,transparent)] underline-offset-[3px] transition-colors duration-150 hover:decoration-[var(--landing-accent)]"
    >
      {children}
    </a>
  );
}

export function InlineCode({ children }: { children: ReactNode }) {
  return (
    <code
      className={`rounded-[4px] border border-[var(--landing-border-subtle)] bg-[var(--landing-surface-raised)] px-1.5 py-0.5 ${MONO} text-[12px] text-[var(--landing-text)]`}
    >
      {children}
    </code>
  );
}

export function CodeBlock({ children }: { children: ReactNode }) {
  return (
    <code
      className={`block overflow-x-auto whitespace-pre rounded-[6px] border border-[var(--landing-border)] bg-[var(--landing-surface)] px-3 py-2.5 ${MONO} text-[12.5px] leading-[1.65] text-[var(--landing-text)]`}
    >
      {children}
    </code>
  );
}

export function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      className="relative top-[2px] shrink-0 text-[var(--landing-accent)]"
    >
      <path
        d="m5 12 4.5 4.5L19 7"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function NumberedList({ items }: { items: ReadonlyArray<ReactNode> }) {
  return (
    <ol className="landing-list m-0 list-none p-0">
      {items.map((item, index) => (
        <li
          // Steps are positional by definition; index is the identity here.
          // oxlint-disable-next-line react/no-array-index-key
          key={index}
          className="landing-list-row text-[var(--landing-muted)]"
        >
          <b>{index + 1}</b>
          <span>{item}</span>
        </li>
      ))}
    </ol>
  );
}

export function BulletList({ items }: { items: ReadonlyArray<[id: string, content: ReactNode]> }) {
  return (
    <ul className="m-0 grid max-w-[68ch] list-none gap-2 p-0">
      {items.map(([id, content]) => (
        <li
          key={id}
          className="flex items-baseline gap-2.5 text-[13px] leading-[1.6] text-[var(--landing-muted)]"
        >
          <span
            aria-hidden="true"
            className="relative top-[-2px] size-1 shrink-0 rounded-full bg-[var(--landing-faint)]"
          />
          <span>{content}</span>
        </li>
      ))}
    </ul>
  );
}
