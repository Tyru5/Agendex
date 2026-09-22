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
import { Body, SubpageHeader, SubpageSection, SubpageShell } from './landing/SubpageShell.tsx';

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

function StackRow({ item }: { item: StackItem }) {
  const external = item.href ? (
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
  ) : null;

  const inner = (
    <>
      <span className="flex size-5 shrink-0 items-center justify-center text-[var(--landing-muted)]">
        {item.icon ? <StackIcon icon={item.icon} size={15} /> : null}
      </span>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-[13.5px] font-semibold text-[var(--landing-text)]">
          {item.name}
        </span>
        {external}
      </span>
      <span className="min-w-0 text-[13px] leading-[1.5] text-[var(--landing-muted)]">
        {item.role}
      </span>
    </>
  );

  const className =
    'group grid grid-cols-[20px_minmax(140px,0.4fr)_minmax(0,1fr)] items-center gap-x-3 gap-y-1 py-2.5 max-sm:grid-cols-[20px_minmax(0,1fr)] max-sm:[&>span:last-child]:col-start-2';

  return (
    <li>
      {item.href ? (
        <a
          href={item.href}
          target="_blank"
          rel="noopener noreferrer"
          className={`${className} no-underline`}
        >
          {inner}
        </a>
      ) : (
        <div className={className}>{inner}</div>
      )}
    </li>
  );
}

/**
 * Public page listing the tools, libraries, and packages used to build Agendex.
 * Mirrors the shell patterns of the Docs/Download/Changelog pages.
 */
export function ToolsUsedPage({ onBack, homeHref = '/' }: ToolsUsedPageProps) {
  return (
    <SubpageShell pageClass="tools-page" onBack={onBack} homeHref={homeHref}>
      <SubpageHeader
        title="Tools, libraries, and packages"
        lede="What Agendex is built with, across local indexing, Cloud Pro, the CLI, and the desktop app. Direct dependencies only; transitive packages are not listed."
      />

      <div className="lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-14">
        <aside className="mb-10 lg:mb-0">
          <nav
            aria-label="Stack sections"
            className="grid gap-1 lg:sticky lg:top-8 lg:max-h-[calc(100dvh-64px)] lg:overflow-y-auto"
          >
            <div className="mb-2 px-2 text-[12px] font-semibold text-[var(--landing-faint)]">
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
            <SubpageSection key={section.id} id={section.id} title={section.title}>
              <Body>{section.blurb}</Body>
              <ul className="m-0 grid list-none divide-y divide-[var(--landing-border-subtle)] border-y border-[var(--landing-border-subtle)] p-0">
                {section.items.map((item) => (
                  <StackRow key={item.name} item={item} />
                ))}
              </ul>
            </SubpageSection>
          ))}

          <SubpageSection id="open-source" title="Open source">
            <Body>
              Agendex is a Bun workspaces monorepo under the AGPL-3.0 license. Source, issues, and
              pull requests are on GitHub.
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
          </SubpageSection>
        </div>
      </div>
    </SubpageShell>
  );
}
