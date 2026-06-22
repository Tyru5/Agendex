import React, { useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { gsap } from 'gsap';
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
import { LandingMascot, type LandingMascotProps } from './landing/LandingMascot.tsx';
import { NavbarAuth, HeroCta, PricingCta } from './landing/LandingSlots.tsx';
import type { SlotRenderFn, SlotComponent } from './landing/LandingSlots.tsx';
import { AgentIcon } from './AgentIcon.tsx';
import { GitHubIcon } from './OAuthIcons.tsx';

function Spinner({ size = 14, color }: { size?: number; color?: string }) {
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
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke={color ?? 'currentColor'}
        strokeWidth="3"
        opacity={0.25}
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke={color ?? 'currentColor'}
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

const ACCENT = '#c8ff32';
const BG = '#070b14';
const BORDER = 'rgba(236, 241, 232, 0.13)';
const TEXT_PRIMARY = '#eef4e8';
const TEXT_MUTED = '#9aa5ad';
const LANDING_ANCHOR_OFFSET = 88;
const LANDING_LINKS = [
  { href: '/docs', label: 'Docs' },
  { href: '/changelog', label: 'Changelog' },
] as const;
type LandingTab = 'local' | 'cloud';

export interface LandingPageProps {
  children?: ReactNode;
  mascot?: LandingMascotProps;
  onShowChangelog?: () => void;
  onShowDocs?: () => void;
}

const HERO_AGENT_CHIPS = [
  { agent: 'claude-code', label: 'Claude Code' },
  { agent: 'codex-cli', label: 'Codex' },
  { agent: 'oh-my-opencode', label: 'OpenCode' },
] as const;

const PLAN_REVIEW_BULLETS = [
  'Source path, agent, workspace, recency, and plan state stay visible together.',
  'Full-text search moves across watched agent output and custom plan folders.',
  'Low-value plans can be hidden while the raw local files remain readable.',
  'Cloud sync can start from the same local index when review needs another person.',
] as const;

const CODE_REVIEW_BULLETS = [
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

const SECTION_FRAME_CLASS =
  'landing-frame border-b border-[var(--landing-border-subtle)] px-[clamp(18px,5vw,72px)]';

const SECTION_SCROLL_STYLE = { scrollMarginTop: LANDING_ANCHOR_OFFSET };

function ActionLink({
  href,
  children,
  variant = 'secondary',
}: {
  href: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary';
}) {
  return (
    <a
      href={href}
      target={href.startsWith('http') ? '_blank' : undefined}
      rel={href.startsWith('http') ? 'noopener noreferrer' : undefined}
      className={`landing-action landing-action--${variant}`}
    >
      {children}
    </a>
  );
}

function ActionButton({
  children,
  onClick,
  variant = 'secondary',
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`landing-action landing-action--${variant}`}
    >
      {children}
    </button>
  );
}

function CliInstallOptions() {
  const [activeOption, setActiveOption] =
    useState<(typeof CLI_INSTALL_OPTIONS)[number]['id']>('installer');
  const [copied, setCopied] = useState(false);
  const active =
    CLI_INSTALL_OPTIONS.find((option) => option.id === activeOption) ?? CLI_INSTALL_OPTIONS[0];
  const cmd = active.cmd;

  function copy() {
    navigator.clipboard?.writeText(cmd).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  }

  return (
    <div className="rounded-[7px] border border-[var(--landing-border-subtle)] bg-[color-mix(in_oklch,var(--landing-bg)_74%,transparent)] p-2.5">
      <div className="mb-2 flex flex-wrap gap-1.5">
        {CLI_INSTALL_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setActiveOption(option.id)}
            className={`rounded-[5px] border px-2 py-1 text-[11px] font-semibold leading-none transition-colors duration-150 ${
              activeOption === option.id
                ? 'border-[color-mix(in_oklch,var(--landing-accent)_34%,transparent)] bg-[color-mix(in_oklch,var(--landing-accent)_12%,transparent)] text-[var(--landing-accent)]'
                : 'border-transparent bg-transparent text-[var(--landing-muted)] hover:text-[var(--landing-text)]'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace] text-[12px] leading-[1.6] text-[var(--landing-accent)]">
          {cmd}
        </code>
        <button
          type="button"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-[6px] border border-[var(--landing-border)] bg-[var(--landing-surface)] text-[var(--landing-muted)] hover:border-[var(--landing-border-strong)] hover:text-[var(--landing-text)]"
          onClick={copy}
          aria-label="Copy install command"
        >
          {copied ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M20 6 9 17l-5-5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect
                x="9"
                y="9"
                width="11"
                height="11"
                rx="2"
                stroke="currentColor"
                strokeWidth="1.8"
              />
              <path
                d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

function LandingNavbar({
  mobileMenuOpen,
  onMobileMenuToggle,
  onMobileMenuClose,
  onShowChangelog,
  onShowDocs,
}: {
  mobileMenuOpen: boolean;
  onMobileMenuToggle: () => void;
  onMobileMenuClose: () => void;
  onShowChangelog?: () => void;
  onShowDocs?: () => void;
}) {
  function handleChangelogClick(e: MouseEvent<HTMLAnchorElement>) {
    if (!onShowChangelog) return;
    e.preventDefault();
    onShowChangelog();
    onMobileMenuClose();
  }

  function handleDocsClick(e: MouseEvent<HTMLAnchorElement>) {
    if (!onShowDocs) return;
    e.preventDefault();
    onShowDocs();
    onMobileMenuClose();
  }

  return (
    <nav
      className="fixed inset-x-0 top-0 z-[100] border-b border-[var(--landing-border-subtle)] bg-[var(--landing-bg)]/96"
      data-landing-animate="nav"
    >
      <div className="flex min-h-[49px] items-center justify-between gap-5 px-[18px]">
        <a
          href="/"
          onClick={onMobileMenuClose}
          className="shrink-0 text-[16px] font-bold text-[var(--landing-text)] no-underline"
        >
          Agendex<span className="text-[var(--landing-accent)]">.</span>
        </a>

        <div className="flex min-w-0 items-center gap-3 text-[13px] font-medium max-[860px]:hidden">
          {LANDING_LINKS.map((link) => (
            <React.Fragment key={link.href}>
              <a
                href={link.href}
                onClick={link.href === '/docs' ? handleDocsClick : handleChangelogClick}
                className="text-[var(--landing-muted)] no-underline transition-colors duration-150 hover:text-[var(--landing-text)]"
              >
                {link.label}
              </a>
              <span className="text-[var(--landing-border-strong)]" aria-hidden="true">
                |
              </span>
            </React.Fragment>
          ))}
          <a
            href="https://github.com/tiru5/agendex"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--landing-muted)] no-underline transition-colors duration-150 hover:text-[var(--landing-text)]"
          >
            GitHub
          </a>
          <MoonIcon />
        </div>

        <button
          type="button"
          aria-controls="landing-mobile-menu"
          aria-expanded={mobileMenuOpen}
          onClick={onMobileMenuToggle}
          className="hidden size-[38px] shrink-0 items-center justify-center rounded-[7px] border border-[var(--landing-border)] bg-[var(--landing-surface)] text-[var(--landing-text)] max-[860px]:inline-flex"
        >
          <span className="sr-only">Toggle navigation</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d={mobileMenuOpen ? 'M6 6l12 12M18 6 6 18' : 'M4 7h16M4 12h16M4 17h16'}
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      <div
        id="landing-mobile-menu"
        className={`landing-frame border-t border-[var(--landing-border-subtle)] px-5 py-4 min-[861px]:hidden ${
          mobileMenuOpen ? 'block' : 'hidden'
        }`}
      >
        <div className="flex flex-col gap-2.5">
          {LANDING_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={link.href === '/docs' ? handleDocsClick : onMobileMenuClose}
              className="flex min-h-10 items-center rounded-[7px] border border-[var(--landing-border)] bg-[var(--landing-surface)] px-3 text-[13px] font-semibold text-[var(--landing-text)] no-underline"
            >
              {link.label}
            </a>
          ))}
        </div>
      </div>
    </nav>
  );
}

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

function LandingCursorIcon() {
  return (
    <svg
      className="landing-hero-cursor"
      width="42"
      height="42"
      viewBox="0 0 42 42"
      fill="none"
      aria-hidden="true"
    >
      <path
        data-landing-cursor-pointer
        d="M11 7.5 31 20.2l-9.1 2.2 5.2 8.9-4.6 2.7-5.1-8.8-6.4 6.2V7.5Z"
        fill="var(--landing-bg)"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <path
        data-landing-cursor-rays
        d="M28.3 9.8 32 6.5M31.6 14h4.8M24.5 7.8l1.4-4.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function HeroAgentStrip() {
  return (
    <div className="landing-hero-agents" aria-label="Supported agents">
      {HERO_AGENT_CHIPS.map((agent) => (
        <span key={agent.label} className="landing-hero-agent">
          <span className="landing-hero-agent-mark">
            <AgentIcon agent={agent.agent} size={18} />
          </span>
          {agent.label}
        </span>
      ))}
    </div>
  );
}

function HeroInstallCommand() {
  const installCommand = 'curl -fsSL https://agendex.ai/install.sh | bash';
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard?.writeText(installCommand).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  }

  return (
    <div className="landing-hero-install">
      <div className="landing-hero-command">
        <span className="landing-hero-command-prompt" aria-hidden="true">
          $
        </span>
        <code>{installCommand}</code>
        <button
          type="button"
          onClick={copy}
          className="landing-hero-copy"
          aria-label="Copy install command"
        >
          {copied ? (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="m5 12 4 4L19 6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect
                x="8"
                y="8"
                width="12"
                height="12"
                rx="2"
                stroke="currentColor"
                strokeWidth="1.7"
              />
              <path
                d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
          )}
        </button>
      </div>

      <div className="landing-hero-runbook">
        <p>Then configure sources and open the dashboard:</p>
        <code>agendex configure</code>
        <code>agendex add-dir ~/path/to/plans --live</code>
        <code>agendex open</code>
      </div>
    </div>
  );
}

function HeroProofBar() {
  return (
    <div className="landing-hero-proof">
      <div>
        <GitHubIcon size={15} />
        <span className="landing-hero-star" aria-hidden="true">
          ●
        </span>
        <span>Live local plan index</span>
      </div>
      <div>Source paths, agents, workspaces, and raw markdown stay inspectable.</div>
      <div>Cloud sync only when enabled</div>
    </div>
  );
}

function LandingHero({ onShowLogin, ctaSlot }: { onShowLogin: () => void; ctaSlot?: ReactNode }) {
  const [syncAnimationKey, setSyncAnimationKey] = useState(0);
  const syncAnimationTimerRef = useRef<number | null>(null);
  const isSyncAnimationVisible = syncAnimationKey > 0;

  useEffect(() => {
    return () => {
      if (syncAnimationTimerRef.current !== null) {
        window.clearTimeout(syncAnimationTimerRef.current);
      }
    };
  }, []);

  function renderSyncingAnimation() {
    if (syncAnimationTimerRef.current !== null) {
      window.clearTimeout(syncAnimationTimerRef.current);
    }

    setSyncAnimationKey((key) => key + 1);
    syncAnimationTimerRef.current = window.setTimeout(() => {
      setSyncAnimationKey(0);
      syncAnimationTimerRef.current = null;
    }, 1800);
  }

  return (
    <div className="landing-hero-shell" data-landing-animate="hero-shell">
      <div className="landing-hero-content">
        <h1 className="landing-hero-title" data-landing-animate-item>
          Your Agents Make Plans.
          <br />
          <span>Agendex Keeps Watch</span>
        </h1>

        <div className="landing-hero-copy-block" data-landing-animate-item>
          <LandingCursorIcon />
          <p>
            <button
              key={syncAnimationKey}
              type="button"
              className="landing-hero-index-trigger"
              onClick={renderSyncingAnimation}
              aria-label={
                isSyncAnimationVisible
                  ? 'Syncing index'
                  : 'Render syncing animation for the local plan index'
              }
            >
              {isSyncAnimationVisible ? (
                <svg
                  className="landing-hero-sync-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M20 12a8 8 0 0 1-13.66 5.66L4 15.32M4 12A8 8 0 0 1 17.66 6.34L20 8.68M20 4v4.68h-4.68M4 20v-4.68h4.68"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                'Index'
              )}
              <span className="landing-hero-status" role="status" aria-live="polite">
                {isSyncAnimationVisible ? 'Syncing index' : ''}
              </span>
            </button>{' '}
            plan and session files from Claude Code, Codex, Cursor, Continue, OpenCode, and optional
            Plannotator sessions. Search local output first, then sync to Cloud Pro when the work
            needs sharing or review.
          </p>
          <div className="landing-hero-meta">
            Watches local files <span>|</span> filters by agent and workspace <span>|</span> syncs
            only when configured
          </div>
        </div>

        <HeroAgentStrip />
        <div data-landing-animate-item>
          <HeroInstallCommand />
        </div>

        <div className="landing-hero-actions" data-landing-animate-item>
          <ActionLink href="/docs">Read the docs</ActionLink>
          {ctaSlot ?? (
            <ActionButton onClick={onShowLogin} variant="primary">
              Connect dashboard
              <span aria-hidden="true">→</span>
            </ActionButton>
          )}
        </div>
      </div>

      <div data-landing-animate-item>
        <HeroProofBar />
      </div>
    </div>
  );
}

function ReviewSplit({
  title,
  body,
  bullets,
  variant,
}: {
  title: string;
  body: string;
  bullets: readonly string[];
  variant: 'plans' | 'teams';
}) {
  return (
    <div className="grid gap-8 border-b border-[var(--landing-border-subtle)] py-[70px] last:border-b-0 max-sm:py-[50px] lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.84fr)] lg:items-center">
      <div
        className={`rounded-[8px] border border-[var(--landing-border)] bg-[color-mix(in_oklch,var(--landing-bg)_78%,transparent)] p-4 ${
          variant === 'teams' ? 'lg:order-2' : ''
        }`}
      >
        <div className="mb-4 flex items-center gap-2 border-b border-[var(--landing-border-subtle)] pb-3 text-[12px] font-semibold text-[var(--landing-muted)]">
          <span className="size-2 rounded-full bg-[#ff5f56]" aria-hidden="true" />
          <span className="size-2 rounded-full bg-[#ffbd2e]" aria-hidden="true" />
          <span className="size-2 rounded-full bg-[#27c93f]" aria-hidden="true" />
          <span className="ml-2">{variant === 'plans' ? 'Local index' : 'Cloud review'}</span>
        </div>
        {variant === 'plans' ? <PlanReviewMock /> : <TeamReviewMock />}
      </div>

      <div className="max-w-[520px]">
        <h2 className="m-0 text-balance text-[30px] font-[740] leading-[1.08] tracking-[-0.025em] text-[var(--landing-text)] max-sm:text-[26px]">
          {title}
        </h2>
        <p className="mt-4 mb-0 text-[15px] leading-[1.7] text-[var(--landing-muted)]">{body}</p>
        <ul className="mt-6 space-y-3 p-0 text-[14px] leading-[1.65] text-[var(--landing-muted)]">
          {bullets.map((bullet) => (
            <li key={bullet} className="flex gap-3">
              <span className="mt-[0.72em] size-1.5 shrink-0 rounded-full bg-[var(--landing-accent)]" />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function PlanReviewMock() {
  return (
    <div className="space-y-3">
      <div className="rounded-[7px] border border-[var(--landing-border-subtle)] bg-[var(--landing-surface)] p-3">
        <div className="font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace] text-[11px] text-[var(--landing-faint)]">
          ~/work/api/.codex/tasks/rate-limit-rollout.md
        </div>
        <h3 className="mt-2 mb-0 text-[17px] font-bold text-[var(--landing-text)]">
          Rate limit rollout plan
        </h3>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {['Source linked', 'Workspace: api', 'Hidden: no'].map((item) => (
          <div
            key={item}
            className="rounded-[7px] border border-[var(--landing-border-subtle)] bg-[color-mix(in_oklch,var(--landing-bg)_78%,transparent)] px-3 py-2 text-[12px] font-semibold text-[var(--landing-muted)]"
          >
            {item}
          </div>
        ))}
      </div>
      <div className="rounded-[7px] border border-[var(--landing-border-subtle)] bg-[color-mix(in_oklch,var(--landing-bg)_82%,transparent)] p-3 font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace] text-[12px] leading-[1.7] text-[var(--landing-muted)]">
        <div className="text-[var(--landing-accent)]">## Execution notes</div>
        <div>- Add per-user token bucket</div>
        <div>- Gate rollout behind config</div>
        <div>- Watch 429 rate after deploy</div>
      </div>
    </div>
  );
}

function TeamReviewMock() {
  return (
    <div className="space-y-3">
      {[
        ['Ana', 'Can we stage this behind the workspace flag first?'],
        ['Sam', 'Yes, tag this as backend before sharing it wider.'],
        ['Agendex', 'Plan history saved from synced daemon payload.'],
      ].map(([name, note]) => (
        <div
          key={note}
          className="rounded-[7px] border border-[var(--landing-border-subtle)] bg-[var(--landing-surface)] p-3"
        >
          <div className="mb-1 text-[12px] font-bold text-[var(--landing-text)]">{name}</div>
          <div className="text-[13px] leading-[1.55] text-[var(--landing-muted)]">{note}</div>
        </div>
      ))}
      <div className="rounded-[7px] border border-[color-mix(in_oklch,var(--landing-accent)_25%,transparent)] bg-[color-mix(in_oklch,var(--landing-accent)_8%,transparent)] p-3 font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace] text-[12px] text-[var(--landing-accent)]">
        share link copied · scope: one synced plan
      </div>
    </div>
  );
}

function ProductStepsSection() {
  return (
    <section
      id="features"
      className={`${SECTION_FRAME_CLASS} py-[76px] max-sm:py-[54px]`}
      style={SECTION_SCROLL_STYLE}
    >
      <div className="mx-auto max-w-[680px] text-center">
        <h2 className="m-0 text-balance text-[32px] font-[740] leading-[1.08] tracking-[-0.025em] text-[var(--landing-text)] max-sm:text-[27px]">
          A local index first, collaboration when you turn it on.
        </h2>
        <p className="mt-4 mb-0 text-[15px] leading-[1.7] text-[var(--landing-muted)]">
          The landing page stays focused on what Agendex actually handles. Setup, adapter details,
          and sync commands belong in the docs route.
        </p>
      </div>

      <div className="mt-9 overflow-hidden rounded-[8px] border border-[var(--landing-border)] bg-[var(--landing-surface)]">
        <div className="flex items-center gap-2 border-b border-[var(--landing-border-subtle)] px-4 py-3 text-[12px] font-semibold text-[var(--landing-muted)]">
          <span className="size-2 rounded-full bg-[#ff5f56]" aria-hidden="true" />
          <span className="size-2 rounded-full bg-[#ffbd2e]" aria-hidden="true" />
          <span className="size-2 rounded-full bg-[#27c93f]" aria-hidden="true" />
          <span className="ml-2">Agendex review flow</span>
        </div>
        <div className="grid divide-y divide-[var(--landing-border-subtle)] lg:grid-cols-3 lg:divide-x lg:divide-y-0">
          {PRODUCT_STEPS.map((step, index) => (
            <div key={step.title} className="p-5">
              <div className="mb-10 font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace] text-[11px] font-semibold text-[var(--landing-accent)]">
                {String(index + 1).padStart(2, '0')}
              </div>
              <h3 className="m-0 text-[17px] font-bold text-[var(--landing-text)]">{step.title}</h3>
              <p className="mt-3 mb-0 text-[13.5px] leading-[1.65] text-[var(--landing-muted)]">
                {step.body}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--landing-border-subtle)] pt-7">
        <p className="m-0 max-w-[560px] text-[14px] leading-[1.7] text-[var(--landing-muted)]">
          Setup, CLI commands, adapter status, custom source folders, privacy, and cloud sync
          details live in one reference route.
        </p>
        <ActionLink href="/docs">Open docs</ActionLink>
      </div>
    </section>
  );
}

function PricingToggle({ yearly, onChange }: { yearly: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      className="inline-flex w-fit max-w-full gap-1 rounded-[7px] border border-[var(--landing-border)] bg-[color-mix(in_oklch,var(--landing-bg)_74%,transparent)] p-1"
      aria-label="Billing cadence"
    >
      {(['Monthly', 'Yearly'] as const).map((label) => {
        const active = label === 'Yearly' ? yearly : !yearly;
        return (
          <button
            key={label}
            type="button"
            onClick={() => onChange(label === 'Yearly')}
            className="min-h-[32px] rounded-[6px] border border-transparent bg-transparent px-3 text-[12px] font-bold leading-[1.2] text-[var(--landing-muted)] data-[active=true]:border-[color-mix(in_oklch,var(--landing-accent)_22%,var(--landing-border))] data-[active=true]:bg-[color-mix(in_oklch,var(--landing-accent)_10%,var(--landing-surface-raised))] data-[active=true]:text-[var(--landing-text)]"
            data-active={active}
          >
            {label}
            {label === 'Yearly' && (
              <span className="ml-1.5 text-[11px] font-semibold text-[color-mix(in_oklch,var(--landing-accent)_70%,var(--landing-muted))]">
                Save 17%
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function PricingCard({
  tier,
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
  tier: string;
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
    <article
      className={`flex min-h-[420px] min-w-0 flex-col rounded-[8px] border p-6 ${
        isPro
          ? 'border-[color-mix(in_oklch,var(--landing-accent)_24%,var(--landing-border))] bg-[color-mix(in_oklch,var(--landing-surface)_92%,var(--landing-bg))]'
          : 'border-[var(--landing-border)] bg-[var(--landing-surface)]'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="mb-2 text-[11px] font-bold text-[var(--landing-muted)]">{tier}</div>
          <h3 className="m-0 text-[20px] font-bold leading-[1.15] text-[var(--landing-text)]">
            {title}
          </h3>
        </div>
        {isPro && (
          <div className="shrink-0 rounded-[5px] border border-[color-mix(in_oklch,var(--landing-accent)_25%,var(--landing-border))] bg-[color-mix(in_oklch,var(--landing-accent)_8%,transparent)] px-2 py-1 text-[11px] font-bold text-[color-mix(in_oklch,var(--landing-accent)_72%,var(--landing-muted))]">
            Cloud Pro
          </div>
        )}
      </div>

      <p className="mt-4 mb-0 max-w-[430px] text-[13.5px] leading-[1.65] text-[var(--landing-muted)]">
        {summary}
      </p>

      <div className="mt-7 mb-6 flex items-end gap-2">
        <span className="text-[44px] font-[760] leading-none tracking-[-0.03em] text-[var(--landing-text)]">
          {price}
        </span>
        {period && (
          <span className="text-[13px] font-semibold text-[var(--landing-muted)]">{period}</span>
        )}
      </div>

      <div className="pt-4">
        <div className="mb-3 text-[11px] font-bold text-[var(--landing-muted)]">Included</div>
        <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          {features.map((f) => (
            <li
              key={f}
              className="flex items-start gap-2.5 text-[13px] leading-[1.5] text-[var(--landing-muted)]"
            >
              <span
                aria-hidden="true"
                className="font-bold text-[color-mix(in_oklch,var(--landing-accent)_66%,var(--landing-muted))]"
              >
                ✓
              </span>
              <span>{f}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-auto pt-6">
        {note && (
          <div className="mb-4 border-t border-[var(--landing-border-subtle)] pt-4">
            <div className="text-[12px] font-bold text-[var(--landing-text)]">{note.label}</div>
            <p className="m-0 mt-1 text-[12px] leading-[1.55] text-[var(--landing-muted)]">
              {note.body}
            </p>
          </div>
        )}
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
      </div>
    </article>
  );
}

function LandingPricing({
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
    <section
      id="pricing"
      className={`${SECTION_FRAME_CLASS} py-[78px] max-sm:py-[54px]`}
      style={SECTION_SCROLL_STYLE}
    >
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1fr)] lg:items-end">
        <div>
          <h2 className="m-0 max-w-[700px] text-balance text-[34px] font-[740] leading-[1.06] tracking-[-0.025em] text-[var(--landing-text)] max-sm:text-[28px]">
            Start with local search. Add cloud review when the work is shared.
          </h2>
          <p className="mt-4 mb-0 max-w-[560px] text-[15px] leading-[1.7] text-[var(--landing-muted)]">
            The free path is the local OSS index. Cloud Pro adds daemon sync, links, comments,
            history, tags, collections, and workspace access without changing where plans originate.
          </p>
        </div>
        <div className="justify-self-start lg:justify-self-end">
          <PricingToggle yearly={yearly} onChange={onSetYearly} />
        </div>
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <PricingCard
          tier="Local OSS"
          title="Self-hosted"
          price="$0"
          summary="For indexing and searching local agent plans, sessions, custom folders, and fallback plans on one machine."
          features={FREE_FEATURES}
          cta="Get Started"
          onCta={onShowLogin}
        />
        <PricingCard
          tier="Team review"
          title="Cloud Pro"
          price={yearly ? '$69' : '$7'}
          period={yearly ? '/year' : '/month'}
          summary="For syncing local plans to the cloud dashboard with sharing, comments, history, tags, collections, and team access."
          features={PRO_FEATURES}
          cta={proCtaSlot ?? 'Start Free Trial'}
          onCta={proCtaSlot ? undefined : onShowLogin}
          note={MONEY_BACK_GUARANTEE}
          isPro
          signingIn={signingIn}
        />
      </div>
    </section>
  );
}

function LandingFAQ({
  openFaq,
  onSetOpenFaq,
}: {
  openFaq: number | null;
  onSetOpenFaq: (v: number | null) => void;
}) {
  return (
    <section
      id="faq"
      className={`${SECTION_FRAME_CLASS} py-[78px] max-sm:py-[54px]`}
      style={SECTION_SCROLL_STYLE}
    >
      <div className="grid gap-10 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div>
          <h2 className="m-0 text-balance text-[34px] font-[740] leading-[1.06] tracking-[-0.025em] text-[var(--landing-text)] max-sm:text-[28px]">
            Answers before you install.
          </h2>
          <p className="mt-4 mb-0 max-w-[310px] text-[13.5px] leading-[1.65] text-[var(--landing-muted)]">
            Privacy, adapters, and Cloud sync in plain terms. No account is required to start
            self-hosted.
          </p>
        </div>
        <div className="min-w-0">
          {FAQ_ITEMS.map((item, index) => (
            <FAQItem
              key={item.q}
              index={index + 1}
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

function LandingFooter({
  onShowChangelog,
  onShowDocs,
}: {
  onShowChangelog?: () => void;
  onShowDocs?: () => void;
}) {
  function handleChangelogClick(e: MouseEvent<HTMLAnchorElement>) {
    if (!onShowChangelog) return;
    e.preventDefault();
    onShowChangelog();
  }

  function handleDocsClick(e: MouseEvent<HTMLAnchorElement>) {
    if (!onShowDocs) return;
    e.preventDefault();
    onShowDocs();
  }

  return (
    <footer className="landing-frame flex min-h-[200px] items-end justify-between gap-8 px-[clamp(18px,5vw,72px)] py-10 text-[var(--landing-muted)] max-sm:min-h-0 max-sm:flex-col max-sm:items-start">
      <div className="flex flex-col gap-3 text-[12.5px]">
        <span className="text-[36px] font-[760] leading-none tracking-[-0.03em] text-[var(--landing-text)]">
          Agendex<span className="text-[var(--landing-accent)]">.</span>
        </span>
        <span>© 2026 / Local plans indexed</span>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-x-5 gap-y-3 max-sm:justify-start [&>a]:text-[12.5px] [&>a]:font-semibold [&>a]:text-[var(--landing-muted)] [&>a]:no-underline [&>a:hover]:text-[var(--landing-text)]">
        <a href="#features">Features</a>
        <a href="#pricing">Pricing</a>
        <a href="/docs" onClick={handleDocsClick}>
          Docs
        </a>
        <a href="/changelog" onClick={handleChangelogClick}>
          Changelog
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
      </div>
    </footer>
  );
}

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
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-[color-mix(in_oklch,var(--landing-bg)_84%,transparent)] p-5"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={onSubmit}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="w-[min(100%,430px)] rounded-[8px] border border-[var(--landing-border)] bg-[var(--landing-surface)] p-6 shadow-[0_18px_40px_color-mix(in_oklch,var(--landing-bg)_68%,transparent)]"
      >
        <h2 id={titleId} className="m-0 mb-2 text-[20px] font-bold text-[var(--landing-text)]">
          Connect to Agendex
        </h2>
        <p
          id={descriptionId}
          className="m-0 mb-6 text-[13.5px] leading-[1.6] text-[var(--landing-muted)]"
        >
          Paste the auth token printed by the local Agendex CLI. The token stays in this browser.
        </p>

        <label
          htmlFor={inputId}
          className="mb-2 block text-[12px] font-bold text-[var(--landing-text)]"
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
          className="w-full rounded-[7px] border border-[var(--landing-border)] bg-[color-mix(in_oklch,var(--landing-bg)_74%,transparent)] px-3.5 py-[12px] font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace] text-[13px] leading-[1.4] text-[var(--landing-text)] outline-none placeholder:text-[color-mix(in_oklch,var(--landing-muted)_78%,var(--landing-text))]"
        />
        <p id={hintId} className="mt-2 mb-0 text-[12px] leading-[1.55] text-[var(--landing-muted)]">
          Run <code>agendex login</code> or start the local server to print a fresh token.
        </p>
        {tokenError && (
          <p
            id={errorId}
            role="alert"
            className="mt-2 mb-0 text-[12px] font-semibold leading-[1.5] text-[color-mix(in_oklch,var(--landing-orange)_82%,var(--landing-text))]"
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
          className="mt-2 inline-flex min-h-10 w-full items-center justify-center rounded-[7px] border border-transparent bg-transparent text-[13px] font-bold text-[var(--landing-muted)] hover:text-[var(--landing-text)]"
        >
          Cancel
        </button>
      </form>
    </div>
  );
}

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

function useLandingIntroAnimation() {
  const pageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = pageRef.current;
    if (!root) return undefined;

    const ctx = gsap.context(() => {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduceMotion) return;

      const introItems = Array.from(
        root.querySelectorAll<HTMLElement>('[data-landing-animate-item]'),
      );
      const agentChips = Array.from(root.querySelectorAll<HTMLElement>('.landing-hero-agent'));
      const runbookLines = Array.from(
        root.querySelectorAll<HTMLElement>('.landing-hero-runbook code'),
      );
      const cursor = root.querySelector<SVGSVGElement>('.landing-hero-cursor');
      const cursorPointer = cursor?.querySelector<SVGPathElement>('[data-landing-cursor-pointer]');
      const cursorRays = cursor?.querySelector<SVGPathElement>('[data-landing-cursor-rays]');
      const nav = root.querySelector<HTMLElement>('[data-landing-animate="nav"]');
      const heroShell = root.querySelector<HTMLElement>('[data-landing-animate="hero-shell"]');

      gsap.set(introItems, { autoAlpha: 0, y: 18 });
      gsap.set(agentChips, { autoAlpha: 0, scale: 0.96, y: 10 });
      gsap.set(runbookLines, { autoAlpha: 0, x: -8 });
      if (cursor) gsap.set(cursor, { transformOrigin: '40% 52%' });
      if (cursorRays) gsap.set(cursorRays, { autoAlpha: 0.72, transformOrigin: '50% 50%' });

      const timeline = gsap.timeline({
        defaults: { duration: 0.62, ease: 'power3.out' },
      });

      if (nav) {
        timeline.from(nav, { autoAlpha: 0, duration: 0.45, y: -10 });
      }

      if (heroShell) {
        timeline.from(heroShell, { autoAlpha: 0, duration: 0.72, scale: 0.992, y: 14 }, '<0.04');
      }

      timeline
        .to(introItems, { autoAlpha: 1, stagger: 0.075, y: 0 }, '<0.14')
        .to(agentChips, { autoAlpha: 1, duration: 0.42, scale: 1, stagger: 0.035, y: 0 }, '<0.3')
        .to(runbookLines, { autoAlpha: 1, duration: 0.34, stagger: 0.045, x: 0 }, '<0.12');

      if (cursor) {
        const cursorIdle = gsap.timeline({
          paused: true,
          repeat: -1,
          repeatDelay: 0.42,
          defaults: { ease: 'power3.out' },
        });

        cursorIdle
          .to(cursor, { duration: 0.64, rotation: -1.5, x: 12, y: 8, ease: 'sine.inOut' })
          .to(cursorPointer ?? cursor, { duration: 0.08, scale: 0.92, ease: 'power2.out' })
          .to(cursorPointer ?? cursor, { duration: 0.2, scale: 1, ease: 'back.out(2.2)' });

        if (cursorRays) {
          cursorIdle
            .to(cursorRays, { autoAlpha: 1, duration: 0.08 }, '<')
            .to(cursorRays, { autoAlpha: 0.52, duration: 0.34, ease: 'power2.out' }, '>');
        }

        cursorIdle
          .to(cursor, { duration: 0.68, rotation: -8.5, x: -2, y: -1, ease: 'sine.inOut' }, '<0.02')
          .to(cursor, { duration: 0.38, rotation: -7, x: 0, y: 0, ease: 'power2.out' });

        timeline.fromTo(
          cursor,
          { autoAlpha: 0, rotation: -15, scale: 0.86, x: -8, y: -5 },
          {
            autoAlpha: 1,
            duration: 0.5,
            ease: 'back.out(1.6)',
            rotation: -7,
            scale: 1,
            x: 0,
            y: 0,
          },
          '<0.08',
        );
        timeline.add(() => cursorIdle.play(0), '>-0.04');
      }
    }, root);

    return () => ctx.revert();
  }, []);

  return pageRef;
}

function useMobileMenuControls({
  activeTab,
  showLogin,
}: {
  activeTab: LandingTab;
  showLogin: boolean;
}) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    function handleResize() {
      if (window.innerWidth >= 861) setMobileMenuOpen(false);
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [activeTab, showLogin]);

  return {
    mobileMenuOpen,
    toggleMobileMenu: () => setMobileMenuOpen((open) => !open),
    closeMobileMenu: () => setMobileMenuOpen(false),
  };
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

function LandingPageInner({ children, mascot, onShowChangelog, onShowDocs }: LandingPageProps) {
  const [state, dispatch] = useReducer(landingReducer, LANDING_INITIAL);
  const [tokenError, setTokenError] = useState('');
  const pageRef = useLandingIntroAnimation();
  const { token, showLogin, yearly, openFaq, activeTab, signingIn } = state;
  const actions = useLandingActions(token, tokenError, dispatch, setTokenError);
  const ctxValue = useLandingContextValue({
    signingIn,
    activeTab,
    openLogin: actions.openLogin,
    dispatch,
  });
  const { heroCtaNode, pricingCtaNode } = useLandingSlots(children);
  const { mobileMenuOpen, toggleMobileMenu, closeMobileMenu } = useMobileMenuControls({
    activeTab,
    showLogin,
  });

  useInitialHashScroll();

  return (
    <LandingContext.Provider value={ctxValue}>
      <div
        ref={pageRef}
        className="landing-page [&_a[href]]:cursor-pointer [&_button:not(:disabled)]:cursor-pointer"
      >
        <LandingNavbar
          mobileMenuOpen={mobileMenuOpen}
          onMobileMenuToggle={toggleMobileMenu}
          onMobileMenuClose={closeMobileMenu}
          onShowChangelog={onShowChangelog}
          onShowDocs={onShowDocs}
        />

        <LandingHero
          onShowLogin={() => startViewTransition(actions.openLogin)}
          ctaSlot={heroCtaNode}
        />

        <section className={`${SECTION_FRAME_CLASS} py-0`} style={SECTION_SCROLL_STYLE}>
          <ReviewSplit
            title="Review the plan before the work disappears into an agent log."
            body="Agendex makes the plan itself the review surface, with enough source detail to trust what changed and where it came from."
            bullets={PLAN_REVIEW_BULLETS}
            variant="plans"
          />
          <ReviewSplit
            title="Turn plan review into shared team knowledge."
            body="Cloud review adds links, comments, tags, and history without turning the product into a heavyweight project board."
            bullets={CODE_REVIEW_BULLETS}
            variant="teams"
          />
        </section>

        <ProductStepsSection />

        <LandingPricing
          yearly={yearly}
          signingIn={signingIn}
          onSetYearly={actions.setYearly}
          onShowLogin={() => startViewTransition(actions.openLogin)}
          proCtaSlot={pricingCtaNode}
        />

        <LandingFAQ openFaq={openFaq} onSetOpenFaq={actions.setOpenFaq} />

        <section
          className={`${SECTION_FRAME_CLASS} py-[58px] text-center max-sm:py-[44px]`}
          style={SECTION_SCROLL_STYLE}
        >
          <h2 className="mx-auto m-0 max-w-[640px] text-balance text-[28px] font-[740] leading-[1.12] tracking-[-0.02em] text-[var(--landing-text)] max-sm:text-[24px]">
            Your local agent plans deserve a real index.
          </h2>
          <p className="mx-auto mt-3 mb-0 max-w-[520px] text-[14px] leading-[1.7] text-[var(--landing-muted)]">
            Start with a local index. Add Cloud Pro when review moves across people and machines.
          </p>
          <div className="mx-auto mt-6 max-w-[520px] text-left">
            <CliInstallOptions />
          </div>
        </section>

        <LandingFooter onShowChangelog={onShowChangelog} onShowDocs={onShowDocs} />

        {mascot && (
          <LandingMascot
            greetings={mascot.greetings}
            onActivate={mascot.onActivate}
            triggerElementId="faq"
          />
        )}

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
}: LandingPageProps = {}) {
  return (
    <LandingPageInner mascot={mascot} onShowChangelog={onShowChangelog} onShowDocs={onShowDocs}>
      {children}
    </LandingPageInner>
  );
}

LandingPage.NavbarAuth = NavbarAuth;
LandingPage.HeroCta = HeroCta;
LandingPage.PricingCta = PricingCta;

function FAQItem({
  index,
  question,
  answer,
  open,
  onToggle,
}: {
  index: number;
  question: string;
  answer: string;
  open: boolean;
  onToggle: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const buttonId = useId();
  const contentId = useId();
  return (
    <div className="border-b border-[var(--landing-border-subtle)]">
      <button
        id={buttonId}
        type="button"
        onClick={onToggle}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        aria-expanded={open}
        aria-controls={contentId}
        className="group grid min-h-[70px] w-full grid-cols-[32px_minmax(0,1fr)_28px] items-center gap-4 border-0 bg-transparent px-0 py-[17px] text-left text-[14px] font-bold leading-[1.45] text-[var(--landing-text)] transition-colors duration-150 max-sm:grid-cols-[28px_minmax(0,1fr)_28px] max-sm:gap-3"
        style={{ color: hovered || open ? TEXT_PRIMARY : undefined }}
      >
        <span className="font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace] text-[11px] font-bold text-[var(--landing-accent)]">
          {String(index).padStart(2, '0')}
        </span>
        <span className="text-pretty">{question}</span>
        <div
          className="inline-flex size-[28px] shrink-0 items-center justify-center rounded-full transition-[background-color,border-color] duration-200"
          style={{
            border: `1px solid ${open ? ACCENT : hovered ? 'rgba(255,255,255,0.2)' : BORDER}`,
            background: open ? ACCENT : 'transparent',
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            style={{
              transition: 'transform 0.25s cubic-bezier(0.22, 1, 0.36, 1)',
              transform: open ? 'rotate(180deg)' : 'none',
            }}
            aria-hidden="true"
          >
            <path
              d="M2.5 4.5L6 8L9.5 4.5"
              stroke={open ? BG : TEXT_MUTED}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </button>
      <section
        id={contentId}
        aria-labelledby={buttonId}
        aria-hidden={!open}
        className="grid"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <p
            className="m-0 max-w-[650px] pb-[22px] pl-[46px] text-[13.5px] leading-[1.75] text-[var(--landing-muted)] max-sm:pl-[40px]"
            style={{
              opacity: open ? 1 : 0,
              transform: open ? 'translateY(0)' : 'translateY(-4px)',
              transition: 'opacity 0.22s 0.04s, transform 0.22s 0.04s',
            }}
          >
            {answer}
          </p>
        </div>
      </section>
    </div>
  );
}
