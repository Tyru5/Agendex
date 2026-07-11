import type { MouseEvent, ReactNode } from 'react';
import type { SimpleIcon } from 'simple-icons';
import {
  siBetterauth,
  siBun,
  siCodemirror,
  siConvex,
  siElectron,
  siGithubactions,
  siGsap,
  siHono,
  siMermaid,
  siNodedotjs,
  siOxc,
  siReact,
  siSqlite,
  siStripe,
  siTailwindcss,
  siTypescript,
  siVercel,
  siVite,
  siXyflow,
} from 'simple-icons';
import { GitHubIcon } from './OAuthIcons.tsx';

export interface ToolsUsedPageProps {
  /** Called when the user activates the back link in the header. */
  onBack?: () => void;
  /** Path the brand mark + back affordance link to. Defaults to "/". */
  homeHref?: string;
}

type StackItem = {
  name: string;
  role: string;
  href?: string;
  icon?: SimpleIcon;
};

type StackSection = {
  id: string;
  title: string;
  blurb: string;
  items: StackItem[];
};

const STACK_SECTIONS: StackSection[] = [
  {
    id: 'core',
    title: 'Core platform',
    blurb: 'Language, runtime, and UI foundation shared across OSS, cloud, CLI, and desktop.',
    items: [
      {
        name: 'TypeScript',
        role: 'Typed application language across the monorepo',
        href: 'https://www.typescriptlang.org/',
        icon: siTypescript,
      },
      {
        name: 'Bun',
        role: 'Runtime, package manager, test runner, and local API server',
        href: 'https://bun.sh/',
        icon: siBun,
      },
      {
        name: 'React',
        role: 'Client UI for OSS, Cloud Pro, and marketing pages',
        href: 'https://react.dev/',
        icon: siReact,
      },
      {
        name: 'Vite',
        role: 'Dev server and production bundler for web clients',
        href: 'https://vite.dev/',
        icon: siVite,
      },
      {
        name: 'Tailwind CSS',
        role: 'Utility styling with design tokens in CSS',
        href: 'https://tailwindcss.com/',
        icon: siTailwindcss,
      },
      {
        name: 'Node.js',
        role: 'CLI publish target and compatibility baseline (≥20)',
        href: 'https://nodejs.org/',
        icon: siNodedotjs,
      },
    ],
  },
  {
    id: 'backends',
    title: 'Backends & data',
    blurb: 'Local indexing, cloud sync, auth, and billing surfaces.',
    items: [
      {
        name: 'Hono',
        role: 'Local OSS HTTP + WebSocket API',
        href: 'https://hono.dev/',
        icon: siHono,
      },
      {
        name: 'SQLite',
        role: 'Local plan index and CLI sync caches via better-sqlite3',
        href: 'https://www.sqlite.org/',
        icon: siSqlite,
      },
      {
        name: 'Convex',
        role: 'Cloud backend for plans, sharing, and real-time sync',
        href: 'https://www.convex.dev/',
        icon: siConvex,
      },
      {
        name: 'Better Auth',
        role: 'GitHub/Google OAuth for Cloud Pro',
        href: 'https://www.better-auth.com/',
        icon: siBetterauth,
      },
      {
        name: 'Stripe',
        role: 'Subscriptions and checkout for Cloud Pro',
        href: 'https://stripe.com/',
        icon: siStripe,
      },
      {
        name: 'Electron',
        role: 'Desktop shell with system-browser auth and secure storage',
        href: 'https://www.electronjs.org/',
        icon: siElectron,
      },
    ],
  },
  {
    id: 'product-ui',
    title: 'Product UI libraries',
    blurb: 'Plan viewing, editing, search, charts, and motion.',
    items: [
      {
        name: 'CodeMirror',
        role: 'Markdown plan editor',
        href: 'https://codemirror.net/',
        icon: siCodemirror,
      },
      {
        name: 'React Flow',
        role: 'Technology dependency graphs in plan view',
        href: 'https://reactflow.dev/',
        icon: siXyflow,
      },
      {
        name: 'Mermaid',
        role: 'Diagram rendering inside plan markdown',
        href: 'https://mermaid.js.org/',
        icon: siMermaid,
      },
      {
        name: 'GSAP',
        role: 'Landing and empty-state motion',
        href: 'https://gsap.com/',
        icon: siGsap,
      },
      {
        name: 'Motion',
        role: 'Cloud dashboard transitions and presence',
        href: 'https://motion.dev/',
      },
      {
        name: 'Fuse.js',
        role: 'Client-side plan search ranking',
        href: 'https://www.fusejs.io/',
      },
      {
        name: 'nuqs',
        role: 'URL-synced filters and selection state',
        href: 'https://nuqs.dev/',
      },
      {
        name: 'Wouter',
        role: 'Client routing for the Cloud Pro app',
        href: 'https://github.com/molefrog/wouter',
      },
      {
        name: 'react-markdown',
        role: 'Plan and docs markdown rendering',
        href: 'https://github.com/remarkjs/react-markdown',
      },
      {
        name: 'unified / remark / rehype',
        role: 'Markdown AST parsing, GFM, and sanitize pipeline',
        href: 'https://unifiedjs.com/',
      },
      {
        name: 'Dagre',
        role: 'Graph layout for tech dependency charts',
        href: 'https://github.com/dagrejs/dagre',
      },
      {
        name: 'simple-icons',
        role: 'Brand icons for agents and this stack page',
        href: 'https://simpleicons.org/',
      },
    ],
  },
  {
    id: 'tooling',
    title: 'Tooling & delivery',
    blurb: 'Lint, format, release, CI, and hosting.',
    items: [
      {
        name: 'Oxc (Oxlint / Oxfmt)',
        role: 'Lint and format across the monorepo',
        href: 'https://oxc.rs/',
        icon: siOxc,
      },
      {
        name: 'Changesets',
        role: 'Versioning and CLI release workflow',
        href: 'https://github.com/changesets/changesets',
      },
      {
        name: 'GitHub Actions',
        role: 'CI, CLI publish, and desktop release pipelines',
        href: 'https://github.com/features/actions',
        icon: siGithubactions,
      },
      {
        name: 'Vercel',
        role: 'Cloud Pro web deployment',
        href: 'https://vercel.com/',
        icon: siVercel,
      },
      {
        name: 'electron-builder',
        role: 'macOS desktop packaging and signed releases',
        href: 'https://www.electron.build/',
      },
      {
        name: 'electron-vite',
        role: 'Desktop main/preload build pipeline',
        href: 'https://electron-vite.org/',
      },
    ],
  },
];

const DARK_ICON_HEX = new Set(['000000', '0B100F', '191919', '121212', 'FFFFFF']);

function ToolsShell({ children }: { children: ReactNode }) {
  return (
    <main className="landing-page tools-page min-h-[100dvh]">
      <div className="landing-frame px-[clamp(18px,5vw,72px)] py-[clamp(56px,7vw,88px)]">
        {children}
      </div>
    </main>
  );
}

function Body({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 max-w-[68ch] text-pretty text-[13.5px] leading-[1.7] text-[var(--landing-muted)]">
      {children}
    </p>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section
      id={id}
      className="scroll-mt-24 border-t border-[var(--landing-border-subtle)] py-12 first:border-t-0 first:pt-0"
    >
      <h2 className="m-0 text-[24px] font-[740] leading-[1.1] tracking-[-0.02em] text-[var(--landing-text)]">
        {title}
      </h2>
      <div className="mt-5 grid gap-4">{children}</div>
    </section>
  );
}

function StackIcon({ icon, size = 18 }: { icon: SimpleIcon; size?: number }) {
  const hex = icon.hex.toUpperCase();
  const fill = DARK_ICON_HEX.has(hex) ? 'currentColor' : `#${icon.hex}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      aria-hidden="true"
      className="shrink-0 text-[var(--landing-text)]"
    >
      <path d={icon.path} />
    </svg>
  );
}

function StackCard({ item }: { item: StackItem }) {
  const content = (
    <>
      <div className="flex size-9 shrink-0 items-center justify-center rounded-[8px] border border-[var(--landing-border)] bg-[color-mix(in_oklch,var(--landing-bg)_70%,transparent)]">
        {item.icon ? (
          <StackIcon icon={item.icon} />
        ) : (
          <span className="text-[12px] font-bold text-[var(--landing-accent)]">
            {item.name.slice(0, 1)}
          </span>
        )}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <h3 className="m-0 text-[14px] font-bold text-[var(--landing-text)]">{item.name}</h3>
          {item.href ? (
            <svg
              aria-hidden="true"
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              className="shrink-0 text-[var(--landing-faint)] opacity-0 transition-opacity duration-150 group-hover:opacity-100"
            >
              <path
                d="M7 17 17 7M9 7h8v8"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : null}
        </div>
        <p className="mt-1 mb-0 text-[12.5px] leading-[1.55] text-[var(--landing-muted)]">
          {item.role}
        </p>
      </div>
    </>
  );

  const className =
    'group flex items-start gap-3 rounded-[10px] border border-[var(--landing-border)] bg-[var(--landing-surface)] p-3.5 transition-[border-color,background-color] duration-150 hover:border-[color-mix(in_oklch,var(--landing-accent)_35%,var(--landing-border))] hover:bg-[color-mix(in_oklch,var(--landing-surface)_88%,var(--landing-accent))]';

  if (item.href) {
    return (
      <a
        href={item.href}
        target="_blank"
        rel="noopener noreferrer"
        className={`${className} no-underline`}
      >
        {content}
      </a>
    );
  }

  return <div className={className}>{content}</div>;
}

/**
 * Public marketing page describing the tools, libraries, and packages used to
 * build Agendex. Mirrors the shell patterns of Docs/Download/Changelog pages.
 */
export function ToolsUsedPage({ onBack, homeHref = '/' }: ToolsUsedPageProps) {
  function handleBack(e: MouseEvent<HTMLAnchorElement>) {
    if (!onBack) return;
    if (e.defaultPrevented) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    onBack();
  }

  const totalItems = STACK_SECTIONS.reduce((sum, section) => sum + section.items.length, 0);

  return (
    <ToolsShell>
      <nav className="mb-12 flex flex-wrap items-center justify-between gap-4">
        <a
          href={homeHref}
          onClick={handleBack}
          className="text-[14px] font-bold text-[var(--landing-text)] no-underline"
        >
          Agendex<span className="text-[var(--landing-accent)]">.</span>
        </a>
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
      </nav>

      <header className="max-w-[720px]">
        <p className="m-0 text-[12px] font-bold uppercase tracking-[0.08em] text-[var(--landing-accent)]">
          Stack · Open source
        </p>
        <h1 className="mt-3 mb-0 text-balance text-[36px] font-[760] leading-[1.05] tracking-[-0.03em] text-[var(--landing-text)] max-sm:text-[30px]">
          Tools, libraries, and packages
        </h1>
        <p className="mt-4 mb-0 max-w-[58ch] text-pretty text-[15px] leading-[1.7] text-[var(--landing-muted)]">
          A plain inventory of the technologies behind Agendex — local indexing, Cloud Pro, CLI, and
          the desktop app. Not exhaustive of every transitive dependency; these are the pieces we
          chose and operate on daily.
        </p>
        <p className="mt-3 mb-0 text-[12.5px] text-[var(--landing-faint)]">
          {totalItems} entries · {STACK_SECTIONS.length} groups · AGPL-3.0 monorepo
        </p>
      </header>

      <div className="mt-10 lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-14">
        <aside className="mb-10 lg:mb-0">
          <nav
            aria-label="Stack sections"
            className="grid gap-1 lg:sticky lg:top-8 lg:max-h-[calc(100dvh-64px)] lg:overflow-y-auto"
          >
            <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--landing-faint)]">
              On this page
            </div>
            {STACK_SECTIONS.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className="rounded-[6px] px-2 py-1.5 text-[13px] font-medium text-[var(--landing-muted)] no-underline transition-colors duration-150 hover:bg-[var(--landing-surface)] hover:text-[var(--landing-text)]"
              >
                {section.title}
              </a>
            ))}
            <a
              href="#open-source"
              className="rounded-[6px] px-2 py-1.5 text-[13px] font-medium text-[var(--landing-muted)] no-underline transition-colors duration-150 hover:bg-[var(--landing-surface)] hover:text-[var(--landing-text)]"
            >
              Open source
            </a>
          </nav>
        </aside>

        <div>
          {STACK_SECTIONS.map((section) => (
            <Section key={section.id} id={section.id} title={section.title}>
              <Body>{section.blurb}</Body>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {section.items.map((item) => (
                  <StackCard key={item.name} item={item} />
                ))}
              </div>
            </Section>
          ))}

          <Section id="open-source" title="Open source">
            <Body>
              Agendex is developed as a Bun workspaces monorepo under the AGPL-3.0 license. The
              public source of truth lives on GitHub; issues and PRs are welcome.
            </Body>
            <div className="flex flex-wrap gap-2.5">
              <a
                href="https://github.com/Tyru5/Agendex"
                target="_blank"
                rel="noopener noreferrer"
                className="landing-action landing-action--primary inline-flex min-h-[44px] items-center justify-center gap-2 px-5 no-underline"
              >
                <GitHubIcon size={14} />
                View on GitHub
              </a>
              <a
                href="/docs"
                className="landing-action landing-action--secondary inline-flex min-h-[44px] items-center justify-center gap-2 px-5 no-underline"
              >
                Documentation
              </a>
              <a
                href="/changelog"
                className="landing-action landing-action--secondary inline-flex min-h-[44px] items-center justify-center gap-2 px-5 no-underline"
              >
                Changelog
              </a>
            </div>
          </Section>
        </div>
      </div>
    </ToolsShell>
  );
}
