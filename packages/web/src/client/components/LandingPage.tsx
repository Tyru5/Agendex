import React, { useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { startViewTransition } from '../lib/view-transition.ts';
import {
  FAQ_ITEMS,
  FREE_FEATURES,
  CLI_INSTALL_OPTIONS,
  MONEY_BACK_GUARANTEE,
  PRO_FEATURES,
  setToken,
} from './landing/data.ts';
import {
  type LandingContextValue,
  LandingContext,
  LANDING_INITIAL,
  landingReducer,
} from './landing/LandingContext.tsx';
import { DexMascot } from './landing/DexMascot.tsx';
import type { LandingMascotProps } from './landing/LandingMascot.tsx';
import { useTheme } from '../hooks/useTheme.ts';
import { NavbarAuth, HeroCta, PricingCta } from './landing/LandingSlots.tsx';
import type { SlotRenderFn, SlotComponent } from './landing/LandingSlots.tsx';
import {
  ChevronIcon,
  DocIcon,
  GITHUB_URL,
  LANDING_LINKS,
  LandingToolbar,
  landingNavClickHandler,
  type LandingNavHandlers,
} from './landing/Toolbar.tsx';
import { AgentIcon } from './AgentIcon.tsx';
import { GitHubIcon } from './OAuthIcons.tsx';

function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className="shrink-0 animate-spin"
      style={{ animationDuration: '0.8s' }}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity={0.25} />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

const LANDING_ANCHOR_OFFSET = 64;
const SECTION_SCROLL_STYLE = { scrollMarginTop: LANDING_ANCHOR_OFFSET };
type LandingTab = 'local' | 'cloud';

export interface LandingPageProps {
  children?: ReactNode;
  mascot?: LandingMascotProps;
  onShowChangelog?: () => void;
  onShowDocs?: () => void;
  onShowDownload?: () => void;
  onShowTools?: () => void;
}

/* ─── Illustrative listings ──────────────────────────────────────────────
 * The three source columns and the index they collate into. Synthetic file
 * names in the shape real agents produce; labeled "illustrative" on the page.
 */
type SourcePlan = { key: string; name: string; ws: string; age: string; minutes: number };
type Source = {
  agent: string;
  label: string;
  path: string;
  plans: SourcePlan[];
};

function plan(key: string, name: string, ws: string, age: string, minutes: number): SourcePlan {
  return { key, name, ws, age, minutes };
}

const SOURCES: Source[] = [
  {
    agent: 'claude-code',
    label: 'Claude Code',
    path: '~/.claude/plans',
    plans: [
      plan('c1', 'rate-limit-rollout.md', 'api', '2m', 2),
      plan('c2', 'auth-token-refresh.md', 'api', '41m', 41),
      plan('c3', 'search-index-rebuild.md', 'web', '2h', 120),
      plan('c4', 'flaky-ws-tests.md', 'cli', '5h', 300),
      plan('c5', 'onboarding-copy-pass.md', 'web', 'yesterday', 1500),
      plan('c6', 'migrate-session-store.md', 'api', '2d', 2900),
      plan('c7', 'plan-outline-panel.md', 'web', '3d', 4300),
      plan('c8', 'oauth-callback-hardening.md', 'api', '4d', 5900),
      plan('c9', 'desktop-auto-update.md', 'desktop', '6d', 8600),
      plan('c10', 'search-ranking-tweaks.md', 'web', '1w', 10100),
      plan('c11', 'adapter-continue-experimental.md', 'cli', '2w', 20200),
    ],
  },
  {
    agent: 'codex-cli',
    label: 'Codex',
    path: '~/.codex/tasks',
    plans: [
      plan('x1', 'daemon-retry-backoff.md', 'cli', '9m', 9),
      plan('x2', 'sqlite-vacuum-schedule.md', 'cli', '1h', 60),
      plan('x3', 'share-link-scoping.md', 'api', '4h', 240),
      plan('x4', 'electron-safe-storage.md', 'desktop', 'yesterday', 1600),
      plan('x5', 'changelog-parser.md', 'web', '2d', 3000),
      plan('x6', 'ci-release-matrix.md', 'cli', '4d', 5800),
      plan('x7', 'hook-capture-spool.md', 'cli', '5d', 7200),
      plan('x8', 'workspace-member-limits.md', 'api', '1w', 10500),
      plan('x9', 'plan-history-diff.md', 'web', '2w', 20800),
      plan('x10', 'windows-code-signing.md', 'desktop', '3w', 30300),
    ],
  },
  {
    agent: 'cursor',
    label: 'Cursor',
    path: '.cursor/plans',
    plans: [
      plan('u1', 'pricing-toggle-a11y.md', 'web', '18m', 18),
      plan('u2', 'tag-collections-ui.md', 'web', '3h', 180),
      plan('u3', 'comment-threads.md', 'api', '7h', 420),
      plan('u4', 'notarize-mac-build.md', 'desktop', 'yesterday', 1700),
      plan('u5', 'adapter-catalog-hide.md', 'cli', '3d', 4100),
      plan('u6', 'workspace-invites.md', 'api', '5d', 7300),
      plan('u7', 'tech-dependency-chart.md', 'web', '1w', 10300),
      plan('u8', 'mermaid-in-plans.md', 'web', '2w', 20500),
      plan('u9', 'daemon-status-panel.md', 'cli', '3w', 30100),
      plan('u10', 'keyboard-nav-audit.md', 'web', '1mo', 43200),
    ],
  },
];

const INDEX_ROWS = SOURCES.flatMap((source) =>
  source.plans.map((p) => ({ ...p, agent: source.agent, label: source.label })),
).sort((a, b) => a.minutes - b.minutes);

const SUPPORTED_AGENTS = [
  { agent: 'antigravity', label: 'Antigravity' },
  { agent: 'claude-code', label: 'Claude Code' },
  { agent: 'codebuddy', label: 'CodeBuddy' },
  { agent: 'codex-cli', label: 'Codex' },
  { agent: 'commandcode', label: 'Command Code' },
  { agent: 'cursor', label: 'Cursor' },
  { agent: 'droid', label: 'Factory Droid' },
  { agent: 'gemini-cli', label: 'Gemini CLI' },
  { agent: 'copilot-chat', label: 'GitHub Copilot' },
  { agent: 'grok', label: 'Grok' },
  { agent: 'junie', label: 'Junie' },
  { agent: 'kilo-cli', label: 'Kilo Code' },
  { agent: 'kimi-cli', label: 'Kimi Code' },
  { agent: 'kiro-cli', label: 'Kiro' },
  { agent: 'mux', label: 'Mux' },
  { agent: 'omp', label: 'omp (oh-my-pi)' },
  { agent: 'opencode', label: 'OpenCode' },
  { agent: 'oh-my-opencode', label: 'Oh My OpenCode' },
  { agent: 'plannotator', label: 'Plannotator' },
  { agent: 'qwen-code', label: 'Qwen Code' },
  { agent: 'windsurf', label: 'Windsurf / Devin Desktop' },
] as const;

const PLAN_REVIEW_BULLETS = [
  'Source path, agent, workspace, recency, and plan state stay visible together.',
  'Full-text search moves across watched agent output and custom plan folders.',
  'Low-value plans can be hidden while the raw local files remain readable.',
  'Cloud sync can start from the same local index when review needs another person.',
] as const;

const CLOUD_REVIEW_BULLETS = [
  'Share links, comments, tags, collections, and plan history live on Cloud Pro.',
  'Workspace members can review synced plans without touching the source machine.',
  'Dashboard creation, uploads, and editing cover plans that do not start in an agent.',
  'Plannotator sessions can receive daemon-delivered request-changes feedback.',
] as const;

const PRODUCT_STEPS = [
  {
    title: 'Use agents normally.',
    body: 'Agendex scans the plan and session locations its implemented adapters know how to parse.',
  },
  {
    title: 'Search the local index.',
    body: 'Filter by agent or workspace, open read-only markdown, and keep custom plan sources in the same view.',
  },
  {
    title: 'Sync only when useful.',
    body: 'Use the CLI daemon to push selected local plans to Cloud Pro for sharing, comments, history, and workspace review.',
  },
] as const;

const HERO_INSTALL_COMMANDS = [
  {
    id: 'unix',
    label: 'macOS / Linux',
    prompt: '$',
    cmd: 'curl -fsSL https://agendex.dev/install.sh | bash',
  },
  {
    id: 'windows',
    label: 'Windows',
    prompt: '>',
    cmd: 'irm https://agendex.dev/install.ps1 | iex',
  },
] as const;
const HERO_INSTALL_IDS = HERO_INSTALL_COMMANDS.map((o) => o.id);
const CLI_INSTALL_IDS = CLI_INSTALL_OPTIONS.map((o) => o.id);

/* ─── Small shared bits ─────────────────────────────────────────────────── */

function ActionLink({
  href,
  children,
  variant = 'secondary',
  onClick,
}: {
  href: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary';
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  const external = href.startsWith('http');
  return (
    <a
      href={href}
      onClick={onClick}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      className={`landing-action landing-action--${variant}`}
    >
      {children}
    </a>
  );
}

function CopyIcon({ copied }: { copied: boolean }) {
  return copied ? (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="m5 12 4 4L19 6"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function useCopy(text: string) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    if (!navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }
  return { copied, copy };
}

/**
 * WAI-ARIA tabs: roving tabindex, arrow/Home/End keys move selection and
 * focus together, and the panel is linked to the active tab.
 */
function useTabs<T extends string>(ids: readonly T[], initial: T) {
  const [active, setActive] = useState<T>(initial);
  const baseId = useId();
  const tabId = (id: T) => `${baseId}-tab-${id}`;
  const panelId = `${baseId}-panel`;

  function onKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    const index = ids.indexOf(active);
    if (index < 0) return;
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (index + 1) % ids.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (index - 1 + ids.length) % ids.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = ids.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const nextId = ids[next];
    if (nextId === undefined) return;
    setActive(nextId);
    document.getElementById(tabId(nextId))?.focus();
  }

  function tabProps(id: T) {
    return {
      id: tabId(id),
      role: 'tab' as const,
      'aria-selected': active === id,
      'aria-controls': panelId,
      tabIndex: active === id ? 0 : -1,
      onClick: () => setActive(id),
      onKeyDown,
    };
  }

  function panelProps() {
    return { id: panelId, role: 'tabpanel' as const, 'aria-labelledby': tabId(active) };
  }

  return { active, tabProps, panelProps };
}

/* ─── The browser: first viewport ───────────────────────────────────────── */

function SourceColumn({
  source,
  linked,
  onLink,
}: {
  source: Source;
  linked: string | null;
  onLink: (key: string | null) => void;
}) {
  return (
    <div className="landing-col" data-source={source.agent}>
      <div className="landing-col-head">
        <code title={source.path}>{source.path}</code>
        <span>{source.plans.length} items</span>
      </div>
      <ul className="landing-rows" aria-label={`${source.label} plans (illustrative)`}>
        {source.plans.map((p) => (
          <li
            key={p.key}
            data-plan={p.key}
            className={`landing-row${linked === p.key ? ' is-linked' : ''}`}
            onMouseEnter={(e) => {
              onLink(p.key);
              e.currentTarget
                .closest('.landing-browser')
                ?.querySelector(`[data-index-row="${p.key}"]`)
                ?.scrollIntoView({ block: 'nearest' });
            }}
            onMouseLeave={() => onLink(null)}
          >
            <DocIcon />
            <span className="landing-row-name">{p.name}</span>
            <span className="landing-row-meta">{p.age}</span>
          </li>
        ))}
      </ul>
      <div className="landing-col-foot" aria-hidden="true">
        <span>{source.label}</span>
        <span>{source.plans.length} items · illustrative</span>
      </div>
    </div>
  );
}

function InstallRow() {
  const tabs = useTabs(HERO_INSTALL_IDS, 'unix');
  const active =
    HERO_INSTALL_COMMANDS.find((o) => o.id === tabs.active) ?? HERO_INSTALL_COMMANDS[0];
  const { copied, copy } = useCopy(active.cmd);

  return (
    <div className="landing-install">
      <div className="landing-install-tabs" role="tablist" aria-label="Install platform">
        {HERO_INSTALL_COMMANDS.map((option) => (
          <button
            key={option.id}
            type="button"
            className="landing-install-tab"
            {...tabs.tabProps(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="landing-install-cmd" {...tabs.panelProps()}>
        <span aria-hidden="true">{active.prompt}</span>
        <code>{active.cmd}</code>
        <button
          type="button"
          className="landing-copy-key"
          onClick={copy}
          aria-label={copied ? 'Copied' : 'Copy install command'}
        >
          <CopyIcon copied={copied} />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="landing-install-after">
        Then <code>agendex configure</code>, <code>agendex add-dir ~/plans --live</code>,{' '}
        <code>agendex open</code>.
      </p>
    </div>
  );
}

/**
 * The signature interaction: index rows FLIP from their source twins into
 * place once, after the page settles. Hovering either side links the pair.
 */
function useCollate(browserRef: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = browserRef.current;
    if (!root) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    if (window.innerWidth <= 960) return undefined;

    const browser = root;
    const indexRows = Array.from(browser.querySelectorAll<HTMLElement>('[data-index-row]'));
    const animations: Animation[] = [];
    let started = false;
    browser.classList.add('is-collating');

    function run() {
      if (started) return;
      started = true;
      window.removeEventListener('scroll', run);
      window.clearTimeout(idle);
      let pending = 0;
      indexRows.forEach((row, i) => {
        const key = row.dataset.indexRow;
        const twin = browser.querySelector<HTMLElement>(`[data-plan="${key}"]`);
        if (!twin) return;
        const from = twin.getBoundingClientRect();
        const to = row.getBoundingClientRect();
        const dx = from.left - to.left;
        const dy = from.top - to.top;
        pending += 1;
        const anim = row.animate(
          [
            { transform: `translate(${dx}px, ${dy}px)`, opacity: 0 },
            { transform: `translate(${dx}px, ${dy}px)`, opacity: 0.6, offset: 0.08 },
            { transform: 'translate(0, 0)', opacity: 1 },
          ],
          {
            duration: 640,
            delay: i * 34,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            fill: 'both',
          },
        );
        anim.onfinish = () => {
          pending -= 1;
          if (pending === 0) browser.classList.remove('is-collating');
        };
        animations.push(anim);
      });
      if (pending === 0) browser.classList.remove('is-collating');
    }

    const idle = window.setTimeout(run, 1600);
    window.addEventListener('scroll', run, { passive: true, once: true });

    return () => {
      window.clearTimeout(idle);
      window.removeEventListener('scroll', run);
      animations.forEach((a) => a.cancel());
      browser.classList.remove('is-collating');
    };
  }, [browserRef]);
}

function LandingBrowser({
  onShowLogin,
  ctaSlot,
  handlers,
}: {
  onShowLogin: () => void;
  ctaSlot?: ReactNode;
  handlers: LandingNavHandlers;
}) {
  const browserRef = useRef<HTMLElement>(null);
  const [linked, setLinked] = useState<string | null>(null);
  const [selected, setSelected] = useState<number>(-1);
  useCollate(browserRef);

  function onIndexKey(e: React.KeyboardEvent<HTMLUListElement>) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    setSelected((s) => {
      const next = e.key === 'ArrowDown' ? s + 1 : s - 1;
      return Math.max(0, Math.min(INDEX_ROWS.length - 1, next));
    });
  }

  return (
    <section ref={browserRef} className="landing-browser" aria-label="How Agendex indexes plans">
      <div className="landing-sources">
        {SOURCES.map((source) => (
          <SourceColumn key={source.agent} source={source} linked={linked} onLink={setLinked} />
        ))}
      </div>

      <div className="landing-col landing-col--index">
        <div className="landing-col-head">
          <code>Agendex › Local index</code>
          <span>{INDEX_ROWS.length} items · illustrative</span>
        </div>

        <div className="landing-index-intro">
          <h1>Your agents make plans. Agendex keeps watch.</h1>
          <p>
            Every plan your agents write, in one searchable column. Local by default; sync to Cloud
            Pro when review needs another person.
          </p>
        </div>

        <div className="relative">
          <InstallRow />
        </div>

        <ul
          className="landing-rows"
          // A Finder-style column is a listbox with arrow-key selection; a <select> would change its semantics.
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
          role="listbox"
          aria-label="Collated plans (illustrative)"
          tabIndex={0}
          onKeyDown={onIndexKey}
          onBlur={() => setSelected(-1)}
        >
          {INDEX_ROWS.map((row, i) => (
            <li
              key={row.key}
              role="option"
              aria-selected={selected === i}
              data-index-row={row.key}
              className={`landing-row${linked === row.key ? ' is-linked' : ''}${
                selected === i ? ' is-selected' : ''
              }`}
              onMouseEnter={() => setLinked(row.key)}
              onMouseLeave={() => setLinked(null)}
            >
              <AgentIcon agent={row.agent} size={14} />
              <span className="landing-row-name">{row.name}</span>
              <span className="landing-row-ws">{row.ws}</span>
              <span className="landing-row-meta">{row.age}</span>
            </li>
          ))}
        </ul>

        <ul className="landing-index-links">
          <li>
            <a
              href="/docs"
              onClick={landingNavClickHandler('/docs', handlers)}
              className="landing-row"
            >
              <DocIcon />
              <span className="landing-row-name">Read the docs</span>
              <ChevronIcon />
            </a>
          </li>
          <li>
            {ctaSlot ?? (
              <button type="button" onClick={onShowLogin} className="landing-row w-full text-left">
                <DocIcon />
                <span className="landing-row-name">Connect a running dashboard</span>
                <ChevronIcon />
              </button>
            )}
          </li>
          <li>
            <a
              href="/download"
              onClick={landingNavClickHandler('/download', handlers)}
              className="landing-row"
            >
              <DocIcon />
              <span className="landing-row-name">Agendex Desktop</span>
              <span className="landing-row-ws">Cloud Pro</span>
              <ChevronIcon />
            </a>
          </li>
        </ul>
      </div>
    </section>
  );
}

function PathBar() {
  const { resolvedTheme } = useTheme();
  return (
    <div className="landing-pathbar" aria-hidden="true">
      <div className="landing-pathbar-crumbs">
        <DexMascot variant={resolvedTheme === 'light' ? 'light' : 'dark'} size={20} decorative />
        <b>Agendex</b>
        <ChevronIcon size={10} />
        <span>Local index</span>
        <ChevronIcon size={10} />
        <span>3 sources watched</span>
      </div>
      <div className="landing-pathbar-status">
        {SUPPORTED_AGENTS.length} agent integrations · local by default
      </div>
    </div>
  );
}

/* ─── Sections ──────────────────────────────────────────────────────────── */

function ReviewSection() {
  return (
    <section id="features" className="landing-band" style={SECTION_SCROLL_STYLE}>
      <div className="landing-band-inner">
        <h2 className="landing-h2">Review the plan before it disappears into an agent log.</h2>
        <p className="landing-lede">
          The plan itself is the review surface, with enough source detail to trust what changed and
          where it came from. Cloud review adds two more columns when the work is shared.
        </p>

        <div
          className="landing-columns mt-8"
          style={{ gridTemplateColumns: 'minmax(0,0.9fr) minmax(0,1.1fr) minmax(0,1fr)' }}
        >
          <div>
            <div className="landing-col-head">
              <code>Local index</code>
              <span>free · illustrative</span>
            </div>
            <ul className="landing-rows">
              {INDEX_ROWS.slice(0, 6).map((row, i) => (
                <li key={row.key} className={`landing-row${i === 0 ? ' is-linked' : ''}`}>
                  <AgentIcon agent={row.agent} size={14} />
                  <span className="landing-row-name">{row.name}</span>
                  <span className="landing-row-meta">{row.age}</span>
                </li>
              ))}
            </ul>
            <ul className="m-0 list-none border-t border-[var(--landing-border-subtle)] p-4 text-[13px] leading-[1.6] text-[var(--landing-muted)]">
              {PLAN_REVIEW_BULLETS.map((b) => (
                <li key={b} className="mt-2 first:mt-0">
                  {b}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="landing-col-head">
              <code>Preview</code>
              <span>illustrative</span>
            </div>
            <div className="landing-preview">
              <div className="t">Rate limit rollout plan</div>
              <div className="mt-2 text-[11.5px] text-[var(--landing-faint)]">
                claude-code · api · 2m ago · source linked
              </div>
              <div className="h mt-4">## Execution notes</div>
              <div>- Add per-user token bucket</div>
              <div>- Gate rollout behind config</div>
              <div>- Watch 429 rate after deploy</div>
              <div className="h mt-3">## Rollback</div>
              <div>- Flip config; bucket state is ephemeral</div>
            </div>
          </div>
          <div>
            <div className="landing-col-head">
              <code>Cloud review</code>
              <span>Cloud Pro · illustrative</span>
            </div>
            <ul className="landing-rows">
              {[
                ['Ana', 'Can we stage this behind the workspace flag first?'],
                ['Sam', 'Yes, tag this as backend before sharing it wider.'],
                ['Agendex', 'Version 3 saved from the daemon sync.'],
              ].map(([name, note]) => (
                <li
                  key={note}
                  className="landing-row"
                  style={{
                    gridTemplateColumns: 'minmax(0,1fr)',
                    minHeight: 0,
                    padding: '8px 12px',
                  }}
                >
                  <span className="landing-row-name" style={{ whiteSpace: 'normal' }}>
                    <b className="text-[var(--landing-text)]">{name}</b>{' '}
                    <span className="text-[var(--landing-muted)]">{note}</span>
                  </span>
                </li>
              ))}
              <li
                className="landing-row is-linked"
                style={{ gridTemplateColumns: 'minmax(0,1fr)' }}
              >
                <span className="landing-row-name text-[var(--landing-accent)]">
                  Share link copied. Scope: this plan only.
                </span>
              </li>
            </ul>
            <ul className="m-0 list-none border-t border-[var(--landing-border-subtle)] p-4 text-[13px] leading-[1.6] text-[var(--landing-muted)]">
              {CLOUD_REVIEW_BULLETS.map((b) => (
                <li key={b} className="mt-2 first:mt-0">
                  {b}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function SourcesSection({ handlers }: { handlers: LandingNavHandlers }) {
  return (
    <section className="landing-band" style={SECTION_SCROLL_STYLE}>
      <div className="landing-band-inner grid items-start gap-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div>
          <h2 className="landing-h2">Every adapter is a folder we watch.</h2>
          <p className="landing-lede">
            Agendex knows where each agent keeps its plans and how to parse them. Custom directories
            cover everything else.
          </p>
          <div className="mt-6 landing-list">
            <div className="landing-list-head">
              How it fits together <span>3 steps</span>
            </div>
            {PRODUCT_STEPS.map((step, i) => (
              <div key={step.title} className="landing-list-row">
                <b>{i + 1}</b>
                <div>
                  <span className="font-semibold">{step.title}</span>
                  <p>{step.body}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4">
            <ActionLink href="/docs" onClick={landingNavClickHandler('/docs', handlers)}>
              Open docs
            </ActionLink>
          </div>
        </div>
        <div className="landing-list">
          <div className="landing-list-head">
            Sources <span>{SUPPORTED_AGENTS.length} adapters · more via custom directories</span>
          </div>
          <ul className="m-0 grid list-none p-0 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
            {SUPPORTED_AGENTS.map((a) => (
              <li
                key={a.agent}
                className="landing-row border-b border-[var(--landing-border-subtle)]"
                style={{ gridTemplateColumns: '18px minmax(0,1fr)' }}
              >
                <AgentIcon agent={a.agent} size={14} />
                <span className="landing-row-name">{a.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function PricingToggle({ yearly, onChange }: { yearly: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      className="inline-flex w-fit gap-0.5 rounded-[7px] border border-[var(--landing-border)] bg-[var(--landing-surface-raised)] p-0.5"
      aria-label="Billing cadence"
    >
      {(['Monthly', 'Yearly'] as const).map((label) => {
        const active = label === 'Yearly' ? yearly : !yearly;
        return (
          <button
            key={label}
            type="button"
            onClick={() => onChange(label === 'Yearly')}
            data-active={active}
            className="min-h-[30px] rounded-[5px] border-0 bg-transparent px-3 text-[12.5px] font-semibold text-[var(--landing-muted)] data-[active=true]:bg-[var(--landing-index-bg)] data-[active=true]:text-[var(--landing-accent-ink)]"
          >
            {label}
            {label === 'Yearly' && <span className="ml-1.5 font-medium opacity-80">Save 17%</span>}
          </button>
        );
      })}
    </div>
  );
}

function PricingVolume({
  title,
  price,
  period,
  summary,
  features,
  cta,
  onCta,
  note,
  isPro,
  signingIn,
}: {
  title: string;
  price: string;
  period?: string;
  summary: string;
  features: readonly string[];
  cta: ReactNode;
  onCta?: () => void;
  note?: typeof MONEY_BACK_GUARANTEE;
  isPro?: boolean;
  signingIn?: boolean;
}) {
  return (
    <article className="landing-list flex flex-col">
      <div className="landing-list-head">
        {title}
        <span>
          <b
            key={price}
            className="landing-price-swap text-[15px] font-bold text-[var(--landing-text)]"
          >
            {price}
          </b>
          {period && (
            <em key={period} className="landing-price-swap landing-price-swap--trail not-italic">
              {period}
            </em>
          )}
        </span>
      </div>
      <p className="m-0 border-b border-[var(--landing-border-subtle)] px-[14px] py-3 text-[13.5px] leading-[1.6] text-[var(--landing-muted)]">
        {summary}
      </p>
      <ul className="m-0 list-none p-0">
        {features.map((f) => (
          <li key={f} className="landing-row border-b border-[var(--landing-border-subtle)]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="m5 12 4.5 4.5L19 7"
                stroke="var(--landing-accent)"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="landing-row-name" style={{ whiteSpace: 'normal' }}>
              {f}
            </span>
          </li>
        ))}
      </ul>
      <div className="p-[14px]">
        {note && (
          <p className="m-0 mb-3 text-[12.5px] leading-[1.55] text-[var(--landing-muted)]">
            <b className="text-[var(--landing-text)]">{note.label}.</b> {note.body}
          </p>
        )}
        {onCta ? (
          <button
            type="button"
            onClick={onCta}
            disabled={signingIn}
            className={`landing-action landing-action--full ${
              isPro ? 'landing-action--primary' : 'landing-action--secondary'
            }`}
          >
            {signingIn ? <Spinner size={13} /> : null}
            {cta}
          </button>
        ) : (
          cta
        )}
      </div>
    </article>
  );
}

function PricingSection({
  yearly,
  signingIn,
  onSetYearly,
  onShowLogin,
  proCtaSlot,
}: {
  yearly: boolean;
  signingIn: boolean;
  onSetYearly: (v: boolean) => void;
  onShowLogin: () => void;
  proCtaSlot?: ReactNode;
}) {
  return (
    <section id="pricing" className="landing-band" style={SECTION_SCROLL_STYLE}>
      <div className="landing-band-inner">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <h2 className="landing-h2">
              Start with local search. Add cloud review when the work is shared.
            </h2>
            <p className="landing-lede">
              The free path is the local OSS index. Cloud Pro adds daemon sync, links, comments,
              history, tags, collections, and workspace access without changing where plans
              originate.
            </p>
          </div>
          <PricingToggle yearly={yearly} onChange={onSetYearly} />
        </div>
        <div className="mt-8 grid items-start gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <PricingVolume
            title="Self-hosted"
            price="$0"
            summary="For indexing and searching local agent plans, sessions, custom folders, and fallback plans on one machine."
            features={FREE_FEATURES}
            cta="Get started"
            onCta={onShowLogin}
          />
          <PricingVolume
            title="Cloud Pro"
            price={yearly ? '$69' : '$7'}
            period={yearly ? '/year' : '/month'}
            summary="For syncing local plans to the cloud dashboard with sharing, comments, history, tags, collections, and team access."
            features={PRO_FEATURES}
            cta={proCtaSlot ?? 'Start free trial'}
            onCta={proCtaSlot ? undefined : onShowLogin}
            note={MONEY_BACK_GUARANTEE}
            isPro
            signingIn={signingIn}
          />
        </div>
      </div>
    </section>
  );
}

function FAQItem({
  question,
  answer,
  open,
  onToggle,
}: {
  question: string;
  answer: string;
  open: boolean;
  onToggle: () => void;
}) {
  const buttonId = useId();
  const contentId = useId();
  return (
    <div className="landing-disclosure">
      <button
        id={buttonId}
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={contentId}
        className="landing-disclosure-btn"
      >
        <ChevronIcon />
        <span className="text-pretty">{question}</span>
      </button>
      <section
        id={contentId}
        aria-labelledby={buttonId}
        aria-hidden={!open}
        className="landing-disclosure-body"
        data-open={open}
      >
        <div>
          <p>{answer}</p>
        </div>
      </section>
    </div>
  );
}

function FAQSection({
  openFaq,
  onSetOpenFaq,
}: {
  openFaq: number | null;
  onSetOpenFaq: (v: number | null) => void;
}) {
  return (
    <section id="faq" className="landing-band" style={SECTION_SCROLL_STYLE}>
      <div className="landing-band-inner grid gap-8 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div>
          <h2 className="landing-h2">Answers before you install.</h2>
          <p className="landing-lede">
            Privacy, adapters, and Cloud sync in plain terms. No account is required to start
            self-hosted.
          </p>
        </div>
        <div className="landing-list">
          <div className="landing-list-head">
            Questions <span>{FAQ_ITEMS.length} items</span>
          </div>
          {FAQ_ITEMS.map((item, index) => (
            <FAQItem
              key={item.q}
              question={item.q}
              answer={item.a}
              open={openFaq === index}
              onToggle={() => onSetOpenFaq(openFaq === index ? null : index)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function CliInstallOptions() {
  const tabs = useTabs(CLI_INSTALL_IDS, 'installer');
  const active =
    CLI_INSTALL_OPTIONS.find((option) => option.id === tabs.active) ?? CLI_INSTALL_OPTIONS[0];
  const { copied, copy } = useCopy(active.cmd);

  return (
    <div className="landing-list">
      <div className="landing-list-head">
        <div className="flex flex-wrap gap-0.5" role="tablist" aria-label="Package manager">
          {CLI_INSTALL_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              {...tabs.tabProps(option.id)}
              className="rounded-[5px] border-0 bg-transparent px-2 py-1 text-[12px] font-semibold text-[var(--landing-muted)] aria-selected:bg-[var(--landing-index-bg)] aria-selected:text-[var(--landing-accent-ink)]"
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3 px-[14px] py-3" {...tabs.panelProps()}>
        <code className="landing-cmd-text min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-[var(--landing-mono)] text-[13px] text-[var(--landing-text)]">
          {active.cmd}
        </code>
        <button
          type="button"
          className="landing-action landing-action--compact"
          onClick={copy}
          aria-label={copied ? 'Copied' : 'Copy install command'}
        >
          <CopyIcon copied={copied} />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

function ClosingSection() {
  return (
    <section className="landing-band" style={SECTION_SCROLL_STYLE}>
      <div className="landing-band-inner mx-auto max-w-[640px]">
        <h2 className="landing-h2">Install in one command.</h2>
        <p className="landing-lede">
          Start with a local index. Add Cloud Pro when review moves across people and machines.
        </p>
        <div className="mt-6">
          <CliInstallOptions />
        </div>
      </div>
    </section>
  );
}

function LandingFooter({ handlers }: { handlers: LandingNavHandlers }) {
  return (
    <footer className="landing-statusbar">
      <span>© 2026 Agendex</span>
      <nav aria-label="Footer">
        <a href="#features">Features</a>
        <a href="#pricing">Pricing</a>
        {LANDING_LINKS.map((link) => (
          <a key={link.href} href={link.href} onClick={landingNavClickHandler(link.href, handlers)}>
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
  );
}

/* ─── Login modal ───────────────────────────────────────────────────────── */

function LoginModal({
  tokenValue,
  tokenError,
  onTokenChange,
  onSubmit,
  onClose,
}: {
  tokenValue: string;
  tokenError: string;
  onTokenChange: (v: string) => void;
  onSubmit: (e: { preventDefault: () => void }) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const describedBy = tokenError ? `${hintId} ${errorId}` : hintId;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-[var(--z-overlay)] flex items-center justify-center bg-[color-mix(in_oklch,var(--landing-text)_40%,transparent)] p-5"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={onSubmit}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="landing-list w-[min(100%,430px)] shadow-[0_18px_40px_rgba(0,0,0,0.24)]"
      >
        <div className="landing-list-head">
          <span id={titleId} className="!text-[var(--landing-text)] !font-semibold">
            Connect to Agendex
          </span>
        </div>
        <div className="p-5">
          <p
            id={descriptionId}
            className="m-0 mb-5 text-[13.5px] leading-[1.6] text-[var(--landing-muted)]"
          >
            Paste the auth token printed by the local Agendex CLI. The token stays in this browser.
          </p>
          <label
            htmlFor={inputId}
            className="mb-2 block text-[12.5px] font-semibold text-[var(--landing-text)]"
          >
            CLI auth token
          </label>
          <input
            id={inputId}
            value={tokenValue}
            onChange={(e) => onTokenChange(e.target.value)}
            placeholder="agx_..."
            aria-invalid={tokenError ? 'true' : 'false'}
            aria-describedby={describedBy}
            className="w-full rounded-[6px] border border-[var(--landing-border-strong)] bg-[var(--landing-bg)] px-3 py-[10px] font-[var(--landing-mono)] text-[13px] leading-[1.4] text-[var(--landing-text)] outline-none placeholder:text-[var(--landing-faint)] focus:border-[var(--landing-accent)]"
          />
          <p
            id={hintId}
            className="mt-2 mb-0 text-[12px] leading-[1.55] text-[var(--landing-muted)]"
          >
            Run <code>agendex login</code> or start the local server to print a fresh token.
          </p>
          {tokenError && (
            <p
              id={errorId}
              role="alert"
              className="mt-2 mb-0 text-[12px] font-semibold leading-[1.5] text-[var(--landing-error)]"
            >
              {tokenError}
            </p>
          )}
          <button
            type="submit"
            className="landing-action landing-action--primary landing-action--full mt-4"
          >
            Connect dashboard
          </button>
          <button
            type="button"
            onClick={onClose}
            className="landing-action landing-action--full mt-2 border-transparent bg-transparent"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

/* ─── Slots, state, page ────────────────────────────────────────────────── */

function isSlotComponent(type: unknown): type is SlotComponent {
  return typeof type === 'function' && typeof (type as SlotComponent)._slotName === 'string';
}

function extractSlots(children: ReactNode): Record<string, SlotRenderFn> {
  const slots: Record<string, SlotRenderFn> = {};
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if (!isSlotComponent(child.type)) return;
    const props = child.props as Record<string, unknown>;
    if (typeof props.children === 'function') {
      slots[child.type._slotName] = props.children as SlotRenderFn;
    }
  });
  return slots;
}

type LandingAction = Parameters<typeof landingReducer>[1];
type LandingDispatch = (action: LandingAction) => void;

function useLandingSlots(children: ReactNode) {
  const slots = useMemo(() => extractSlots(children), [children]);
  return {
    navbarAuthNode: slots.NavbarAuth ? slots.NavbarAuth() : undefined,
    heroCtaNode: slots.HeroCta ? slots.HeroCta() : undefined,
    pricingCtaNode: slots.PricingCta ? slots.PricingCta() : undefined,
  };
}

function useInitialHashScroll() {
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    const target = document.getElementById(hash);
    if (!target) return;
    requestAnimationFrame(() => {
      target.scrollIntoView({ block: 'start' });
    });
  }, []);
}

function useLandingContextValue({
  signingIn,
  activeTab,
  openLogin,
  dispatch,
}: {
  signingIn: boolean;
  activeTab: LandingTab;
  openLogin: () => void;
  dispatch: LandingDispatch;
}) {
  return useMemo<LandingContextValue>(
    () => ({
      signingIn,
      activeTab,
      showLogin: () => startViewTransition(openLogin),
      startSigningIn: () => dispatch({ type: 'START_SIGNING_IN' }),
      stopSigningIn: () => dispatch({ type: 'STOP_SIGNING_IN' }),
    }),
    [signingIn, activeTab, openLogin, dispatch],
  );
}

function useLandingActions(
  token: string,
  tokenError: string,
  dispatch: LandingDispatch,
  setTokenError: (message: string) => void,
) {
  const setTokenValue = (nextToken: string) => {
    if (tokenError) setTokenError('');
    dispatch({ type: 'SET_TOKEN', value: nextToken });
  };
  const openLogin = () => dispatch({ type: 'SET_SHOW_LOGIN', value: true });
  const closeLogin = () => {
    setTokenError('');
    dispatch({ type: 'SET_SHOW_LOGIN', value: false });
  };
  const setYearly = (useYearlyBilling: boolean) =>
    dispatch({ type: 'SET_YEARLY', value: useYearlyBilling });
  const setOpenFaq = (nextOpenFaq: number | null) =>
    dispatch({ type: 'SET_OPEN_FAQ', value: nextOpenFaq });

  function submit(e: { preventDefault: () => void }) {
    e.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) {
      setTokenError('Paste the token printed by the Agendex CLI before connecting.');
      return;
    }
    setToken(trimmed);
    window.location.reload();
  }

  return { setTokenValue, openLogin, closeLogin, setYearly, setOpenFaq, submit };
}

function LandingPageInner({
  children,
  onShowChangelog,
  onShowDocs,
  onShowDownload,
  onShowTools,
}: LandingPageProps) {
  const [state, dispatch] = useReducer(landingReducer, LANDING_INITIAL);
  const [tokenError, setTokenError] = useState('');
  const { token, showLogin, yearly, openFaq, activeTab, signingIn } = state;
  const actions = useLandingActions(token, tokenError, dispatch, setTokenError);
  const ctxValue = useLandingContextValue({
    signingIn,
    activeTab,
    openLogin: actions.openLogin,
    dispatch,
  });
  const { navbarAuthNode, heroCtaNode, pricingCtaNode } = useLandingSlots(children);
  const handlers: LandingNavHandlers = { onShowDownload, onShowDocs, onShowChangelog, onShowTools };

  useInitialHashScroll();

  return (
    <LandingContext.Provider value={ctxValue}>
      <div className="landing-page [&_a[href]]:cursor-pointer [&_button:not(:disabled)]:cursor-pointer">
        <LandingToolbar current="/" handlers={handlers} authSlot={navbarAuthNode} />

        <LandingBrowser
          onShowLogin={() => startViewTransition(actions.openLogin)}
          ctaSlot={heroCtaNode}
          handlers={handlers}
        />
        <PathBar />

        <ReviewSection />
        <SourcesSection handlers={handlers} />
        <PricingSection
          yearly={yearly}
          signingIn={signingIn}
          onSetYearly={actions.setYearly}
          onShowLogin={() => startViewTransition(actions.openLogin)}
          proCtaSlot={pricingCtaNode}
        />
        <FAQSection openFaq={openFaq} onSetOpenFaq={actions.setOpenFaq} />
        <ClosingSection />
        <LandingFooter handlers={handlers} />

        {showLogin && (
          <LoginModal
            tokenValue={token}
            tokenError={tokenError}
            onTokenChange={actions.setTokenValue}
            onSubmit={actions.submit}
            onClose={() => startViewTransition(actions.closeLogin)}
          />
        )}
      </div>
    </LandingContext.Provider>
  );
}

export function LandingPage({
  children,
  mascot,
  onShowChangelog,
  onShowDocs,
  onShowDownload,
  onShowTools,
}: LandingPageProps = {}) {
  return (
    <LandingPageInner
      mascot={mascot}
      onShowChangelog={onShowChangelog}
      onShowDocs={onShowDocs}
      onShowDownload={onShowDownload}
      onShowTools={onShowTools}
    >
      {children}
    </LandingPageInner>
  );
}

LandingPage.NavbarAuth = NavbarAuth;
LandingPage.HeroCta = HeroCta;
LandingPage.PricingCta = PricingCta;
