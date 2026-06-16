import React, { useEffect, useId, useMemo, useReducer, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { startViewTransition } from '../lib/view-transition.ts';
import {
  CLOUD_STEPS,
  FAQ_ITEMS,
  FEATURES,
  FREE_FEATURES,
  LOCAL_STEPS,
  MONEY_BACK_GUARANTEE,
  PKG_MANAGERS,
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
const LANDING_SECTIONS = [
  { id: 'features', label: 'Features' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'faq', label: 'FAQ' },
] as const;
const LOCAL_TAB = 'local';
const CLOUD_TAB = 'cloud';
type LandingTab = typeof LOCAL_TAB | typeof CLOUD_TAB;
const LANDING_TABS = [LOCAL_TAB, CLOUD_TAB] as const;

export interface LandingPageProps {
  children?: ReactNode;
  mascot?: LandingMascotProps;
  onShowChangelog?: () => void;
}

const AGENT_CHIPS = [
  'Claude Code',
  'Codex',
  'Cursor',
  'Copilot',
  'OpenCode',
  'Pi',
  'VS Code',
] as const;

const HERO_PLAN_ROWS = [
  {
    agent: 'Claude Code',
    title: 'checkout-refactor.plan.md',
    path: '~/work/storefront/.claude/plans',
    status: 'Indexed 14s ago',
  },
  {
    agent: 'Codex',
    title: 'rate-limit-rollout.md',
    path: '~/work/api/.codex/tasks',
    status: '2 comments',
  },
  {
    agent: 'Cursor',
    title: 'billing-ui-followup.md',
    path: '~/work/app/.cursor/plans',
    status: 'Shared',
  },
] as const;

const PLAN_REVIEW_BULLETS = [
  'Source path, agent, recency, and plan state stay visible together.',
  'Search moves across every watched plan without opening each agent tool.',
  'Unseen changes and comments are attached to the plan, not a separate board.',
  'Cloud sharing can start from a local file when review needs another person.',
] as const;

const CODE_REVIEW_BULLETS = [
  'Workspace links keep feedback close to the source plan.',
  'Comment threads capture what changed and who needs to respond.',
  'History and tags turn repeat agent work into searchable team memory.',
  'Local files remain readable on disk after sync and sharing.',
] as const;

const WORKFLOW_STEPS = [
  {
    title: 'Use agents normally',
    body: 'Agendex watches the plan folders you already have and indexes new files as they appear.',
  },
  {
    title: 'Review on one surface',
    body: 'Open a plan with source, markdown, outline, tags, comments, and history in a single workspace.',
  },
  {
    title: 'Send feedback back',
    body: 'Share a link, comment on a plan, or return to the source file with enough context to act.',
  },
] as const;

const KNOWLEDGE_COLUMNS = [
  {
    title: 'Commands',
    items: [
      ['agendex start', 'Watch every configured agent source'],
      ['agendex open', 'Launch the dashboard from the terminal'],
      ['agendex add-dir', 'Attach a custom plan directory'],
    ],
  },
  {
    title: 'Review',
    items: [
      ['Share links', 'Send a plan to teammates with scoped access'],
      ['Comments', 'Keep review notes attached to the plan'],
      ['History', 'Compare revisions as agent work changes'],
    ],
  },
  {
    title: 'Integrations',
    items: [
      ['Agents', 'Claude Code, Codex, Cursor, OpenCode, and more'],
      ['Editors', 'VS Code and local browser workflows'],
      ['Charts', 'Extract dependency maps from plan text'],
    ],
  },
] as const;

function SectionShell({
  id,
  children,
  className = '',
}: {
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={`landing-frame border-b border-[var(--landing-border-subtle)] px-[clamp(18px,5vw,72px)] ${className}`}
      style={{ scrollMarginTop: LANDING_ANCHOR_OFFSET }}
    >
      {children}
    </section>
  );
}

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
      className={`inline-flex min-h-[36px] items-center justify-center gap-2 rounded-[7px] border px-3.5 text-[12.5px] font-semibold no-underline transition-[background-color,border-color,color,transform] duration-150 hover:-translate-y-px ${
        variant === 'primary'
          ? 'border-[color-mix(in_oklch,var(--landing-accent)_48%,transparent)] bg-[var(--landing-accent)] text-[var(--landing-bg)]'
          : 'border-[var(--landing-border)] bg-[var(--landing-surface)] text-[var(--landing-text)] hover:border-[var(--landing-border-strong)] hover:bg-[var(--landing-surface-raised)]'
      }`}
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
      className={`inline-flex min-h-[36px] items-center justify-center gap-2 rounded-[7px] border px-3.5 text-[12.5px] font-semibold transition-[background-color,border-color,color,transform] duration-150 enabled:hover:-translate-y-px disabled:cursor-wait disabled:opacity-70 ${
        variant === 'primary'
          ? 'border-[color-mix(in_oklch,var(--landing-accent)_48%,transparent)] bg-[var(--landing-accent)] text-[var(--landing-bg)]'
          : 'border-[var(--landing-border)] bg-[var(--landing-surface)] text-[var(--landing-text)] enabled:hover:border-[var(--landing-border-strong)] enabled:hover:bg-[var(--landing-surface-raised)]'
      }`}
    >
      {children}
    </button>
  );
}

function AgentStrip() {
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Supported agents">
      {AGENT_CHIPS.map((agent) => (
        <span
          key={agent}
          className="rounded-[5px] border border-[var(--landing-border)] bg-[var(--landing-surface)] px-2 py-1 text-[11px] font-semibold leading-none text-[var(--landing-muted)]"
        >
          {agent}
        </span>
      ))}
    </div>
  );
}

function PkgManagerInstall() {
  const [activePkg, setActivePkg] = useState<(typeof PKG_MANAGERS)[number]['id']>('bun');
  const [copied, setCopied] = useState(false);
  const active = PKG_MANAGERS.find((pm) => pm.id === activePkg) ?? PKG_MANAGERS[0];
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
        {PKG_MANAGERS.map((pm) => (
          <button
            key={pm.id}
            type="button"
            onClick={() => setActivePkg(pm.id)}
            className={`rounded-[5px] border px-2 py-1 text-[11px] font-semibold leading-none transition-colors duration-150 ${
              activePkg === pm.id
                ? 'border-[color-mix(in_oklch,var(--landing-accent)_34%,transparent)] bg-[color-mix(in_oklch,var(--landing-accent)_12%,transparent)] text-[var(--landing-accent)]'
                : 'border-transparent bg-transparent text-[var(--landing-muted)] hover:text-[var(--landing-text)]'
            }`}
          >
            {pm.label}
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

function StepsList({ steps }: { steps: typeof LOCAL_STEPS | typeof CLOUD_STEPS }) {
  return (
    <div className="space-y-2">
      {steps.map((step) => (
        <div
          key={step.number}
          className="overflow-hidden rounded-[7px] border border-[var(--landing-border-subtle)] bg-[color-mix(in_oklch,var(--landing-bg)_76%,transparent)]"
        >
          <div className="border-b border-[var(--landing-border-subtle)] bg-[var(--landing-surface)] px-3 py-2 font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace] text-[11px] font-semibold text-[var(--landing-muted)]">
            {step.number} / {step.title}
          </div>
          {'hasPkgManager' in step && step.hasPkgManager ? (
            <PkgManagerInstall />
          ) : (
            <pre className="m-0 overflow-x-auto p-3 font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace] text-[12px] leading-[1.6] text-[var(--landing-accent)] max-sm:whitespace-pre-wrap max-sm:[overflow-wrap:anywhere]">
              <code>{step.code}</code>
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}

function PlanRoomPreview({
  activeTab,
  onSetActiveTab,
}: {
  activeTab: LandingTab;
  onSetActiveTab: (tab: LandingTab) => void;
}) {
  return (
    <div className="relative min-w-0 rounded-[8px] border border-[var(--landing-border)] bg-[var(--landing-surface)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--landing-border-subtle)] px-3.5 py-3">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-[#ff5f56]" aria-hidden="true" />
          <span className="size-2 rounded-full bg-[#ffbd2e]" aria-hidden="true" />
          <span className="size-2 rounded-full bg-[#27c93f]" aria-hidden="true" />
          <span className="ml-2 text-[12px] font-semibold text-[var(--landing-muted)]">
            Agendex · Plan room
          </span>
        </div>
        <span className="rounded-[5px] border border-[var(--landing-border-subtle)] bg-[color-mix(in_oklch,var(--landing-accent)_8%,transparent)] px-2 py-1 font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace] text-[10.5px] font-semibold text-[var(--landing-accent)]">
          daemon online
        </span>
      </div>

      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(270px,0.72fr)]">
        <div className="border-b border-[var(--landing-border-subtle)] p-4 lg:border-r lg:border-b-0">
          <div className="mb-3 flex items-center gap-2 text-[11px] font-bold text-[var(--landing-accent)]">
            <span
              className="size-[6px] rounded-full bg-[var(--landing-accent)]"
              aria-hidden="true"
            />
            Live index
          </div>
          <div className="overflow-hidden rounded-[7px] border border-[var(--landing-border-subtle)] bg-[color-mix(in_oklch,var(--landing-bg)_84%,transparent)]">
            {HERO_PLAN_ROWS.map((row) => (
              <div
                key={row.title}
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-[var(--landing-border-subtle)] px-3 py-3 last:border-b-0"
              >
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-bold text-[var(--landing-text)]">
                    {row.title}
                  </div>
                  <div className="mt-1 truncate font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace] text-[11px] text-[var(--landing-faint)]">
                    {row.path}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] font-semibold text-[var(--landing-muted)]">
                    {row.agent}
                  </div>
                  <div className="mt-1 text-[11px] text-[var(--landing-accent)]">{row.status}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-1.5 text-center text-[11px] text-[var(--landing-muted)] max-sm:grid-cols-1">
            <span className="rounded-[5px] bg-[var(--landing-surface-raised)] px-2 py-1.5">
              Files readable
            </span>
            <span className="rounded-[5px] bg-[var(--landing-surface-raised)] px-2 py-1.5">
              Search ready
            </span>
            <span className="rounded-[5px] bg-[var(--landing-surface-raised)] px-2 py-1.5">
              Review tracked
            </span>
          </div>
        </div>

        <div className="p-4">
          <div className="mb-3 grid grid-cols-2 gap-1 rounded-[7px] border border-[var(--landing-border-subtle)] bg-[color-mix(in_oklch,var(--landing-bg)_74%,transparent)] p-1">
            {LANDING_TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => onSetActiveTab(tab)}
                className={`min-h-[32px] rounded-[6px] px-2 text-[12px] font-semibold capitalize transition-colors duration-150 ${
                  activeTab === tab
                    ? 'bg-[var(--landing-surface-raised)] text-[var(--landing-text)]'
                    : 'text-[var(--landing-muted)] hover:text-[var(--landing-text)]'
                }`}
              >
                {tab === LOCAL_TAB ? 'Self-hosted' : 'Cloud sync'}
              </button>
            ))}
          </div>
          <StepsList steps={activeTab === LOCAL_TAB ? LOCAL_STEPS : CLOUD_STEPS} />
        </div>
      </div>
    </div>
  );
}

function LandingNavbar({
  signingIn,
  onSignIn,
  authSlot,
  mobileMenuOpen,
  onMobileMenuToggle,
  onMobileMenuClose,
  onShowChangelog,
}: {
  signingIn: boolean;
  onSignIn: () => void;
  authSlot?: SlotRenderFn;
  mobileMenuOpen: boolean;
  onMobileMenuToggle: () => void;
  onMobileMenuClose: () => void;
  onShowChangelog?: () => void;
}) {
  const authAction = authSlot ? (
    authSlot()
  ) : (
    <ActionButton onClick={onSignIn} disabled={signingIn}>
      {signingIn ? <Spinner size={13} /> : null}
      Sign in
    </ActionButton>
  );

  function handleChangelogClick(e: MouseEvent<HTMLAnchorElement>) {
    if (!onShowChangelog) return;
    e.preventDefault();
    onShowChangelog();
    onMobileMenuClose();
  }

  return (
    <nav className="fixed inset-x-0 top-0 z-[100] border-b border-[var(--landing-border-subtle)] bg-[var(--landing-bg)]/95">
      <div className="landing-frame flex min-h-[52px] items-center justify-between gap-5 border-b-0 px-[clamp(18px,5vw,72px)]">
        <a
          href="#overview"
          onClick={onMobileMenuClose}
          className="shrink-0 text-[14px] font-bold text-[var(--landing-text)] no-underline"
        >
          Agendex<span className="text-[var(--landing-accent)]">.</span>
        </a>

        <div className="flex min-w-0 items-center gap-6 max-[860px]:hidden">
          {LANDING_SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className="text-[12.5px] font-semibold text-[var(--landing-muted)] no-underline transition-colors duration-150 hover:text-[var(--landing-text)]"
            >
              {section.label}
            </a>
          ))}
          <a
            href="/changelog"
            onClick={handleChangelogClick}
            className="text-[12.5px] font-semibold text-[var(--landing-muted)] no-underline transition-colors duration-150 hover:text-[var(--landing-text)]"
          >
            Changelog
          </a>
          <a
            href="https://github.com/tiru5/agendex"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[12.5px] font-semibold text-[var(--landing-muted)] no-underline transition-colors duration-150 hover:text-[var(--landing-text)]"
          >
            GitHub
          </a>
        </div>

        <div className="block shrink-0 max-[860px]:hidden [&>button]:min-h-[32px] [&>button]:rounded-[7px] [&>button]:px-3">
          {authAction}
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
          {LANDING_SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              onClick={onMobileMenuClose}
              className="flex min-h-10 items-center rounded-[7px] border border-[var(--landing-border)] bg-[var(--landing-surface)] px-3 text-[13px] font-semibold text-[var(--landing-text)] no-underline"
            >
              {section.label}
            </a>
          ))}
          <a
            href="/changelog"
            onClick={handleChangelogClick}
            className="flex min-h-10 items-center rounded-[7px] border border-[var(--landing-border)] bg-[var(--landing-surface)] px-3 text-[13px] font-semibold text-[var(--landing-text)] no-underline"
          >
            Changelog
          </a>
          <div className="pt-1 [&>*]:w-full">{authAction}</div>
        </div>
      </div>
    </nav>
  );
}

function LandingHero({
  activeTab,
  onShowLogin,
  onSetActiveTab,
  ctaSlot,
}: {
  activeTab: LandingTab;
  onShowLogin: () => void;
  onSetActiveTab: (tab: LandingTab) => void;
  ctaSlot?: ReactNode;
}) {
  return (
    <SectionShell id="overview" className="pt-[96px] pb-[76px] max-sm:pt-[82px] max-sm:pb-[54px]">
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,0.78fr)_minmax(420px,1fr)]">
        <div className="max-w-[620px] pt-3">
          <h1 className="m-0 text-balance text-[clamp(42px,7vw,64px)] font-[760] leading-[0.98] tracking-[-0.035em] text-[var(--landing-text)]">
            One plan room for every coding agent.
          </h1>
          <p className="mt-5 mb-0 max-w-[540px] text-pretty text-[15px] leading-[1.75] text-[var(--landing-muted)]">
            Index local plan files from Claude Code, Codex, Cursor, and more. Review source,
            changes, comments, and cloud sharing from one dark, precise workspace.
          </p>

          <div className="mt-5">
            <AgentStrip />
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            {ctaSlot ?? (
              <ActionButton onClick={onShowLogin} variant="primary">
                Connect dashboard
              </ActionButton>
            )}
            <ActionLink href="https://github.com/tiru5/agendex">
              <GitHubIcon size={14} />
              View on GitHub
            </ActionLink>
          </div>
        </div>

        <PlanRoomPreview activeTab={activeTab} onSetActiveTab={onSetActiveTab} />
      </div>
    </SectionShell>
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
          <span className="ml-2">{variant === 'plans' ? 'Plan review' : 'Shared review'}</span>
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
        {['Source linked', '2 comments', 'Unseen diff'].map((item) => (
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
        <div>- Watch 429 rate in dashboard</div>
      </div>
    </div>
  );
}

function TeamReviewMock() {
  return (
    <div className="space-y-3">
      {[
        ['Ana', 'Can we stage this behind the workspace flag first?'],
        ['Sam', 'Yes, add the rollback command to the plan before merge.'],
        ['Agendex', 'Revision saved, 4 changed sections detected.'],
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
        share link copied · review scope: one plan
      </div>
    </div>
  );
}

function WorkflowSection() {
  return (
    <SectionShell id="features" className="py-[76px] max-sm:py-[54px]">
      <div className="mx-auto max-w-[620px] text-center">
        <h2 className="m-0 text-balance text-[32px] font-[740] leading-[1.08] tracking-[-0.025em] text-[var(--landing-text)] max-sm:text-[27px]">
          How it works, without ceremony.
        </h2>
      </div>

      <div className="mt-9 overflow-hidden rounded-[8px] border border-[var(--landing-border)] bg-[var(--landing-surface)]">
        <div className="flex items-center gap-2 border-b border-[var(--landing-border-subtle)] px-4 py-3 text-[12px] font-semibold text-[var(--landing-muted)]">
          <span className="size-2 rounded-full bg-[#ff5f56]" aria-hidden="true" />
          <span className="size-2 rounded-full bg-[#ffbd2e]" aria-hidden="true" />
          <span className="size-2 rounded-full bg-[#27c93f]" aria-hidden="true" />
          <span className="ml-2">Agendex workflow</span>
        </div>
        <div className="grid divide-y divide-[var(--landing-border-subtle)] lg:grid-cols-3 lg:divide-x lg:divide-y-0">
          {WORKFLOW_STEPS.map((step, index) => (
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

      <div className="mt-12 grid gap-x-8 gap-y-7 lg:grid-cols-3">
        {KNOWLEDGE_COLUMNS.map((column) => (
          <div key={column.title}>
            <h3 className="m-0 border-b border-[var(--landing-border-subtle)] pb-3 text-[13px] font-bold text-[var(--landing-text)]">
              {column.title}
            </h3>
            <div className="divide-y divide-[var(--landing-border-subtle)]">
              {column.items.map(([label, body]) => (
                <div key={label} className="py-3">
                  <div className="text-[13px] font-bold text-[var(--landing-text)]">{label}</div>
                  <div className="mt-1 text-[12.5px] leading-[1.5] text-[var(--landing-muted)]">
                    {body}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-10 border-t border-[var(--landing-border-subtle)] pt-7 text-center text-[14px] leading-[1.7] text-[var(--landing-muted)]">
        Integrations cover Claude Code, Codex, Cursor, OpenCode, Pi, and VS Code. The adapter model
        keeps room for the next agent you add.
      </div>
    </SectionShell>
  );
}

function CapabilityRows() {
  return (
    <div className="grid gap-x-8 gap-y-4 lg:grid-cols-3">
      {FEATURES.map((feature) => (
        <div
          key={feature.title}
          className="border-t border-[var(--landing-border-subtle)] py-4 first:border-t lg:[&:nth-child(-n+3)]:border-t-0"
        >
          <div className="text-[13px] font-bold text-[var(--landing-text)]">{feature.title}</div>
          <p className="mt-1.5 mb-0 line-clamp-2 text-[12.5px] leading-[1.55] text-[var(--landing-muted)]">
            {feature.desc}
          </p>
        </div>
      ))}
    </div>
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
          className={`inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-[7px] border px-4 text-[12.5px] font-bold transition-[background-color,border-color,color] duration-150 disabled:cursor-wait disabled:opacity-70 ${
            isPro
              ? 'border-[color-mix(in_oklch,var(--landing-accent)_36%,var(--landing-border))] bg-[color-mix(in_oklch,var(--landing-accent)_12%,var(--landing-surface-raised))] text-[var(--landing-text)] hover:bg-[color-mix(in_oklch,var(--landing-accent)_16%,var(--landing-surface-raised))]'
              : 'border-[var(--landing-border)] bg-transparent text-[var(--landing-text)] hover:border-[var(--landing-border-strong)]'
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
    <SectionShell id="pricing" className="py-[78px] max-sm:py-[54px]">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1fr)] lg:items-end">
        <div>
          <h2 className="m-0 max-w-[700px] text-balance text-[34px] font-[740] leading-[1.06] tracking-[-0.025em] text-[var(--landing-text)] max-sm:text-[28px]">
            Start local. Add cloud review when the work is shared.
          </h2>
          <p className="mt-4 mb-0 max-w-[560px] text-[15px] leading-[1.7] text-[var(--landing-muted)]">
            The free path is a complete local index. Cloud Pro adds sync, comments, links, and
            workspace access without changing where plans originate.
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
          summary="For solo review, private experiments, and teams that want the full source path before adding collaboration."
          features={FREE_FEATURES}
          cta="Get Started"
          onCta={onShowLogin}
        />
        <PricingCard
          tier="Team review"
          title="Cloud Pro"
          price={yearly ? '$69' : '$7'}
          period={yearly ? '/year' : '/month'}
          summary="For shared plan review across machines, links, comments, and workspace access on top of the local daemon."
          features={PRO_FEATURES}
          cta={proCtaSlot ?? 'Start Free Trial'}
          onCta={proCtaSlot ? undefined : onShowLogin}
          note={MONEY_BACK_GUARANTEE}
          isPro
          signingIn={signingIn}
        />
      </div>
    </SectionShell>
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
    <SectionShell id="faq" className="py-[78px] max-sm:py-[54px]">
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
    </SectionShell>
  );
}

function LandingFooter({ onShowChangelog }: { onShowChangelog?: () => void }) {
  function handleChangelogClick(e: MouseEvent<HTMLAnchorElement>) {
    if (!onShowChangelog) return;
    e.preventDefault();
    onShowChangelog();
  }

  return (
    <footer className="landing-frame flex min-h-[200px] items-end justify-between gap-8 px-[clamp(18px,5vw,72px)] py-10 text-[var(--landing-muted)] max-sm:min-h-0 max-sm:flex-col max-sm:items-start">
      <div className="flex flex-col gap-3 text-[12.5px]">
        <span className="text-[36px] font-[760] leading-none tracking-[-0.03em] text-[var(--landing-text)]">
          Agendex<span className="text-[var(--landing-accent)]">.</span>
        </span>
        <span>© 2026 / All systems indexed</span>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-x-5 gap-y-3 max-sm:justify-start [&>a]:text-[12.5px] [&>a]:font-semibold [&>a]:text-[var(--landing-muted)] [&>a]:no-underline [&>a:hover]:text-[var(--landing-text)]">
        <a href="#overview">Overview</a>
        <a href="#features">Features</a>
        <a href="#pricing">Pricing</a>
        <a href="/changelog" onClick={handleChangelogClick}>
          Changelog
        </a>
        <a
          href="https://github.com/tiru5/agendex"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[34px] items-center gap-2 rounded-[7px] border border-[var(--landing-border)] px-3 !text-[var(--landing-text)]"
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
          className="mt-4 inline-flex min-h-10 w-full items-center justify-center rounded-[7px] border border-[color-mix(in_oklch,var(--landing-accent)_46%,transparent)] bg-[var(--landing-accent)] text-[13px] font-bold text-[var(--landing-bg)]"
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
    navbarAuthSlot: slots.NavbarAuth,
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
  const setActiveTab = (nextTab: LandingTab) =>
    dispatch({ type: 'SET_ACTIVE_TAB', value: nextTab });

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

  return { setTokenValue, openLogin, closeLogin, setYearly, setOpenFaq, setActiveTab, submit };
}

function LandingPageInner({ children, mascot, onShowChangelog }: LandingPageProps) {
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
  const { navbarAuthSlot, heroCtaNode, pricingCtaNode } = useLandingSlots(children);
  const { mobileMenuOpen, toggleMobileMenu, closeMobileMenu } = useMobileMenuControls({
    activeTab,
    showLogin,
  });

  useInitialHashScroll();

  return (
    <LandingContext.Provider value={ctxValue}>
      <div className="landing-page [&_a[href]]:cursor-pointer [&_button:not(:disabled)]:cursor-pointer">
        <LandingNavbar
          signingIn={signingIn}
          onSignIn={() => startViewTransition(actions.openLogin)}
          authSlot={navbarAuthSlot}
          mobileMenuOpen={mobileMenuOpen}
          onMobileMenuToggle={toggleMobileMenu}
          onMobileMenuClose={closeMobileMenu}
          onShowChangelog={onShowChangelog}
        />

        <LandingHero
          activeTab={activeTab}
          onShowLogin={() => startViewTransition(actions.openLogin)}
          onSetActiveTab={actions.setActiveTab}
          ctaSlot={heroCtaNode}
        />

        <SectionShell className="py-0">
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
        </SectionShell>

        <WorkflowSection />

        <SectionShell className="py-[72px] max-sm:py-[50px]">
          <div className="mb-8 max-w-[620px]">
            <h2 className="m-0 text-balance text-[32px] font-[740] leading-[1.08] tracking-[-0.025em] text-[var(--landing-text)] max-sm:text-[27px]">
              Everything the workspace does.
            </h2>
            <p className="mt-4 mb-0 text-[15px] leading-[1.7] text-[var(--landing-muted)]">
              Compact capabilities for people who scan plans daily and need provenance before
              polish.
            </p>
          </div>
          <CapabilityRows />
        </SectionShell>

        <LandingPricing
          yearly={yearly}
          signingIn={signingIn}
          onSetYearly={actions.setYearly}
          onShowLogin={() => startViewTransition(actions.openLogin)}
          proCtaSlot={pricingCtaNode}
        />

        <LandingFAQ openFaq={openFaq} onSetOpenFaq={actions.setOpenFaq} />

        <SectionShell className="py-[58px] text-center max-sm:py-[44px]">
          <h2 className="mx-auto m-0 max-w-[640px] text-balance text-[28px] font-[740] leading-[1.12] tracking-[-0.02em] text-[var(--landing-text)] max-sm:text-[24px]">
            Your next agent plan deserves a real review surface.
          </h2>
          <p className="mx-auto mt-3 mb-0 max-w-[520px] text-[14px] leading-[1.7] text-[var(--landing-muted)]">
            Start with a local index. Add Cloud Pro when review moves across people and machines.
          </p>
          <div className="mx-auto mt-6 max-w-[520px] text-left">
            <PkgManagerInstall />
          </div>
        </SectionShell>

        <LandingFooter onShowChangelog={onShowChangelog} />

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

export function LandingPage({ children, mascot, onShowChangelog }: LandingPageProps = {}) {
  return (
    <LandingPageInner mascot={mascot} onShowChangelog={onShowChangelog}>
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
