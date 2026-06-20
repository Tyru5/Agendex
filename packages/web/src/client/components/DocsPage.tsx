import type { MouseEvent, ReactNode } from 'react';
import { GitHubIcon } from './OAuthIcons.tsx';

export interface DocsPageProps {
  onBack?: () => void;
  homeHref?: string;
}

const INSTALL_COMMANDS = [
  ['bun', 'bun install -g agendex-cli'],
  ['npm', 'npm install -g agendex-cli'],
  ['pnpm', 'pnpm add -g agendex-cli'],
] as const;

const QUICKSTART_STEPS = [
  ['Install the CLI', 'Choose the package manager you use for global tools.'],
  ['Authenticate', 'Run agendex login when you want Cloud sync or sharing.'],
  ['Start the daemon', 'Run agendex start to watch configured plan sources.'],
  ['Open the workspace', 'Run agendex open to inspect plans in the browser.'],
] as const;

const DOC_SECTIONS = [
  {
    title: 'Plan sources',
    body: 'Built-in adapters cover Claude Code, Cursor, Codex, Windsurf, Amp, Cline, Copilot, OpenCode, Continue, Aider, Droid, Kilo Code, Roo Code, Goose, and Gemini CLI.',
  },
  {
    title: 'Custom folders',
    body: 'Use agendex add-dir <path> for directories outside the default agent locations. The daemon watches them with the same index pipeline.',
  },
  {
    title: 'Privacy model',
    body: 'Self-hosted plans stay local. Cloud sync sends plan data to your Agendex account, and nothing becomes public unless you create a shared link.',
  },
  {
    title: 'Cloud review',
    body: 'Cloud Pro adds shared links, comments, plan history, charts, dashboard plan creation, and access across machines.',
  },
] as const;

function DocsShell({ children }: { children: ReactNode }) {
  return (
    <main className="landing-page docs-page min-h-[100dvh]">
      <div className="landing-frame px-[clamp(18px,5vw,72px)] py-[clamp(72px,9vw,108px)]">
        {children}
      </div>
    </main>
  );
}

function CodeBlock({ children }: { children: ReactNode }) {
  return (
    <code className="block overflow-x-auto whitespace-pre rounded-[7px] border border-[var(--landing-border-subtle)] bg-[color-mix(in_oklch,var(--landing-bg)_78%,transparent)] px-3 py-2.5 font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace] text-[12.5px] leading-[1.65] text-[var(--landing-accent)]">
      {children}
    </code>
  );
}

export function DocsPage({ onBack, homeHref = '/' }: DocsPageProps) {
  function handleBack(e: MouseEvent<HTMLAnchorElement>) {
    if (!onBack) return;
    e.preventDefault();
    onBack();
  }

  return (
    <DocsShell>
      <nav className="mb-12 flex flex-wrap items-center justify-between gap-4">
        <a
          href={homeHref}
          onClick={handleBack}
          className="text-[14px] font-bold text-[var(--landing-text)] no-underline"
        >
          Agendex<span className="text-[var(--landing-accent)]">.</span>
        </a>
        <a
          href="https://github.com/tiru5/agendex"
          target="_blank"
          rel="noopener noreferrer"
          className="landing-action landing-action--secondary landing-action--compact"
        >
          <GitHubIcon size={14} />
          View on GitHub
        </a>
      </nav>

      <header className="grid gap-8 border-b border-[var(--landing-border-subtle)] pb-12 lg:grid-cols-[minmax(0,0.74fr)_minmax(320px,0.52fr)]">
        <div>
          <h1 className="m-0 max-w-[760px] text-balance text-[clamp(40px,7vw,64px)] font-[760] leading-[0.98] tracking-[-0.035em] text-[var(--landing-text)]">
            Agendex docs
          </h1>
          <p className="mt-5 mb-0 max-w-[620px] text-pretty text-[15px] leading-[1.75] text-[var(--landing-muted)]">
            Install the CLI, connect plan sources, run the daemon, and decide when Cloud sync should
            enter the workflow.
          </p>
        </div>
        <div className="rounded-[8px] border border-[var(--landing-border)] bg-[var(--landing-surface)] p-4">
          <div className="mb-3 text-[12px] font-bold text-[var(--landing-text)]">Fast path</div>
          <CodeBlock>
            {'npm install -g agendex-cli\nagendex login\nagendex start\nagendex open'}
          </CodeBlock>
        </div>
      </header>

      <section className="grid gap-8 border-b border-[var(--landing-border-subtle)] py-12 lg:grid-cols-[minmax(0,0.62fr)_minmax(0,1fr)]">
        <div>
          <h2 className="m-0 text-[28px] font-[740] leading-[1.08] tracking-[-0.02em] text-[var(--landing-text)]">
            Install
          </h2>
          <p className="mt-3 mb-0 max-w-[44ch] text-[13.5px] leading-[1.65] text-[var(--landing-muted)]">
            Use one global CLI. The dashboard opens from the daemon when you need the workspace.
          </p>
        </div>
        <div className="grid gap-2">
          {INSTALL_COMMANDS.map(([label, command]) => (
            <div
              key={label}
              className="grid gap-2 rounded-[7px] border border-[var(--landing-border-subtle)] bg-[color-mix(in_oklch,var(--landing-bg)_76%,transparent)] p-3 sm:grid-cols-[72px_minmax(0,1fr)] sm:items-center"
            >
              <span className="font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace] text-[11px] font-bold text-[var(--landing-muted)]">
                {label}
              </span>
              <CodeBlock>{command}</CodeBlock>
            </div>
          ))}
        </div>
      </section>

      <section className="border-b border-[var(--landing-border-subtle)] py-12">
        <h2 className="m-0 text-[28px] font-[740] leading-[1.08] tracking-[-0.02em] text-[var(--landing-text)]">
          Quickstart
        </h2>
        <div className="mt-7 grid divide-y divide-[var(--landing-border-subtle)] overflow-hidden rounded-[8px] border border-[var(--landing-border)] bg-[var(--landing-surface)] lg:grid-cols-4 lg:divide-x lg:divide-y-0">
          {QUICKSTART_STEPS.map(([title, body], index) => (
            <article key={title} className="p-5">
              <div className="mb-8 font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace] text-[11px] font-semibold text-[var(--landing-accent)]">
                {String(index + 1).padStart(2, '0')}
              </div>
              <h3 className="m-0 text-[17px] font-bold text-[var(--landing-text)]">{title}</h3>
              <p className="mt-3 mb-0 text-[13.5px] leading-[1.65] text-[var(--landing-muted)]">
                {body}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="grid gap-x-8 gap-y-4 py-12 lg:grid-cols-2">
        {DOC_SECTIONS.map((section) => (
          <article
            key={section.title}
            className="border-t border-[var(--landing-border-subtle)] py-5"
          >
            <h2 className="m-0 text-[17px] font-bold text-[var(--landing-text)]">
              {section.title}
            </h2>
            <p className="mt-2 mb-0 text-[13.5px] leading-[1.65] text-[var(--landing-muted)]">
              {section.body}
            </p>
          </article>
        ))}
      </section>
    </DocsShell>
  );
}
