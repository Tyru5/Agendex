import type { MouseEvent, ReactNode } from 'react';
import { GitHubIcon } from '../OAuthIcons.tsx';
import { ThemeToggleButton } from './ThemeToggleButton.tsx';

/**
 * Shared chrome for the marketing subpages that hang off the landing page
 * (/docs, /download, /changelog, /tools, /terms, /privacy). Every page gets the
 * same frame, navbar, footer, and reading primitives so they read as one site.
 */

const GITHUB_URL = 'https://github.com/tyru5/agendex';

const FOOTER_LINKS = [
  ['/download', 'Download'],
  ['/docs', 'Docs'],
  ['/changelog', 'Changelog'],
  ['/tools', 'Stack'],
  ['/terms', 'Terms'],
  ['/privacy', 'Privacy'],
] as const;

const MONO = "font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace]";

export interface SubpageShellProps {
  children: ReactNode;
  /** Extra class on `<main>` so page-scoped CSS hooks (e.g. `.docs-page`) keep working. */
  pageClass?: string;
  /** Called when the user activates the brand mark or the back link. */
  onBack?: () => void;
  /** Path the brand mark + back link point at. Defaults to "/". */
  homeHref?: string;
  /** Optional links rendered between the brand mark and the theme toggle. */
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
  navLinks,
}: SubpageShellProps) {
  const handleBack = useBackHandler(onBack);
  const mainClass = ['landing-page', 'landing-subpage', pageClass].filter(Boolean).join(' ');

  return (
    <main className={mainClass}>
      <div className="landing-frame flex min-h-[100dvh] flex-col px-[clamp(18px,5vw,72px)]">
        <nav className="flex min-h-[64px] items-center justify-between gap-4 border-b border-[var(--landing-border-subtle)]">
          <a
            href={homeHref}
            onClick={handleBack}
            className="text-[15px] font-bold text-[var(--landing-text)] no-underline"
          >
            Agendex<span className="text-[var(--landing-accent)]">.</span>
          </a>
          <div className="flex items-center gap-4">
            {navLinks}
            <ThemeToggleButton />
            <a
              href={homeHref}
              onClick={handleBack}
              className="landing-action landing-action--secondary landing-action--compact"
            >
              <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none">
                <path
                  d="M19 12H5M12 5l-7 7 7 7"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Back
            </a>
          </div>
        </nav>

        <div className="flex-1 py-[clamp(40px,6vw,64px)]">{children}</div>

        <footer className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-[var(--landing-border-subtle)] py-6 text-[12.5px] text-[var(--landing-muted)]">
          <span>© 2026 Agendex</span>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {FOOTER_LINKS.map(([href, label]) => (
              <a
                key={href}
                href={href}
                className="font-semibold text-[var(--landing-muted)] no-underline transition-colors duration-150 hover:text-[var(--landing-text)]"
              >
                {label}
              </a>
            ))}
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 font-semibold text-[var(--landing-muted)] no-underline transition-colors duration-150 hover:text-[var(--landing-text)]"
            >
              <GitHubIcon size={13} />
              GitHub
            </a>
          </div>
        </footer>
      </div>
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
    <header className="mb-10 max-w-[720px] max-sm:mb-8">
      <h1 className="m-0 text-balance text-[36px] font-[760] leading-[1.05] tracking-[-0.03em] text-[var(--landing-text)] max-sm:text-[30px]">
        {title}
      </h1>
      {lede && (
        <p className="mt-4 mb-0 max-w-[58ch] text-pretty text-[15px] leading-[1.7] text-[var(--landing-muted)]">
          {lede}
        </p>
      )}
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
      className={`scroll-mt-24 border-t border-[var(--landing-border-subtle)] first:border-t-0 first:pt-0 ${
        dense ? 'py-8' : 'py-12 max-sm:py-10'
      }`}
    >
      <h2
        className={`m-0 font-[740] tracking-[-0.02em] text-[var(--landing-text)] ${
          dense ? 'text-[20px] leading-[1.2]' : 'text-[24px] leading-[1.1]'
        }`}
      >
        {title}
      </h2>
      <div className={`grid ${dense ? 'mt-3 gap-3' : 'mt-5 gap-4'}`}>{children}</div>
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
    <div className="max-w-[68ch] rounded-[8px] border border-[var(--landing-border)] bg-[var(--landing-surface)] px-4 py-3 text-[13px] leading-[1.65] text-[var(--landing-muted)]">
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
      className="font-semibold text-[var(--landing-text)] underline decoration-[var(--landing-border-strong)] underline-offset-[3px] transition-colors duration-150 hover:decoration-[var(--landing-accent)]"
    >
      {children}
    </a>
  );
}

export function InlineCode({ children }: { children: ReactNode }) {
  return (
    <code
      className={`rounded-[4px] border border-[var(--landing-border-subtle)] bg-[color-mix(in_oklch,var(--landing-bg)_78%,transparent)] px-1.5 py-0.5 ${MONO} text-[12px] text-[var(--landing-text)]`}
    >
      {children}
    </code>
  );
}

export function CodeBlock({ children }: { children: ReactNode }) {
  return (
    <code
      className={`block overflow-x-auto whitespace-pre rounded-[7px] border border-[var(--landing-border-subtle)] bg-[color-mix(in_oklch,var(--landing-bg)_78%,transparent)] px-3 py-2.5 ${MONO} text-[12.5px] leading-[1.65] text-[var(--landing-accent)]`}
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
    <ol className="m-0 grid max-w-[68ch] list-none gap-2.5 p-0">
      {items.map((item, index) => (
        <li
          // Steps are positional by definition; index is the identity here.
          // oxlint-disable-next-line react/no-array-index-key
          key={index}
          className="flex items-baseline gap-3 text-[13.5px] leading-[1.65] text-[var(--landing-muted)]"
        >
          <span className="w-4 shrink-0 text-[12px] font-semibold tabular-nums text-[var(--landing-faint)]">
            {index + 1}
          </span>
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
