import type { MouseEvent, ReactNode } from 'react';
import { GitHubIcon } from './OAuthIcons.tsx';

export interface DocsPageProps {
  /** Called when the user activates the back link in the header. */
  onBack?: () => void;
  /** Path the brand mark + back affordance link to. Defaults to "/". */
  homeHref?: string;
}

const GITHUB_URL = 'https://github.com/Tyru5/agendex';

const NAV_GROUPS = [
  {
    label: 'Getting started',
    items: [
      ['overview', 'What is Agendex?'],
      ['installation', 'Installation'],
      ['quickstart', 'Quickstart'],
      ['configuration', 'Configuration'],
    ],
  },
  {
    label: 'Core concepts',
    items: [
      ['plan-sources', 'Plan sources'],
      ['custom-directories', 'Custom directories'],
      ['plan-filtering', 'Plan filtering'],
      ['privacy', 'Privacy model'],
    ],
  },
  {
    label: 'Cloud',
    items: [
      ['cloud-sync', 'Cloud sync'],
      ['sharing', 'Sharing & collaboration'],
      ['free-vs-pro', 'Free vs Pro'],
    ],
  },
  {
    label: 'Reference',
    items: [
      ['cli-reference', 'CLI reference'],
      ['agent-hooks', 'Agent hooks'],
      ['self-hosting', 'Self-hosting'],
    ],
  },
] as const;

const INSTALL_COMMANDS = [
  ['npm', 'npm install -g agendex-cli'],
  ['pnpm', 'pnpm add -g agendex-cli'],
  ['bun', 'bun install -g agendex-cli'],
  ['yarn', 'yarn global add agendex-cli'],
] as const;

const QUICKSTART_STEPS = [
  {
    title: 'Install the CLI',
    body: 'One global install with the package manager you already use. Requires Node.js 20 or newer.',
    command: 'npm install -g agendex-cli',
  },
  {
    title: 'Choose plan sources',
    body: 'Pick which agents Agendex should index from an interactive list. Re-run it any time to change your selection.',
    command: 'agendex configure',
  },
  {
    title: 'Start the daemon',
    body: 'The daemon backgrounds itself and watches your configured sources for new and changed plans.',
    command: 'agendex start',
  },
  {
    title: 'Open the workspace',
    body: 'Opens the Agendex web app in your default browser. Search, filter, and inspect everything your agents have planned.',
    command: 'agendex open',
  },
] as const;

const IMPLEMENTED_ADAPTERS = [
  'Claude Code',
  'Codex CLI',
  'Continue',
  'Cursor',
  'Grok',
  'OpenCode',
  'Plannotator',
] as const;

const CATALOG_ADAPTERS =
  'Windsurf, Amp, Cline, GitHub Copilot, Aider, Droid, Kilo Code, Roo Code, Goose, and Gemini CLI';

const FREE_FEATURES = [
  'Local plan indexing and search',
  'Implemented agent adapters',
  'Custom plan source directories',
  'Full source access',
  'No account required',
] as const;

const PRO_FEATURES = [
  'Everything in Self-hosted',
  'Agendex Desktop app for macOS (see /download)',
  'Cloud sync from the CLI daemon',
  'Shareable plan links',
  'Comment threads',
  'Tags, collections, and plan history',
  'Technology dependency charts',
  'Plannotator integration',
  'New plan indicators',
  'Plan creation, uploads, and editing',
  'Up to five workspace members',
  'Access from any device',
] as const;

const CLI_COMMANDS: ReadonlyArray<
  readonly [group: string, commands: ReadonlyArray<readonly [string, string]>]
> = [
  [
    'Setup',
    [
      ['agendex configure', 'Select which agents and plan sources to index.'],
      [
        'agendex add-dir <path>',
        'Add a custom directory to scan for plans. Pass --live to notify a running daemon immediately.',
      ],
      ['agendex remove-dir <path>', 'Remove a custom plan directory from the index.'],
      ['agendex list-dirs', 'List the custom plan directories currently configured.'],
      ['agendex status', 'Show config state, daemon status, uptime, and hostname.'],
      ['agendex upgrade', 'Upgrade the CLI to the latest release. Pass --force to reinstall.'],
    ],
  ],
  [
    'Daemon',
    [
      ['agendex start', 'Start the daemon. It backgrounds itself and watches configured sources.'],
      ['agendex stop', 'Stop the running daemon.'],
      [
        'agendex open',
        'Open the Agendex web app in your default browser. Pass --url for a self-hosted deployment.',
      ],
    ],
  ],
  [
    'Cloud',
    [
      [
        'agendex login',
        'Authenticate via browser OAuth. Pass --url to log in to a self-hosted instance.',
      ],
      ['agendex logout', 'Clear the stored cloud token.'],
      [
        'agendex sync',
        'One-shot scan and sync to the cloud. Pass --force to re-sync everything, ignoring the local hash cache.',
      ],
      [
        'agendex upload <path>',
        'Upload a single Markdown plan file. Supports --agent <name> to set the agent label and --open to view it after upload.',
      ],
      ['agendex view <url>', 'Open a shared plan link in your browser.'],
      [
        'agendex cleanup',
        'Interactively remove registered cloud daemons. Pass --stale to auto-remove all stale ones.',
      ],
    ],
  ],
  [
    'Hooks',
    [
      ['agendex hooks status', 'Show hook integration status for supported agents.'],
      [
        'agendex hooks install <agent|all>',
        'Install hook integration for claude-code, codex, or pi.',
      ],
      ['agendex hooks uninstall <agent|all>', 'Remove managed Agendex hook entries.'],
    ],
  ],
] as const;

function DocsShell({ children }: { children: ReactNode }) {
  return (
    <main className="landing-page docs-page min-h-[100dvh]">
      <div className="landing-frame px-[clamp(18px,5vw,72px)] py-[clamp(56px,7vw,88px)]">
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

function InlineCode({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-[4px] border border-[var(--landing-border-subtle)] bg-[color-mix(in_oklch,var(--landing-bg)_78%,transparent)] px-1.5 py-0.5 font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace] text-[12px] text-[var(--landing-accent)]">
      {children}
    </code>
  );
}

function DocSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section
      id={id}
      className="scroll-mt-24 border-t border-[var(--landing-border-subtle)] py-10 first:border-t-0 first:pt-0"
    >
      <h2 className="m-0 text-[24px] font-[740] leading-[1.1] tracking-[-0.02em] text-[var(--landing-text)]">
        {title}
      </h2>
      <div className="mt-4 grid gap-4">{children}</div>
    </section>
  );
}

function Body({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 max-w-[68ch] text-pretty text-[13.5px] leading-[1.7] text-[var(--landing-muted)]">
      {children}
    </p>
  );
}

function SubHeading({ children }: { children: ReactNode }) {
  return <h3 className="mt-3 mb-0 text-[15px] font-bold text-[var(--landing-text)]">{children}</h3>;
}

function Callout({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-[68ch] rounded-[7px] border border-[var(--landing-border)] border-l-2 border-l-[var(--landing-accent)] bg-[var(--landing-surface)] px-4 py-3 text-[13px] leading-[1.65] text-[var(--landing-muted)]">
      {children}
    </div>
  );
}

function FeatureList({ items }: { items: ReadonlyArray<string> }) {
  return (
    <ul className="m-0 grid list-none gap-2 p-0">
      {items.map((item) => (
        <li
          key={item}
          className="flex items-baseline gap-2.5 text-[13px] leading-[1.55] text-[var(--landing-muted)]"
        >
          <span aria-hidden className="text-[11px] font-bold text-[var(--landing-accent)]">
            ✓
          </span>
          {item}
        </li>
      ))}
    </ul>
  );
}

export function DocsPage({ onBack, homeHref = '/' }: DocsPageProps) {
  function handleBack(e: MouseEvent<HTMLAnchorElement>) {
    if (!onBack) return;
    if (e.defaultPrevented) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
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

      <div className="lg:grid lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-14">
        <aside className="mb-10 lg:mb-0">
          <nav
            aria-label="Docs sections"
            className="grid gap-6 lg:sticky lg:top-8 lg:max-h-[calc(100dvh-64px)] lg:overflow-y-auto"
          >
            {NAV_GROUPS.map((group) => (
              <div key={group.label}>
                <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--landing-faint)]">
                  {group.label}
                </div>
                <ul className="m-0 grid list-none gap-1 p-0">
                  {group.items.map(([id, title]) => (
                    <li key={id}>
                      <a
                        href={`#${id}`}
                        className="block rounded-[5px] px-2 py-1 text-[13px] leading-[1.5] text-[var(--landing-muted)] no-underline transition-colors hover:bg-[var(--landing-surface)] hover:text-[var(--landing-text)]"
                      >
                        {title}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        <div>
          <DocSection id="overview" title="What is Agendex?">
            <Body>
              AI coding agents produce plans constantly — implementation strategies, refactor
              proposals, debugging investigations — and then scatter them across dotfile directories
              where they are never seen again. Agendex indexes the plans and sessions your agents
              write on your machine and turns them into one searchable, navigable workspace.
            </Body>
            <Body>
              A lightweight daemon watches your configured plan sources, filters out low-value
              noise, and keeps a local index you can search and inspect from the browser. Everything
              runs self-hosted for free; an optional Cloud Pro tier adds sync, shareable links,
              comments, and plan history when review moves across people and machines.
            </Body>
            <SubHeading>How it works</SubHeading>
            <ol className="m-0 grid max-w-[68ch] list-none gap-2 p-0">
              {[
                'Use your agents normally — Claude Code, Cursor, Codex, and friends keep writing plans where they always have.',
                'The Agendex daemon watches those locations and indexes new or changed plans within seconds.',
                'Open the workspace to search, filter, and inspect every plan in one place.',
                'Optionally sync to Cloud Pro to share links, collect comments, and track history across machines.',
              ].map((step, index) => (
                <li
                  key={step}
                  className="flex items-baseline gap-3 text-[13.5px] leading-[1.65] text-[var(--landing-muted)]"
                >
                  <span className="font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace] text-[11px] font-semibold text-[var(--landing-accent)]">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </DocSection>

          <DocSection id="installation" title="Installation">
            <Body>
              Agendex ships as a single global CLI, <InlineCode>agendex-cli</InlineCode>. The
              dashboard opens from the daemon when you need the workspace — there is nothing else to
              install.
            </Body>
            <SubHeading>Prerequisites</SubHeading>
            <Body>
              Node.js 20 or newer. Any of the common package managers works for the global install.
            </Body>
            <div className="grid max-w-[560px] gap-2">
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
            <SubHeading>Script installer</SubHeading>
            <Body>Prefer a one-liner? The install script sets everything up for you.</Body>
            <div className="grid max-w-[560px] gap-2">
              <div>
                <div className="mb-1.5 text-[12px] font-semibold text-[var(--landing-text)]">
                  macOS / Linux / WSL
                </div>
                <CodeBlock>{'curl -fsSL https://agendex.dev/install.sh | bash'}</CodeBlock>
              </div>
              <div>
                <div className="mb-1.5 text-[12px] font-semibold text-[var(--landing-text)]">
                  Windows PowerShell
                </div>
                <CodeBlock>{'irm https://agendex.dev/install.ps1 | iex'}</CodeBlock>
              </div>
            </div>
            <Callout>
              The CLI checks for updates before <InlineCode>start</InlineCode>,{' '}
              <InlineCode>configure</InlineCode>, and <InlineCode>sync</InlineCode> so your index
              pipeline and adapters stay current. Verify your install any time with{' '}
              <InlineCode>agendex --version</InlineCode>.
            </Callout>
          </DocSection>

          <DocSection id="quickstart" title="Quickstart">
            <Body>From install to a searchable plan index in under a minute.</Body>
            <div className="grid divide-y divide-[var(--landing-border-subtle)] overflow-hidden rounded-[8px] border border-[var(--landing-border)] bg-[var(--landing-surface)]">
              {QUICKSTART_STEPS.map((step, index) => (
                <article
                  key={step.title}
                  className="grid gap-3 p-5 sm:grid-cols-[minmax(0,1fr)_minmax(220px,0.7fr)] sm:items-center"
                >
                  <div>
                    <div className="mb-2 font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace] text-[11px] font-semibold text-[var(--landing-accent)]">
                      {String(index + 1).padStart(2, '0')}
                    </div>
                    <h3 className="m-0 text-[16px] font-bold text-[var(--landing-text)]">
                      {step.title}
                    </h3>
                    <p className="mt-2 mb-0 text-[13px] leading-[1.65] text-[var(--landing-muted)]">
                      {step.body}
                    </p>
                  </div>
                  <CodeBlock>{step.command}</CodeBlock>
                </article>
              ))}
            </div>
            <Callout>
              No account is required for any of the above. Run{' '}
              <InlineCode>agendex login</InlineCode> only when you want Cloud sync and sharing — see{' '}
              <a href="#cloud-sync" className="text-[var(--landing-accent)]">
                Cloud sync
              </a>
              .
            </Callout>
          </DocSection>

          <DocSection id="configuration" title="Configuration">
            <Body>
              <InlineCode>agendex configure</InlineCode> is the main entry point: an interactive
              multiselect of available adapters plus any custom directories you have added. Your
              selection, custom plan directories, and auth tokens are stored in a single config
              file.
            </Body>
            <div className="grid max-w-[560px] gap-2">
              <div className="grid gap-2 rounded-[7px] border border-[var(--landing-border-subtle)] bg-[color-mix(in_oklch,var(--landing-bg)_76%,transparent)] p-3 sm:grid-cols-[120px_minmax(0,1fr)] sm:items-center">
                <span className="text-[12px] font-semibold text-[var(--landing-text)]">
                  Config file
                </span>
                <CodeBlock>{'~/.agendex/config.json'}</CodeBlock>
              </div>
              <div className="grid gap-2 rounded-[7px] border border-[var(--landing-border-subtle)] bg-[color-mix(in_oklch,var(--landing-bg)_76%,transparent)] p-3 sm:grid-cols-[120px_minmax(0,1fr)] sm:items-center">
                <span className="text-[12px] font-semibold text-[var(--landing-text)]">
                  Override dir
                </span>
                <CodeBlock>{'AGENDEX_CONFIG_DIR=/path/to/dir'}</CodeBlock>
              </div>
            </div>
            <Body>
              Development mode (<InlineCode>AGENDEX_DEV=1</InlineCode> or the{' '}
              <InlineCode>--dev</InlineCode> flag) keeps a separate config in{' '}
              <InlineCode>~/.agendex-dev/</InlineCode> so experiments never touch your real index.
            </Body>
          </DocSection>

          <DocSection id="plan-sources" title="Plan sources">
            <Body>
              Adapters teach Agendex where each agent keeps its plans and how to parse them. Fully
              implemented adapters currently cover:
            </Body>
            <ul className="m-0 flex max-w-[68ch] list-none flex-wrap gap-2 p-0">
              {IMPLEMENTED_ADAPTERS.map((adapter) => (
                <li
                  key={adapter}
                  className="rounded-[6px] border border-[var(--landing-border)] bg-[var(--landing-surface)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--landing-text)]"
                >
                  {adapter}
                </li>
              ))}
            </ul>
            <Body>
              A broader adapter catalog — {CATALOG_ADAPTERS} — is rolling out through the same
              adapter system, and custom directories cover anything the catalog doesn&rsquo;t reach
              yet. Each adapter knows its agent&rsquo;s default plan locations, so there is nothing
              to point at manually.
            </Body>
          </DocSection>

          <DocSection id="custom-directories" title="Custom directories">
            <Body>
              For plans that live outside the default agent locations — a team plans folder, a
              repo&rsquo;s <InlineCode>plans/</InlineCode> directory, exported documents — add the
              path directly:
            </Body>
            <div className="max-w-[560px]">
              <CodeBlock>{'agendex add-dir <path>'}</CodeBlock>
            </div>
            <Body>
              The daemon watches custom directories with the same index pipeline as built-in
              adapters. Pass <InlineCode>--live</InlineCode> to notify a running daemon immediately
              instead of waiting for the next rescan. Use <InlineCode>agendex list-dirs</InlineCode>{' '}
              to see what is configured and <InlineCode>agendex remove-dir &lt;path&gt;</InlineCode>{' '}
              to drop one.
            </Body>
          </DocSection>

          <DocSection id="plan-filtering" title="Plan filtering">
            <Body>
              Agents produce a lot of Markdown that isn&rsquo;t a plan: empty files, one-line
              prompts, tool logs, execution output, code-only snippets. A shared classifier tags
              these as low-value so your index stays signal, not noise.
            </Body>
            <Body>
              Locally, low-value plans are hidden from search and lists — the files themselves are
              never touched and stay readable on disk. On Cloud sync, low-value plans are pruned:
              existing cloud copies are deleted and new ones are skipped, and the sync output
              reports exactly what was filtered.
            </Body>
          </DocSection>

          <DocSection id="privacy" title="Privacy model">
            <Body>
              Agendex is local-first. Self-hosted plan data stays on your machine — no account, no
              telemetry pipeline, full source access. Cloud sync sends selected plan payloads to
              your Agendex account, and nothing becomes publicly visible unless you explicitly
              create a shared link.
            </Body>
            <Body>
              Synced plans carry provenance metadata — device ID, hostname, and local IP — so you
              can tell which machine a plan came from. Local IP reporting can be turned off in
              Account settings or with <InlineCode>AGENDEX_DISABLE_LOCAL_IP=1</InlineCode>.
            </Body>
            <Callout>
              The web packages are AGPL-3.0 open source (everything except{' '}
              <InlineCode>packages/ee</InlineCode>, which is source-available under the Agendex
              Enterprise License). You can read exactly what leaves your machine.
            </Callout>
          </DocSection>

          <DocSection id="cloud-sync" title="Cloud sync">
            <Body>
              Authenticate once and the daemon takes care of the rest. Login opens a browser OAuth
              flow; the CLI stores the token locally.
            </Body>
            <div className="max-w-[560px]">
              <CodeBlock>{'agendex login\nagendex start'}</CodeBlock>
            </div>
            <Body>
              While the daemon runs, file watchers and periodic rescans pick up new and edited
              plans. Each change is queued, deduplicated so only the latest version of a plan
              uploads, and skipped entirely if a content hash says nothing changed. Failed uploads
              retry with backoff. The cloud dashboard updates reactively — no manual refresh.
            </Body>
            <Body>
              Need more control? <InlineCode>agendex sync</InlineCode> runs a one-shot scan and
              sync, <InlineCode>agendex sync --force</InlineCode> re-syncs everything ignoring the
              hash cache, and <InlineCode>agendex upload &lt;path&gt;</InlineCode> pushes a single
              Markdown file — handy for plans written outside any agent.
            </Body>
            <Callout>
              Self-hosting the cloud stack too? Point the CLI at your own deployment with{' '}
              <InlineCode>agendex login --url &lt;url&gt;</InlineCode>.
            </Callout>
          </DocSection>

          <DocSection id="sharing" title="Sharing & collaboration">
            <Body>
              Cloud Pro turns plans from private artifacts into things a team can review. Every plan
              can generate a scoped share link — recipients see that plan, nothing else.
            </Body>
            <FeatureList
              items={[
                'Shareable plan links with scoped access',
                'Comment threads on plans',
                'Tags, collections, and plan history',
                'Technology dependency charts across your plans',
                'Plan creation, uploads, and editing from the dashboard',
                'Up to five workspace members, access from any device',
              ]}
            />
          </DocSection>

          <DocSection id="free-vs-pro" title="Free vs Pro">
            <Body>
              The free path is the local OSS index — it is not a trial, and no account is required.
              Cloud Pro adds sync, sharing, and collaboration without changing where plans
              originate.
            </Body>
            <div className="grid gap-4 sm:grid-cols-2">
              <article className="rounded-[8px] border border-[var(--landing-border)] bg-[var(--landing-surface)] p-5">
                <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--landing-faint)]">
                  Free
                </div>
                <h3 className="mt-1 mb-0 text-[18px] font-bold text-[var(--landing-text)]">
                  Self-Hosted
                </h3>
                <div className="mt-2 mb-4 text-[13px] text-[var(--landing-muted)]">
                  <span className="text-[20px] font-[740] text-[var(--landing-text)]">$0</span>{' '}
                  forever
                </div>
                <FeatureList items={FREE_FEATURES} />
              </article>
              <article className="rounded-[8px] border border-[var(--landing-border-strong)] bg-[var(--landing-surface)] p-5">
                <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--landing-accent)]">
                  Pro
                </div>
                <h3 className="mt-1 mb-0 text-[18px] font-bold text-[var(--landing-text)]">
                  Cloud
                </h3>
                <div className="mt-2 mb-4 text-[13px] text-[var(--landing-muted)]">
                  <span className="text-[20px] font-[740] text-[var(--landing-text)]">$7</span>
                  /month, or $69/year ($5.75/mo)
                </div>
                <FeatureList items={PRO_FEATURES} />
              </article>
            </div>
            <Callout>
              14-day money-back guarantee: if Cloud Pro is not a fit in your first 14 days, you get
              a full refund. No questions asked.
            </Callout>
          </DocSection>

          <DocSection id="cli-reference" title="CLI reference">
            <Body>
              Every command the <InlineCode>agendex</InlineCode> binary supports.{' '}
              <InlineCode>agendex help</InlineCode> prints this list in your terminal;{' '}
              <InlineCode>agendex --version</InlineCode> prints the installed version.
            </Body>
            <div className="grid gap-6">
              {CLI_COMMANDS.map(([group, commands]) => (
                <div key={group}>
                  <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--landing-faint)]">
                    {group}
                  </div>
                  <div className="grid divide-y divide-[var(--landing-border-subtle)] overflow-hidden rounded-[8px] border border-[var(--landing-border)] bg-[var(--landing-surface)]">
                    {commands.map(([command, description]) => (
                      <div
                        key={command}
                        className="grid gap-2 p-3.5 sm:grid-cols-[minmax(200px,0.55fr)_minmax(0,1fr)] sm:items-baseline"
                      >
                        <code className="font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace] text-[12.5px] font-semibold text-[var(--landing-accent)]">
                          {command}
                        </code>
                        <p className="m-0 text-[13px] leading-[1.6] text-[var(--landing-muted)]">
                          {description}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </DocSection>

          <DocSection id="agent-hooks" title="Agent hooks">
            <Body>
              Hooks let supported agents notify Agendex the moment a plan is written, instead of
              waiting on file watchers. Hook integrations are currently available for{' '}
              <InlineCode>claude-code</InlineCode>, <InlineCode>codex</InlineCode>, and{' '}
              <InlineCode>pi</InlineCode>.
            </Body>
            <div className="max-w-[560px]">
              <CodeBlock>
                {'agendex hooks status\nagendex hooks install all\nagendex hooks uninstall all'}
              </CodeBlock>
            </div>
            <Body>
              Agendex only manages its own hook entries — installing and uninstalling never touches
              hooks you configured yourself.
            </Body>
          </DocSection>

          <DocSection id="self-hosting" title="Self-hosting">
            <Body>
              The OSS server and web client run entirely on your machine — clone the repo, run
              locally, and keep full control over your data. The local API server listens on port{' '}
              <InlineCode>4890</InlineCode> by default (override with <InlineCode>PORT</InlineCode>
              ).
            </Body>
            <Body>
              You can also self-host the full cloud stack — Convex backend, GitHub OAuth, and the EE
              dashboard — and point the CLI at it with{' '}
              <InlineCode>agendex login --url &lt;url&gt;</InlineCode>. The step-by-step guide lives
              in the repository.
            </Body>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="landing-action landing-action--secondary landing-action--compact w-fit"
            >
              <GitHubIcon size={14} />
              Self-hosting guide on GitHub
            </a>
          </DocSection>
        </div>
      </div>
    </DocsShell>
  );
}
