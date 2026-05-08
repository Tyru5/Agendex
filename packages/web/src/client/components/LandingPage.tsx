import React, { useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';
import type { ReactNode } from 'react';
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
import { TopoNeurons } from './landing/TopoNeurons.tsx';
import { GitHubIcon } from './OAuthIcons.tsx';

function Spinner({ size = 14, color }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className="animate-spin shrink-0"
      style={{ animationDuration: '0.8s' }}
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
const BG = '#041f1d';
const BORDER = 'rgba(238,244,232,0.12)';
const TEXT_PRIMARY = '#eef4e8';
const TEXT_MUTED = '#61736b';
const LANDING_ANCHOR_OFFSET = 96;
const LANDING_SECTIONS = [
  { id: 'features', label: 'Features' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'faq', label: 'FAQ' },
] as const;

export interface LandingPageProps {
  children?: ReactNode;
  mascot?: LandingMascotProps;
}

const DEMO_PLAN_ROWS = [
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

const HERO_PROOF_POINTS = [
  'Local files stay readable',
  'Search spans every agent',
  'Cloud review is optional',
] as const;

const REVIEW_EVENTS = [
  { label: 'Source', value: 'line-linked file path' },
  { label: 'Search', value: 'auth refactor, owner:codex' },
  { label: 'State', value: 'unseen changes highlighted' },
] as const;

const TEAM_EVENTS = [
  { label: 'Share link', value: 'token scoped to one plan' },
  { label: 'Thread', value: 'review note on migration step' },
  { label: 'Sync', value: 'local stays readable on disk' },
] as const;

const PRICING_PATH = [
  {
    number: '01',
    title: 'Start local',
    body: 'Index plans on your machine with every adapter included.',
  },
  {
    number: '02',
    title: 'Add sync',
    body: 'Let the daemon mirror selected plans when work moves devices.',
  },
  {
    number: '03',
    title: 'Review together',
    body: 'Use comments, links, and workspace access for team follow-up.',
  },
] as const;

const FAQ_SUPPORT_POINTS = [
  {
    label: 'Local first',
    body: 'Self-hosted works without an account and keeps files on disk.',
  },
  {
    label: 'Cloud later',
    body: 'Upgrade by signing in and starting the same CLI daemon.',
  },
  {
    label: 'Adapter based',
    body: 'New agent sources plug into the same plan index model.',
  },
] as const;

function DemoPanel({
  eyebrow,
  title,
  body,
  children,
  className = '',
}: {
  eyebrow: string;
  title: string;
  body: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <article
      className={`relative min-w-0 overflow-hidden rounded-[8px] border border-[var(--landing-border-subtle)] bg-[color-mix(in_oklch,var(--landing-surface)_82%,transparent)] p-[22px] max-sm:p-[18px] ${className}`}
    >
      <div className="relative z-[1] mb-5 flex items-center justify-between gap-3">
        <span className="font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace] text-[11px] font-bold uppercase text-[var(--landing-accent)]">
          {eyebrow}
        </span>
      </div>
      <h3 className="relative z-[1] m-0 max-w-[460px] text-[18px] font-bold leading-[1.22] text-[var(--landing-text)]">
        {title}
      </h3>
      <p className="relative z-[1] mt-2 mb-5 max-w-[520px] text-[13.5px] leading-[1.65] text-[var(--landing-muted)]">
        {body}
      </p>
      <div className="relative z-[1]">{children}</div>
    </article>
  );
}

function IndexDemoPanel() {
  return (
    <DemoPanel
      eyebrow="01 / Index"
      title="Watch every agent plan as it lands."
      body="Agendex keeps the local source visible, so a plan never becomes detached from the repo and agent that produced it."
      className="lg:col-span-5"
    >
      <div className="flex flex-col gap-1">
        {DEMO_PLAN_ROWS.map((row) => (
          <div
            key={row.title}
            className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-[5px] py-2.5 px-2 -mx-2 hover:bg-[color-mix(in_oklch,var(--landing-surface-raised)_40%,transparent)]"
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
              <div className="text-[11px] font-bold text-[var(--landing-muted)]">{row.agent}</div>
              <div className="mt-1 text-[11px] text-[var(--landing-accent)]">{row.status}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-[7px] border border-[color-mix(in_oklch,var(--landing-accent)_22%,transparent)] bg-[color-mix(in_oklch,var(--landing-accent)_7%,transparent)] px-3 py-2 font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace] text-[11.5px] leading-[1.55] text-[var(--landing-accent)]">
        daemon: 3 new plans indexed, zero manual refreshes
      </div>
    </DemoPanel>
  );
}

function ReviewDemoPanel() {
  return (
    <DemoPanel
      eyebrow="02 / Review"
      title="Search, inspect, and trace the source."
      body="The plan viewer connects search, markdown, source path, and review state without forcing users back through each agent tool."
      className="lg:col-span-4"
    >
      <div className="rounded-[7px] bg-[color-mix(in_oklch,var(--landing-bg)_74%,transparent)] p-3">
        <div className="flex items-center gap-2 font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace] text-[12px] text-[var(--landing-muted)]">
          <span className="text-[var(--landing-accent)]">{'>'}</span>
          <span className="min-w-0 truncate">auth refactor owner:codex</span>
          <span className="ml-auto rounded bg-[color-mix(in_oklch,var(--landing-surface-raised)_70%,transparent)] px-[5px] py-0.5 text-[10.5px] text-[var(--landing-faint)]">
            cmd k
          </span>
        </div>
      </div>
      <div className="mt-4 space-y-1">
        {REVIEW_EVENTS.map((event) => (
          <div
            key={event.label}
            className="flex min-h-[40px] items-center justify-between gap-4 text-[12.5px]"
          >
            <span className="font-bold text-[var(--landing-text)]">{event.label}</span>
            <span className="min-w-0 truncate text-right text-[var(--landing-muted)]">
              {event.value}
            </span>
          </div>
        ))}
      </div>
    </DemoPanel>
  );
}

function TeamDemoPanel() {
  return (
    <DemoPanel
      eyebrow="03 / Share"
      title="Add team review only when it earns its place."
      body="Cloud sync layers links, comments, and workspace access onto the same plans that remain readable locally."
      className="lg:col-span-3"
    >
      <div className="space-y-2">
        {TEAM_EVENTS.map((event, index) => (
          <div
            key={event.label}
            className="rounded-[7px] bg-[color-mix(in_oklch,var(--landing-bg)_72%,transparent)] p-3"
          >
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase text-[var(--landing-accent)]">
              {String(index + 1).padStart(2, '0')}
              <span className="text-[var(--landing-text)]">{event.label}</span>
            </div>
            <div className="mt-1 text-[12.5px] leading-[1.5] text-[var(--landing-muted)]">
              {event.value}
            </div>
          </div>
        ))}
      </div>
    </DemoPanel>
  );
}

function CapabilityList() {
  return (
    <div className="mt-4 grid grid-cols-3 gap-3 max-lg:grid-cols-2 max-sm:grid-cols-1">
      {FEATURES.map((feature, index) => (
        <div
          key={feature.title}
          className="min-w-0 rounded-[8px] bg-[color-mix(in_oklch,var(--landing-surface)_60%,transparent)] p-4"
        >
          <div className="mb-2 flex items-center gap-2">
            <span className="font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace] text-[10.5px] font-bold text-[var(--landing-accent)]">
              {String(index + 1).padStart(2, '0')}
            </span>
            <span className="truncate text-[13px] font-bold text-[var(--landing-text)]">
              {feature.title}
            </span>
          </div>
          <p className="m-0 line-clamp-2 text-[12.5px] leading-[1.55] text-[var(--landing-muted)]">
            {feature.desc}
          </p>
        </div>
      ))}
    </div>
  );
}

function ProductDemoSection({
  sectionRef,
  inView,
}: {
  sectionRef: React.RefObject<HTMLElement | null>;
  inView: boolean;
}) {
  return (
    <section
      id="features"
      ref={sectionRef}
      className="relative z-[1] border-b border-[var(--landing-border-subtle)] px-[clamp(20px,5vw,88px)] py-[76px] max-sm:px-4 max-sm:py-[58px]"
      style={{ scrollMarginTop: LANDING_ANCHOR_OFFSET }}
    >
      <div className="mb-[44px] grid grid-cols-[minmax(160px,0.35fr)_minmax(0,0.65fr)] gap-[clamp(22px,5vw,72px)] max-lg:grid-cols-1 max-lg:gap-5">
        <div className="flex items-baseline gap-3 self-start max-lg:w-full">
          <span className="font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace] text-[12px] font-medium tabular-nums text-[var(--landing-faint)]">
            01
          </span>
          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--landing-muted)]">
            Product flow
          </span>
        </div>
        <h2 className="m-0 max-w-[860px] text-balance font-[Unbounded,Inter,system-ui,sans-serif] text-[clamp(42px,4.8vw,60px)] font-[500] leading-[1.0] tracking-[-0.02em] text-[var(--landing-text)] max-sm:text-[34px] max-sm:leading-[1.04]">
          From scattered agent files to reviewed work.
        </h2>
        <p className="col-start-2 mt-3 mb-0 max-w-[560px] text-[15px] leading-[1.7] text-[var(--landing-muted)] max-lg:col-start-1 max-lg:mt-0">
          Watch local plans, find the right thread, then share context with a team when the work
          needs review.
        </p>
      </div>

      <div
        className={`grid grid-cols-12 gap-3.5 max-lg:grid-cols-1 ${
          inView ? 'animate-[landing-panel-in_260ms_cubic-bezier(0.22,1,0.36,1)_both]' : 'opacity-0'
        }`}
      >
        <IndexDemoPanel />
        <ReviewDemoPanel />
        <TeamDemoPanel />
      </div>

      <CapabilityList />
    </section>
  );
}

function PricingToggle({ yearly, onChange }: { yearly: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      className="col-start-2 inline-flex w-fit max-w-full gap-1 rounded-[8px] border border-[var(--landing-border)] bg-[color-mix(in_oklch,var(--landing-bg)_74%,transparent)] p-1 max-lg:col-start-1"
      aria-label="Billing cadence"
    >
      {(['Monthly', 'Yearly'] as const).map((label) => {
        const active = label === 'Yearly' ? yearly : !yearly;
        return (
          <button
            key={label}
            type="button"
            onClick={() => onChange(label === 'Yearly')}
            className="min-h-[34px] rounded-md border border-transparent bg-transparent px-[13px] text-[12.5px] font-bold leading-[1.2] text-[var(--landing-muted)] data-[active=true]:border-[color-mix(in_oklch,var(--landing-accent)_20%,var(--landing-border))] data-[active=true]:bg-[color-mix(in_oklch,var(--landing-accent)_10%,var(--landing-surface-raised))] data-[active=true]:text-[var(--landing-text)]"
            data-active={active}
          >
            {label}
            {label === 'Yearly' && (
              <span className="ml-1.5 text-[11px] font-semibold text-[color-mix(in_oklch,var(--landing-accent)_68%,var(--landing-muted))]">
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
  title,
  eyebrow,
  summary,
  price,
  period,
  features,
  isPro,
  cta,
  onCta,
  loading,
  ctaButtons,
  note,
}: {
  title: string;
  eyebrow: string;
  summary: string;
  price: string;
  period: string;
  features: string[];
  isPro?: boolean;
  cta: string;
  onCta?: () => void;
  loading?: boolean;
  ctaButtons?: React.ReactNode;
  note?: typeof MONEY_BACK_GUARANTEE;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`relative flex min-h-[430px] flex-col overflow-hidden rounded-[8px] border p-7 transition-[transform,border-color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] max-sm:min-h-0 max-sm:p-[22px] ${
        isPro
          ? 'border-[color-mix(in_oklch,var(--landing-accent)_18%,var(--landing-border))] bg-[color-mix(in_oklch,var(--landing-surface)_86%,var(--landing-bg))]'
          : 'border-[var(--landing-border)] bg-[color-mix(in_oklch,var(--landing-surface)_78%,transparent)]'
      } hover:border-[var(--landing-border-strong)]`}
      style={{
        transform: hovered ? 'translateY(-1px)' : 'none',
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div
            className={`mb-3 text-[11px] font-bold uppercase ${
              isPro
                ? 'text-[color-mix(in_oklch,var(--landing-accent)_68%,var(--landing-muted))]'
                : 'text-[var(--landing-muted)]'
            }`}
          >
            {eyebrow}
          </div>
          <h3 className="m-0 text-[20px] font-bold leading-[1.15] text-[var(--landing-text)]">
            {title}
          </h3>
        </div>
        {isPro && (
          <div className="shrink-0 rounded-[5px] border border-[color-mix(in_oklch,var(--landing-accent)_22%,var(--landing-border))] bg-[color-mix(in_oklch,var(--landing-accent)_7%,transparent)] px-2 py-1 text-[11px] font-bold uppercase text-[color-mix(in_oklch,var(--landing-accent)_70%,var(--landing-muted))]">
            Cloud Pro
          </div>
        )}
      </div>

      <p className="mt-4 mb-0 max-w-[430px] text-[13.5px] leading-[1.65] text-[var(--landing-muted)]">
        {summary}
      </p>

      <div className="mt-8 mb-6 flex items-end gap-2">
        <span className="font-[Unbounded,Inter,system-ui,sans-serif] text-[48px] font-[430] leading-none text-[var(--landing-text)]">
          {price}
        </span>
        {period && (
          <span className="text-[14px] font-semibold text-[var(--landing-muted)]">{period}</span>
        )}
      </div>

      <div className="pt-5">
        <div className="mb-3 text-[11px] font-bold uppercase text-[var(--landing-muted)]">
          Included
        </div>
      </div>
      <ul
        className={`m-0 mb-7 flex flex-1 list-none flex-col gap-3 p-0 ${
          isPro ? 'min-[1120px]:grid min-[1120px]:grid-cols-2 min-[1120px]:gap-x-5' : ''
        }`}
      >
        {features.map((f) => (
          <li
            key={f}
            className="flex items-start gap-2.5 text-[13.5px] leading-[1.5] text-[var(--landing-muted)]"
          >
            <span
              aria-hidden="true"
              className="font-bold text-[color-mix(in_oklch,var(--landing-accent)_62%,var(--landing-muted))]"
            >
              {'✓'}
            </span>
            {f}
          </li>
        ))}
      </ul>
      {note && (
        <div className="mb-4 border-t border-[var(--landing-border-subtle)] pt-4">
          <div className="text-[12px] font-bold text-[var(--landing-text)]">{note.label}</div>
          <p className="m-0 mt-1 text-[12px] leading-[1.55] text-[var(--landing-muted)]">
            {note.body}
          </p>
        </div>
      )}
      {ctaButtons || (
        <button
          type="button"
          disabled={loading}
          onClick={onCta}
          className={`inline-flex min-h-[46px] items-center justify-center gap-2 rounded-[8px] border text-[13px] font-bold leading-[1.2] ${
            isPro
              ? 'border-[color-mix(in_oklch,var(--landing-accent)_28%,var(--landing-border))] bg-[color-mix(in_oklch,var(--landing-accent)_11%,var(--landing-surface-raised))] text-[var(--landing-text)]'
              : 'border-[var(--landing-border)] bg-transparent text-[var(--landing-text)]'
          }`}
          style={{
            cursor: loading ? 'default' : 'pointer',
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading && <Spinner size={15} color={isPro ? TEXT_PRIMARY : undefined} />}
          {loading ? 'Redirecting…' : cta}
        </button>
      )}
    </div>
  );
}

function PricingBridge() {
  return (
    <div className="grid max-w-[820px] grid-cols-3 gap-2 max-md:grid-cols-1">
      {PRICING_PATH.map((step) => (
        <div
          key={step.number}
          className="rounded-[8px] bg-[color-mix(in_oklch,var(--landing-surface)_55%,transparent)] p-3.5"
        >
          <div className="mb-2 flex items-center gap-2">
            <span className="font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace] text-[10.5px] font-bold text-[color-mix(in_oklch,var(--landing-accent)_66%,var(--landing-muted))]">
              {step.number}
            </span>
            <span className="text-[12px] font-bold text-[var(--landing-text)]">{step.title}</span>
          </div>
          <p className="m-0 text-[12.5px] leading-[1.55] text-[var(--landing-muted)]">
            {step.body}
          </p>
        </div>
      ))}
    </div>
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
  tokenError?: string;
  onTokenChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const describedBy = tokenError ? `${hintId} ${errorId}` : hintId;

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }

    if (e.key !== 'Tab') return;

    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-[color-mix(in_oklch,var(--landing-bg)_82%,transparent)] p-5 backdrop-blur-xl"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={dialogRef}
        className="w-[min(100%,430px)] rounded-[8px] border border-[var(--landing-border)] bg-[var(--landing-surface)] p-7 shadow-[0_18px_40px_color-mix(in_oklch,var(--landing-bg)_68%,transparent)]"
      >
        <h2 id={titleId} className="m-0 mb-2 text-[20px] font-bold text-[var(--landing-text)]">
          Connect to Agendex
        </h2>
        <p
          id={descriptionId}
          className="m-0 mb-6 text-[13.5px] leading-[1.6] text-[var(--landing-muted)]"
        >
          Run the local server, copy the token printed in your terminal, then paste it here.
        </p>
        <form onSubmit={onSubmit} noValidate>
          <label
            htmlFor={inputId}
            className="mb-2 block text-[12px] font-bold text-[var(--landing-text)]"
          >
            Auth token
          </label>
          <input
            ref={inputRef}
            id={inputId}
            type="password"
            value={tokenValue}
            onChange={(e) => onTokenChange(e.target.value)}
            placeholder="Paste your token"
            required
            aria-invalid={tokenError ? 'true' : undefined}
            aria-describedby={describedBy}
            className="w-full rounded-[8px] border border-[var(--landing-border)] bg-[color-mix(in_oklch,var(--landing-bg)_74%,transparent)] px-3.5 py-[13px] font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace] text-[13px] leading-[1.4] text-[var(--landing-text)] outline-none placeholder:text-[var(--landing-faint)]"
            onFocus={(e) => {
              e.currentTarget.style.borderColor = 'rgba(200,255,50,0.4)';
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = BORDER;
            }}
          />
          <p
            id={hintId}
            className="mt-2 mb-0 text-[12px] leading-[1.55] text-[var(--landing-muted)]"
          >
            The token is local-only and stored in this browser.
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
            className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-[8px] border border-[color-mix(in_oklch,var(--landing-accent)_46%,transparent)] bg-[var(--landing-accent)] text-[13px] font-bold text-[var(--landing-bg)]"
          >
            Connect
          </button>
        </form>
        <button
          type="button"
          onClick={onClose}
          className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-[8px] border border-transparent bg-transparent text-[13px] font-bold text-[var(--landing-muted)]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function PkgManagerInstall() {
  const [activePkg, setActivePkg] = useState<string>(PKG_MANAGERS[0].id);
  const [copied, setCopied] = useState(false);
  const cmd = PKG_MANAGERS.find((p) => p.id === activePkg)?.cmd;

  function copy() {
    if (cmd) navigator.clipboard.writeText(cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="m-0 bg-[color-mix(in_oklch,var(--landing-bg)_88%,transparent)] p-3">
      <div className="mb-2.5 flex flex-wrap gap-[5px]">
        {PKG_MANAGERS.map((pm) => (
          <button
            key={pm.id}
            type="button"
            className={`min-h-7 rounded-[5px] border-0 px-[9px] font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace] text-[11px] font-semibold leading-none ${
              activePkg === pm.id
                ? 'bg-[color-mix(in_oklch,var(--landing-accent)_14%,transparent)] text-[var(--landing-accent)]'
                : 'bg-transparent text-[var(--landing-muted)] hover:text-[var(--landing-text)]'
            }`}
            onClick={() => setActivePkg(pm.id)}
          >
            {pm.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2.5">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace] text-[12.5px] leading-[1.6] text-[var(--landing-accent)]">
          {cmd}
        </code>
        <button
          type="button"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--landing-border)] bg-transparent text-[var(--landing-muted)] hover:border-[var(--landing-border-strong)] hover:text-[var(--landing-text)]"
          onClick={copy}
          aria-label="Copy command"
        >
          {copied ? (
            <svg
              aria-hidden="true"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg
              aria-hidden="true"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

function StepsList({ steps }: { steps: typeof LOCAL_STEPS | typeof CLOUD_STEPS }) {
  return (
    <>
      {steps.map((step) => (
        <div
          key={step.number}
          className="overflow-hidden rounded-[7px] bg-[color-mix(in_oklch,var(--landing-bg)_74%,transparent)]"
        >
          <div className="bg-[color-mix(in_oklch,var(--landing-surface-raised)_80%,transparent)] px-3 py-2.5 font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace] text-[11px] font-bold uppercase leading-[1.2] text-[var(--landing-text)]">
            {step.number} / {step.title.toUpperCase()}
          </div>
          {'hasPkgManager' in step && step.hasPkgManager ? (
            <PkgManagerInstall />
          ) : (
            <pre className="m-0 overflow-x-auto bg-[color-mix(in_oklch,var(--landing-bg)_88%,transparent)] p-3.5 font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace] text-[12.5px] leading-[1.65] text-[var(--landing-accent)] max-sm:whitespace-pre-wrap max-sm:[overflow-wrap:anywhere]">
              <code>{step.code}</code>
            </pre>
          )}
        </div>
      ))}
    </>
  );
}

function AnimatedSteps({ activeTab }: { activeTab: 'local' | 'cloud' }) {
  return (
    <div
      className="relative z-[1] flex animate-[landing-panel-in_220ms_cubic-bezier(0.22,1,0.36,1)_both] flex-col gap-2.5 p-2.5"
      key={activeTab}
    >
      <StepsList steps={activeTab === 'cloud' ? CLOUD_STEPS : LOCAL_STEPS} />
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
}: {
  signingIn: boolean;
  onSignIn: () => void;
  authSlot?: SlotRenderFn;
  mobileMenuOpen: boolean;
  onMobileMenuToggle: () => void;
  onMobileMenuClose: () => void;
}) {
  const authAction = authSlot ? (
    authSlot()
  ) : (
    <button
      type="button"
      disabled={signingIn}
      onClick={() => {
        onMobileMenuClose();
        onSignIn();
      }}
      className="inline-flex min-h-[38px] items-center justify-center gap-2 rounded-[8px] border border-[var(--landing-border)] bg-[color-mix(in_oklch,var(--landing-surface)_76%,transparent)] px-4 text-[12.5px] font-semibold leading-[1.2] text-[var(--landing-text)] transition-[background-color,border-color,color] duration-150 hover:border-[var(--landing-border-strong)] hover:bg-[var(--landing-surface-raised)]"
      style={{
        cursor: signingIn ? 'default' : 'pointer',
        opacity: signingIn ? 0.6 : 1,
      }}
    >
      {signingIn && <Spinner size={12} />}
      {signingIn ? 'Redirecting…' : 'Sign in'}
    </button>
  );

  return (
    <nav className="fixed inset-x-0 top-0 z-[100] border-b border-[var(--landing-border-subtle)] bg-[color-mix(in_oklch,var(--landing-bg)_88%,transparent)] backdrop-blur-[14px]">
      <div className="flex min-h-16 items-center justify-between gap-5 px-[clamp(20px,5vw,88px)] max-sm:min-h-[58px] max-sm:px-4">
        <div className="flex min-w-0 items-center gap-9">
          <a
            href="#overview"
            onClick={onMobileMenuClose}
            className="shrink-0 font-[Unbounded,Inter,system-ui,sans-serif] text-[15px] font-[430] text-[var(--landing-text)] no-underline"
          >
            Agendex<span className="text-[var(--landing-accent)]">.</span>
          </a>
          <div className="flex items-center gap-6 max-[980px]:hidden">
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
              className="text-[12.5px] font-semibold text-[var(--landing-muted)] no-underline transition-colors duration-150 hover:text-[var(--landing-text)]"
            >
              Changelog
            </a>
          </div>
        </div>

        <div className="block shrink-0 max-[980px]:hidden [&>button]:min-h-[38px] [&>button]:rounded-[8px] [&>button]:border-[var(--landing-border)] [&>button]:bg-[color-mix(in_oklch,var(--landing-surface)_76%,transparent)] [&>button]:text-[var(--landing-text)] [&>div>button:first-child]:min-h-[38px] [&>div>button:first-child]:rounded-[8px] [&>div>button:first-child]:border-[var(--landing-border)] [&>div>button:first-child]:bg-[color-mix(in_oklch,var(--landing-surface)_76%,transparent)] [&>div>button:first-child]:text-[var(--landing-text)]">
          {authAction}
        </div>

        <button
          type="button"
          aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={mobileMenuOpen}
          aria-controls="landing-mobile-menu"
          onClick={onMobileMenuToggle}
          className="hidden size-[42px] shrink-0 items-center justify-center rounded-[8px] border border-[var(--landing-border)] bg-[color-mix(in_oklch,var(--landing-surface)_70%,transparent)] text-[var(--landing-text)] max-[980px]:inline-flex"
        >
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none">
            {mobileMenuOpen ? (
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            ) : (
              <path
                d="M4 7h16M4 12h16M4 17h16"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            )}
          </svg>
        </button>
      </div>

      <div
        id="landing-mobile-menu"
        className={`border-t border-[var(--landing-border)] px-5 py-4 min-[981px]:hidden ${
          mobileMenuOpen ? 'block' : 'hidden'
        }`}
      >
        <div className="flex flex-col gap-2.5">
          {LANDING_SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              onClick={onMobileMenuClose}
              className="flex min-h-11 items-center rounded-[8px] border border-[var(--landing-border)] bg-[color-mix(in_oklch,var(--landing-surface)_72%,transparent)] px-3.5 text-[14px] font-semibold text-[var(--landing-text)] no-underline"
            >
              {section.label}
            </a>
          ))}
          <a
            href="/changelog"
            onClick={onMobileMenuClose}
            className="flex min-h-11 items-center rounded-[8px] border border-[var(--landing-border)] bg-[color-mix(in_oklch,var(--landing-surface)_72%,transparent)] px-3.5 text-[14px] font-semibold text-[var(--landing-text)] no-underline"
          >
            Changelog
          </a>
          <div className="pt-1 [&>*]:w-full">{authSlot ? authSlot() : authAction}</div>
        </div>
      </div>
    </nav>
  );
}

function LandingFooter() {
  return (
    <footer className="relative z-[1] flex min-h-[220px] items-end justify-between gap-8 border-t border-[var(--landing-border-subtle)] bg-[color-mix(in_oklch,var(--landing-bg)_94%,oklch(12%_0.03_184))] px-[clamp(20px,5vw,88px)] py-11 text-[var(--landing-muted)] max-sm:min-h-0 max-sm:flex-col max-sm:items-start max-sm:px-4 max-sm:py-8">
      <div className="flex flex-col gap-3 text-[12.5px]">
        <span className="font-[Unbounded,Inter,system-ui,sans-serif] text-[42px] font-[430] leading-none text-[var(--landing-text)]">
          Agendex<span className="text-[var(--landing-accent)]">.</span>
        </span>
        <span>© {new Date().getFullYear()} / All systems indexed</span>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-x-5 gap-y-3 max-sm:justify-start [&>a]:text-[12.5px] [&>a]:font-semibold [&>a]:text-[var(--landing-muted)] [&>a]:no-underline [&>a:hover]:text-[var(--landing-text)]">
        <a href="#overview">Overview</a>
        <a href="#features">Features</a>
        <a href="#pricing">Pricing</a>
        <a href="/changelog">Changelog</a>
        <a
          href="https://github.com/tiru5/agendex"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[38px] items-center gap-2 rounded-[8px] border border-[var(--landing-border)] px-[13px] !text-[var(--landing-text)]"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
          </svg>
          View on GitHub
        </a>
      </div>
    </footer>
  );
}

const GitHubIcon16 = () => <GitHubIcon />;

function HeroPlanRoom({
  activeTab,
  onSetActiveTab,
}: {
  activeTab: 'local' | 'cloud';
  onSetActiveTab: (v: 'local' | 'cloud') => void;
}) {
  return (
    <div className="relative z-[1] flex min-w-0 flex-col gap-3 max-[980px]:max-w-[720px]">
      <div className="flex w-full items-center justify-between gap-2 text-[11px] font-bold uppercase text-[var(--landing-muted)] max-sm:flex-col max-sm:items-start">
        <span>Plan room preview</span>
        <span>{activeTab === 'cloud' ? 'Cloud sync path' : 'Local first path'}</span>
      </div>

      <div className="relative overflow-hidden rounded-[8px] border border-[var(--landing-border-subtle)] bg-[linear-gradient(135deg,color-mix(in_oklch,var(--landing-surface-raised)_58%,transparent),color-mix(in_oklch,var(--landing-bg)_92%,transparent))] shadow-[0_18px_40px_color-mix(in_oklch,var(--landing-bg)_64%,transparent)]">
        <div className="relative z-[1] border-b border-[var(--landing-border-subtle)] p-4 max-sm:p-3.5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase text-[var(--landing-accent)]">
                <span
                  aria-hidden="true"
                  className="size-[6px] rounded-full bg-[var(--landing-accent)]"
                />
                Live index
              </div>
              <h2 className="mt-2 mb-0 text-[19px] font-bold leading-[1.18] text-[var(--landing-text)]">
                Plans arrive with source, owner, and review state.
              </h2>
            </div>
            <div className="shrink-0 rounded-[5px] bg-[color-mix(in_oklch,var(--landing-surface-raised)_60%,transparent)] px-2 py-1 font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace] text-[10.5px] font-bold text-[var(--landing-muted)]">
              daemon online
            </div>
          </div>

          <div className="overflow-hidden rounded-[7px] bg-[color-mix(in_oklch,var(--landing-bg)_86%,transparent)]">
            {DEMO_PLAN_ROWS.map((row) => (
              <div
                key={`hero-${row.title}`}
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3.5 py-3 odd:bg-[color-mix(in_oklch,var(--landing-surface)_22%,transparent)]"
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
                  <div className="text-[11px] font-bold text-[var(--landing-muted)]">
                    {row.agent}
                  </div>
                  <div className="mt-1 text-[11px] text-[var(--landing-accent)]">{row.status}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {HERO_PROOF_POINTS.map((point) => (
              <span
                key={point}
                className="rounded-full bg-[color-mix(in_oklch,var(--landing-surface)_60%,transparent)] px-2.5 py-1.5 text-[11.5px] font-semibold text-[var(--landing-muted)]"
              >
                {point}
              </span>
            ))}
          </div>
        </div>

        <div className="relative z-[1] p-2.5">
          <div className="grid grid-cols-2 gap-1.5 rounded-[8px] bg-[color-mix(in_oklch,var(--landing-bg)_72%,transparent)] p-1">
            <button
              type="button"
              className={`min-h-9 cursor-pointer rounded-md border-0 text-[12px] font-bold leading-[1.2] ${
                activeTab === 'local'
                  ? 'bg-[var(--landing-surface-raised)] text-[var(--landing-text)]'
                  : 'bg-transparent text-[var(--landing-muted)] hover:text-[var(--landing-text)]'
              }`}
              onClick={() => onSetActiveTab('local')}
            >
              Self-hosted
            </button>
            <button
              type="button"
              className={`min-h-9 cursor-pointer rounded-md border-0 text-[12px] font-bold leading-[1.2] ${
                activeTab === 'cloud'
                  ? 'bg-[var(--landing-surface-raised)] text-[var(--landing-text)]'
                  : 'bg-transparent text-[var(--landing-muted)] hover:text-[var(--landing-text)]'
              }`}
              onClick={() => onSetActiveTab('cloud')}
            >
              Cloud sync
            </button>
          </div>
        </div>

        <AnimatedSteps activeTab={activeTab} />
      </div>
    </div>
  );
}

function LandingHero({
  activeTab,
  onShowLogin,
  onSetActiveTab,
  ctaSlot,
}: {
  activeTab: 'local' | 'cloud';
  onShowLogin: () => void;
  onSetActiveTab: (v: 'local' | 'cloud') => void;
  ctaSlot?: ReactNode;
}) {
  return (
    <div className="relative z-[1]">
      <section
        id="overview"
        className="d3-hero grid min-h-[min(820px,88svh)] grid-cols-[minmax(0,0.96fr)_minmax(440px,1.04fr)] items-end gap-[clamp(24px,3vw,46px)] border-b border-[var(--landing-border-subtle)] px-[clamp(20px,5vw,88px)] pt-[116px] pb-[70px] max-[980px]:min-h-0 max-[980px]:grid-cols-1 max-[980px]:gap-6 max-[980px]:pt-[104px] max-sm:gap-5 max-sm:px-4 max-sm:pt-[92px] max-sm:pb-[54px]"
        style={{ scrollMarginTop: LANDING_ANCHOR_OFFSET }}
      >
        <div className="relative z-[1] flex h-full max-w-[800px] flex-col justify-between gap-12 max-[980px]:h-auto max-[980px]:gap-10">
          <div
            className="flex items-center gap-4 [animation:landing-panel-in_640ms_cubic-bezier(0.22,1,0.36,1)_both]"
            aria-hidden="true"
          >
            <span className="relative flex h-2 w-2 shrink-0 items-center justify-center">
              <span className="absolute inset-[-3px] rounded-full bg-[color-mix(in_oklch,var(--landing-accent)_28%,transparent)] [animation:status-pulse_2.5s_ease-in-out_infinite]" />
              <span className="relative h-2 w-2 rounded-full bg-[var(--landing-accent)]" />
            </span>
            <span className="font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace] text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--landing-text)]">
              Plan Room
            </span>
            <span className="ml-auto font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace] text-[10.5px] font-medium uppercase tracking-[0.22em] text-[var(--landing-faint)] max-sm:hidden">
              Index · Review · Share
            </span>
          </div>

          <div>
            <h1 className="mb-6 max-w-[760px] text-balance font-[Unbounded,Inter,system-ui,sans-serif] text-[74px] font-[430] leading-[0.98] text-[var(--landing-text)] [animation:landing-panel-in_640ms_cubic-bezier(0.22,1,0.36,1)_60ms_both] max-[980px]:text-[54px] max-sm:text-[40px] max-sm:leading-[1.04]">
              Your agents make plans. <br />
              Agendex keeps watch.
            </h1>

            <p className="m-0 max-w-[620px] text-pretty text-[16px] leading-[1.75] text-[var(--landing-muted)] [animation:landing-panel-in_640ms_cubic-bezier(0.22,1,0.36,1)_180ms_both] max-sm:text-[14.5px]">
              Index local plan files from Claude Code, Codex, Cursor, and more. Search the source,
              review changes, and add Cloud only when the work needs shared context.
            </p>

            <div className="mt-[34px] flex flex-wrap gap-3 [animation:landing-panel-in_640ms_cubic-bezier(0.22,1,0.36,1)_300ms_both] max-sm:[&>*]:w-full [&>a]:inline-flex [&>a]:min-h-[46px] [&>a]:items-center [&>a]:justify-center [&>a]:gap-[9px] [&>a]:rounded-[8px] [&>a]:px-[18px] [&>a]:text-[13px] [&>a]:font-bold [&>a]:leading-[1.2] [&>a]:no-underline [&>button]:inline-flex [&>button]:min-h-[46px] [&>button]:items-center [&>button]:justify-center [&>button]:gap-[9px] [&>button]:rounded-[8px] [&>button]:px-[18px] [&>button]:text-[13px] [&>button]:font-bold [&>button]:leading-[1.2]">
              {ctaSlot || (
                <button
                  type="button"
                  onClick={onShowLogin}
                  className="border border-[color-mix(in_oklch,var(--landing-accent)_48%,transparent)] bg-[var(--landing-accent)] text-[var(--landing-bg)]"
                >
                  Get Started
                </button>
              )}
              <a
                href="https://github.com/tiru5/agendex"
                target="_blank"
                rel="noopener noreferrer"
                className="border border-[var(--landing-border)] bg-[color-mix(in_oklch,var(--landing-surface)_78%,transparent)] text-[var(--landing-text)]"
              >
                <GitHubIcon16 />
                View on GitHub
              </a>
            </div>
          </div>
        </div>

        <HeroPlanRoom activeTab={activeTab} onSetActiveTab={onSetActiveTab} />
      </section>
    </div>
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
      className="relative z-[1] border-b border-[var(--landing-border-subtle)] px-[clamp(20px,5vw,88px)] py-[86px] max-sm:px-4 max-sm:py-[58px]"
      style={{ scrollMarginTop: LANDING_ANCHOR_OFFSET }}
    >
      <div className="mb-12 grid grid-cols-[minmax(160px,0.32fr)_minmax(0,0.68fr)] gap-[clamp(22px,5vw,72px)] max-lg:grid-cols-1 max-lg:gap-5">
        <div className="flex items-baseline gap-3 self-start max-lg:w-full">
          <span className="font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace] text-[12px] font-medium tabular-nums text-[var(--landing-faint)]">
            02
          </span>
          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--landing-muted)]">
            Pricing
          </span>
        </div>
        <div className="min-w-0">
          <h2 className="m-0 max-w-[860px] text-balance font-[Unbounded,Inter,system-ui,sans-serif] text-[clamp(42px,4.8vw,60px)] font-[500] leading-[1.0] tracking-[-0.02em] text-[var(--landing-text)] max-sm:text-[34px] max-sm:leading-[1.04]">
            Start local. Upgrade when review becomes shared.
          </h2>
          <p className="mt-4 mb-0 max-w-[600px] text-[15px] leading-[1.7] text-[var(--landing-muted)]">
            The free path is a complete local index. Cloud Pro adds sync, comments, links, and
            workspace access without changing where plans originate.
          </p>
          <div className="mt-7 flex flex-col gap-4">
            <PricingBridge />
            <PricingToggle yearly={yearly} onChange={onSetYearly} />
          </div>
        </div>
      </div>
      <div className="d3-pricing-row grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-3.5 max-lg:grid-cols-1">
        <PricingCard
          title="Self-hosted"
          eyebrow="Local OSS"
          summary="For solo review, private experiments, and teams that want the full source path before adding collaboration."
          price="$0"
          period=""
          features={FREE_FEATURES}
          cta="Get Started"
          onCta={onShowLogin}
        />
        <PricingCard
          title="Cloud Pro"
          eyebrow="Team review"
          summary="For shared plan review across machines, links, comments, and workspace access on top of the local daemon."
          price={yearly ? '$69' : '$7'}
          period={yearly ? '/year' : '/month'}
          features={PRO_FEATURES}
          isPro
          cta="Start Free Trial"
          onCta={proCtaSlot ? undefined : onShowLogin}
          loading={!proCtaSlot ? signingIn : undefined}
          ctaButtons={proCtaSlot}
          note={MONEY_BACK_GUARANTEE}
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
      className="relative z-[1] border-b border-[var(--landing-border-subtle)] px-[clamp(20px,5vw,88px)] pt-[84px] pb-[110px] max-sm:px-4 max-sm:py-[58px]"
      style={{ scrollMarginTop: LANDING_ANCHOR_OFFSET }}
    >
      <div className="grid grid-cols-[minmax(230px,0.34fr)_minmax(0,0.66fr)] gap-[clamp(28px,6vw,88px)] max-lg:grid-cols-1">
        <div className="min-w-0">
          <div className="flex items-baseline gap-3">
            <span className="font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace] text-[12px] font-medium tabular-nums text-[var(--landing-faint)]">
              03
            </span>
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--landing-muted)]">
              Support
            </span>
          </div>
          <h2 className="mt-7 mb-0 max-w-[640px] text-balance font-[Unbounded,Inter,system-ui,sans-serif] text-[clamp(42px,4.8vw,60px)] font-[500] leading-[1.0] tracking-[-0.02em] text-[var(--landing-text)] max-sm:text-[34px] max-sm:leading-[1.04]">
            Answers before you install.
          </h2>
          <p className="mt-4 mb-0 max-w-[430px] text-[14.5px] leading-[1.7] text-[var(--landing-muted)]">
            Privacy, adapters, and Cloud sync in plain terms. No account is required to start
            self-hosted.
          </p>
          <div className="mt-8 border-t border-[var(--landing-border-subtle)]">
            {FAQ_SUPPORT_POINTS.map((point) => (
              <div
                key={point.label}
                className="border-b border-[var(--landing-border-subtle)] py-4"
              >
                <div className="text-[12px] font-bold text-[var(--landing-text)]">
                  {point.label}
                </div>
                <p className="m-0 mt-1 text-[12.5px] leading-[1.55] text-[var(--landing-muted)]">
                  {point.body}
                </p>
              </div>
            ))}
          </div>
        </div>
        <div className="min-w-0 border-t border-[var(--landing-border-subtle)]">
          {FAQ_ITEMS.map((item, i) => (
            <FAQItem
              key={item.q}
              index={i + 1}
              question={item.q}
              answer={item.a}
              open={openFaq === i}
              onToggle={() => onSetOpenFaq(openFaq === i ? null : i)}
            />
          ))}
        </div>
      </div>
    </section>
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

function LandingPageInner({ children, mascot }: LandingPageProps) {
  const [state, dispatch] = useReducer(landingReducer, LANDING_INITIAL);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [tokenError, setTokenError] = useState('');
  const { token, showLogin, yearly, openFaq, activeTab, bentoInView, signingIn } = state;
  const setTokenValue = (v: string) => {
    if (tokenError) setTokenError('');
    dispatch({ type: 'SET_TOKEN', value: v });
  };
  const setShowLogin = (v: boolean) => dispatch({ type: 'SET_SHOW_LOGIN', value: v });
  const setYearly = (v: boolean) => dispatch({ type: 'SET_YEARLY', value: v });
  const setOpenFaq = (v: number | null) => dispatch({ type: 'SET_OPEN_FAQ', value: v });
  const setActiveTab = (v: 'local' | 'cloud') => dispatch({ type: 'SET_ACTIVE_TAB', value: v });
  const bentoRef = useRef<HTMLElement>(null);

  const ctxValue = useMemo<LandingContextValue>(
    () => ({
      signingIn,
      activeTab,
      showLogin: () => startViewTransition(() => setShowLogin(true)),
      startSigningIn: () => dispatch({ type: 'START_SIGNING_IN' }),
      stopSigningIn: () => dispatch({ type: 'STOP_SIGNING_IN' }),
    }),
    [signingIn, activeTab],
  );

  const slots = useMemo(() => extractSlots(children), [children]);

  const heroCtaNode = slots.HeroCta ? slots.HeroCta() : undefined;
  const pricingCtaNode = slots.PricingCta ? slots.PricingCta() : undefined;

  useEffect(() => {
    const el = bentoRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          dispatch({ type: 'SET_BENTO_IN_VIEW' });
          observer.disconnect();
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    const target = document.getElementById(hash);
    if (!target) return;
    requestAnimationFrame(() => {
      target.scrollIntoView({ block: 'start' });
    });
  }, []);

  useEffect(() => {
    function handleResize() {
      if (window.innerWidth >= 768) setMobileMenuOpen(false);
    }

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [activeTab, showLogin]);

  useEffect(() => {
    const ids = ['overview', ...LANDING_SECTIONS.map((section) => section.id)];
    const sections = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null)
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    if (!sections.length) return;

    let frame = 0;
    let currentId: string | null = null;

    function update() {
      frame = 0;
      const anchor = LANDING_ANCHOR_OFFSET + 1;
      const doc = document.documentElement;
      const atBottom = window.innerHeight + window.scrollY >= doc.scrollHeight - 2;

      let activeId = sections[0].id;
      if (atBottom) {
        activeId = sections[sections.length - 1].id;
      } else {
        for (const section of sections) {
          if (section.getBoundingClientRect().top <= anchor) {
            activeId = section.id;
          } else {
            break;
          }
        }
      }

      if (activeId === currentId) return;
      currentId = activeId;

      const url = new URL(window.location.href);
      url.hash = activeId === 'overview' ? '' : activeId;
      const next = `${url.pathname}${url.search}${url.hash}`;
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (next !== current) {
        window.history.replaceState(window.history.state, '', next);
      }
    }

    function schedule() {
      if (frame) return;
      frame = requestAnimationFrame(update);
    }

    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) {
      setTokenError('Paste the token printed by the Agendex CLI before connecting.');
      return;
    }
    setToken(trimmed);
    window.location.reload();
  }

  function closeLogin() {
    setTokenError('');
    setShowLogin(false);
  }

  return (
    <LandingContext.Provider value={ctxValue}>
      <div className="landing-page">
        <TopoNeurons />

        <LandingNavbar
          signingIn={signingIn}
          onSignIn={() => startViewTransition(() => setShowLogin(true))}
          authSlot={slots.NavbarAuth}
          mobileMenuOpen={mobileMenuOpen}
          onMobileMenuToggle={() => setMobileMenuOpen((open) => !open)}
          onMobileMenuClose={() => setMobileMenuOpen(false)}
        />

        <LandingHero
          activeTab={activeTab}
          onShowLogin={() => startViewTransition(() => setShowLogin(true))}
          onSetActiveTab={setActiveTab}
          ctaSlot={heroCtaNode}
        />

        <ProductDemoSection sectionRef={bentoRef} inView={bentoInView} />

        <LandingPricing
          yearly={yearly}
          signingIn={signingIn}
          onSetYearly={setYearly}
          onShowLogin={() => startViewTransition(() => setShowLogin(true))}
          proCtaSlot={pricingCtaNode}
        />

        <LandingFAQ openFaq={openFaq} onSetOpenFaq={setOpenFaq} />

        <LandingFooter />

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
            onTokenChange={setTokenValue}
            onSubmit={submit}
            onClose={() => startViewTransition(closeLogin)}
          />
        )}
      </div>
    </LandingContext.Provider>
  );
}

export function LandingPage({ children, mascot }: LandingPageProps = {}) {
  return <LandingPageInner mascot={mascot}>{children}</LandingPageInner>;
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
        className="group grid min-h-[76px] w-full cursor-pointer grid-cols-[38px_minmax(0,1fr)_30px] items-center gap-4 border-0 bg-transparent px-0 py-[19px] text-left text-[15px] font-bold leading-[1.45] text-[var(--landing-text)] transition-colors duration-150 max-sm:grid-cols-[30px_minmax(0,1fr)_30px] max-sm:gap-3"
        style={{
          color: hovered || open ? TEXT_PRIMARY : undefined,
        }}
      >
        <span className="font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace] text-[11px] font-bold text-[var(--landing-accent)]">
          {String(index).padStart(2, '0')}
        </span>
        <span className="text-pretty">{question}</span>
        <div
          className="inline-flex size-[30px] shrink-0 items-center justify-center rounded-full transition-[background-color,border-color] duration-200"
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
              transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              transform: open ? 'rotate(180deg)' : 'none',
            }}
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
        style={{
          gridTemplateRows: open ? '1fr' : '0fr',
        }}
      >
        <div className="overflow-hidden">
          <p
            className="m-0 max-w-[650px] pb-[24px] pl-[52px] text-[14px] leading-[1.75] text-[var(--landing-muted)] max-sm:pl-[42px]"
            style={{
              opacity: open ? 1 : 0,
              transform: open ? 'translateY(0)' : 'translateY(-4px)',
              transition: 'opacity 0.25s 0.05s, transform 0.25s 0.05s',
            }}
          >
            {answer}
          </p>
        </div>
      </section>
    </div>
  );
}
