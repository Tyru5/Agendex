import React, { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { startViewTransition } from '../lib/view-transition.ts';
import {
  AGENTS,
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
import { FAQBackground } from './landing/FAQBackground.tsx';
import { IconCloud } from './landing/IconCloud.tsx';
import { TopoNeurons } from './landing/TopoNeurons.tsx';
import { GitHubIcon, GoogleIcon } from './OAuthIcons.tsx';

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

const OPENAI_SVG = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100" height="100"><path fill="white" d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"/></svg>')}`;

const AGENT_ICON_IMAGES = [
  'https://cdn.simpleicons.org/claude/ffffff', // Claude Code
  'https://cdn.simpleicons.org/cursor/ffffff', // Cursor
  OPENAI_SVG, // Codex (OpenAI)
  'https://cdn.simpleicons.org/githubcopilot/ffffff', // GitHub Copilot
  'https://cdn.simpleicons.org/googlegemini/ffffff', // Gemini CLI
  'https://cdn.simpleicons.org/amp/ffffff', // Amp
  'https://cdn.simpleicons.org/replit/ffffff', // Replit
  'https://cdn.simpleicons.org/jetbrains/ffffff', // Junie
  'https://cdn.simpleicons.org/mistralai/ffffff', // Mistral Vibe
  'https://cdn.simpleicons.org/neovim/ffffff', // Neovate
];

const ACCENT = '#c8ff32';
const BG = '#0a0a0a';
const SURFACE = '#141414';
const BORDER = 'rgba(255,255,255,0.06)';
const TEXT_PRIMARY = '#ffffff';
const TEXT_SECONDARY = '#999';
const TEXT_MUTED = '#666';
const RADIUS = 20;
const CARD_PAD = 36;
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

const BENTO_MAP: { colSpan: number; rowSpan: number }[] = [
  { colSpan: 2, rowSpan: 1 }, // Instant Indexing
  { colSpan: 1, rowSpan: 1 }, // Share Plans
  { colSpan: 1, rowSpan: 1 }, // Comments
  { colSpan: 1, rowSpan: 1 }, // Cloud Sync
  { colSpan: 1, rowSpan: 1 }, // Fuzzy Search
  { colSpan: 2, rowSpan: 1 }, // Adapter System
  { colSpan: 1, rowSpan: 1 }, // Tech Charts
  { colSpan: 1, rowSpan: 1 }, // New Plan Tracking
  { colSpan: 2, rowSpan: 1 }, // Plan Creation
];

function IndexingViz() {
  const dots = Array.from({ length: 6 });
  return (
    <div className="relative h-20 mt-4">
      <style>{`
        @keyframes d3-dot-appear {
          0% { opacity: 0; transform: scale(0); }
          50% { opacity: 1; transform: scale(1.2); }
          100% { opacity: 0.7; transform: scale(1); }
        }
        @keyframes d3-line-draw {
          from { stroke-dashoffset: 60; }
          to { stroke-dashoffset: 0; }
        }
      `}</style>
      <svg width="100%" height="80" viewBox="0 0 320 80" fill="none">
        {dots.map((_, i) => {
          const cx = 30 + i * 56;
          const cy = 40 + (i % 2 === 0 ? -12 : 12);
          return (
            <g key={`dot-${cx}-${cy}`}>
              {i > 0 && (
                <line
                  x1={30 + (i - 1) * 56}
                  y1={40 + ((i - 1) % 2 === 0 ? -12 : 12)}
                  x2={cx}
                  y2={cy}
                  stroke={ACCENT}
                  strokeWidth={1.5}
                  strokeDasharray="60"
                  opacity={0.3}
                  style={{
                    animation: `d3-line-draw 0.6s ${i * 0.3 + 0.2}s ease forwards`,
                    strokeDashoffset: 60,
                  }}
                />
              )}
              <circle
                cx={cx}
                cy={cy}
                r={6}
                fill={ACCENT}
                opacity={0}
                style={{
                  animation: `d3-dot-appear 0.5s ${i * 0.3}s ease forwards`,
                }}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function SearchMockup() {
  return (
    <div className="mt-4 bg-[rgba(255,255,255,0.04)] rounded-[10px] px-3.5 py-2.5 flex items-center gap-2 text-[13px] text-[#666] font-mono">
      <span className="opacity-50">{'>'}</span>
      <span>search plans...</span>
      <span className="ml-auto text-[11px] bg-[rgba(255,255,255,0.06)] px-1.5 py-0.5 rounded">
        ⌘K
      </span>
    </div>
  );
}

function CloudIcon() {
  return (
    <div className="mt-4 text-center">
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
        <path
          d="M16 34h16a8 8 0 100-16 1 1 0 01-1-1 9 9 0 00-17.5 1A7 7 0 0016 34z"
          stroke={ACCENT}
          strokeWidth={1.5}
          fill="none"
          opacity={0.6}
        />
        <path
          d="M24 28v-8m0 0l-3 3m3-3l3 3"
          stroke={ACCENT}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.8}
        />
      </svg>
    </div>
  );
}

function LinkIcon() {
  return (
    <div className="mt-4 text-center">
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
        <path
          d="M17 23a5 5 0 007.07 0l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"
          stroke={ACCENT}
          strokeWidth={1.5}
          strokeLinecap="round"
          opacity={0.7}
        />
        <path
          d="M23 17a5 5 0 00-7.07 0l-3 3a5 5 0 007.07 7.07l1.71-1.71"
          stroke={ACCENT}
          strokeWidth={1.5}
          strokeLinecap="round"
          opacity={0.7}
        />
      </svg>
    </div>
  );
}

function SpeechBubble() {
  return (
    <div className="mt-4 text-center">
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
        <path
          d="M8 12a4 4 0 014-4h16a4 4 0 014 4v10a4 4 0 01-4 4H16l-5 4v-4H8V12z"
          stroke={ACCENT}
          strokeWidth={1.5}
          fill="none"
          opacity={0.6}
        />
        <circle cx="15" cy="17" r="1.5" fill={ACCENT} opacity={0.5} />
        <circle cx="20" cy="17" r="1.5" fill={ACCENT} opacity={0.5} />
        <circle cx="25" cy="17" r="1.5" fill={ACCENT} opacity={0.5} />
      </svg>
    </div>
  );
}

function AdapterDots() {
  const names = AGENTS.slice(0, 10);
  return (
    <div className="mt-4 flex gap-2 flex-wrap items-center">
      {names.map((name) => (
        <span
          key={name}
          className="text-[11px] font-mono bg-[rgba(200,255,50,0.08)] text-[#c8ff32] px-2.5 py-1 rounded-md border border-[rgba(200,255,50,0.12)]"
        >
          {name}
        </span>
      ))}
      <span className="text-xs text-[#666]">+{AGENTS.length - 10} more</span>
    </div>
  );
}

function TechNodes() {
  return (
    <div className="mt-4 text-center">
      <svg width="60" height="60" viewBox="0 0 60 60" fill="none">
        <circle cx="30" cy="15" r="5" stroke={ACCENT} strokeWidth={1.5} opacity={0.6} />
        <circle cx="15" cy="45" r="5" stroke={ACCENT} strokeWidth={1.5} opacity={0.6} />
        <circle cx="45" cy="45" r="5" stroke={ACCENT} strokeWidth={1.5} opacity={0.6} />
        <line x1="30" y1="20" x2="15" y2="40" stroke={ACCENT} strokeWidth={1} opacity={0.3} />
        <line x1="30" y1="20" x2="45" y2="40" stroke={ACCENT} strokeWidth={1} opacity={0.3} />
        <line x1="15" y1="45" x2="45" y2="45" stroke={ACCENT} strokeWidth={1} opacity={0.15} />
      </svg>
    </div>
  );
}

function NotificationDot() {
  return (
    <div className="mt-4 text-center">
      <style>{`
        @keyframes d3-pulse {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.3); }
        }
      `}</style>
      <div className="relative inline-block">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
          <rect
            x="6"
            y="8"
            width="28"
            height="24"
            rx="4"
            stroke={ACCENT}
            strokeWidth={1.5}
            opacity={0.4}
          />
          <line
            x1="10"
            y1="16"
            x2="24"
            y2="16"
            stroke="rgba(255,255,255,0.15)"
            strokeWidth={2}
            strokeLinecap="round"
          />
          <line
            x1="10"
            y1="22"
            x2="20"
            y2="22"
            stroke="rgba(255,255,255,0.1)"
            strokeWidth={2}
            strokeLinecap="round"
          />
        </svg>
        <div
          className="absolute top-1 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#c8ff32]"
          style={{ animation: 'd3-pulse 2s ease infinite' }}
        />
      </div>
    </div>
  );
}

function EditorMockup() {
  return (
    <div className="mt-4 bg-[rgba(255,255,255,0.03)] rounded-[10px] p-4 font-mono text-xs leading-[1.7] text-[#666]">
      <div>
        <span className="text-[#c8ff32] opacity-60"># </span>
        <span className="text-white opacity-70">New Plan</span>
      </div>
      <div className="opacity-40">
        <span className="text-[#c8ff32] opacity-60">- </span>
        Refactor auth module
      </div>
      <div className="opacity-30">
        <span className="text-[#c8ff32] opacity-60">- </span>
        Add rate limiting
      </div>
      <div
        className="inline-block w-0.5 h-3.5 bg-[#c8ff32] opacity-60 ml-0.5"
        style={{ animation: 'd3-pulse 1s ease infinite' }}
      />
    </div>
  );
}

const CARD_VISUALS: Record<number, () => React.ReactNode> = {
  0: () => <IndexingViz />,
  1: () => <LinkIcon />,
  2: () => <SpeechBubble />,
  3: () => <CloudIcon />,
  4: () => <SearchMockup />,
  5: () => <AdapterDots />,
  6: () => <TechNodes />,
  7: () => <NotificationDot />,
  8: () => <EditorMockup />,
};

function BentoCard({
  feature,
  layout,
  index,
  inView,
}: {
  feature: (typeof FEATURES)[number];
  layout: (typeof BENTO_MAP)[number];
  index: number;
  inView?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const delay = index * 0.07;
  return (
    <div
      className={`d3-bento-card${inView ? ' d3-bento-active' : ''} relative rounded-[20px] p-px cursor-default`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        gridColumn: `span ${layout.colSpan}`,
        gridRow: `span ${layout.rowSpan}`,
        transition: 'transform 0.35s cubic-bezier(0.22,1,0.36,1), box-shadow 0.4s ease',
        transform: hovered ? 'translateY(-4px)' : 'none',
        boxShadow: hovered
          ? '0 0 30px rgba(200,255,50,0.08), 0 8px 32px rgba(0,0,0,0.4)'
          : '0 2px 8px rgba(0,0,0,0.2)',
        opacity: inView ? 1 : 0,
        animationDelay: `${delay}s`,
      }}
    >
      <div className="bg-[#0a0a0a] rounded-[19px] p-9 h-full transition-[background] duration-400 overflow-hidden">
        <div
          className="w-[42px] h-[42px] rounded-xl border border-[rgba(200,255,50,0.1)] flex items-center justify-center text-lg transition-[background,border-color] duration-300"
          style={{
            background: hovered ? 'rgba(200,255,50,0.12)' : 'rgba(200,255,50,0.06)',
          }}
        >
          {feature.icon}
        </div>
        <h3 className="mt-4 mb-2 text-lg font-semibold text-white font-[Inter,-apple-system,system-ui,sans-serif]">
          {feature.title}
        </h3>
        <p className="m-0 text-sm leading-relaxed text-[#999] font-[Inter,-apple-system,system-ui,sans-serif] font-normal">
          {feature.desc}
        </p>
        {inView && CARD_VISUALS[index]?.()}
      </div>
    </div>
  );
}

function PricingToggle({ yearly, onChange }: { yearly: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="inline-flex max-w-full flex-wrap justify-center bg-[#141414] border border-[rgba(255,255,255,0.06)] rounded-[30px] p-1 gap-0.5">
      {(['Monthly', 'Yearly'] as const).map((label) => {
        const active = label === 'Yearly' ? yearly : !yearly;
        return (
          <button
            key={label}
            onClick={() => onChange(label === 'Yearly')}
            className="px-4 sm:px-5 py-2 rounded-[26px] border-none text-[13px] font-medium font-[Inter,-apple-system,system-ui,sans-serif] cursor-pointer transition-[background,color] duration-200"
            style={{
              background: active ? ACCENT : 'transparent',
              color: active ? '#0a0a0a' : TEXT_SECONDARY,
            }}
          >
            {label}
            {label === 'Yearly' && <span className="text-[11px] ml-1 opacity-70">Save 17%</span>}
          </button>
        );
      })}
    </div>
  );
}

function PricingCard({
  title,
  price,
  period,
  features,
  isPro,
  cta,
  onCta,
  loading,
  ctaButtons,
}: {
  title: string;
  price: string;
  period: string;
  features: string[];
  isPro?: boolean;
  cta: string;
  onCta?: () => void;
  loading?: boolean;
  ctaButtons?: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="flex-1 bg-[#141414] rounded-[20px] p-6 sm:p-8 md:p-10 relative overflow-hidden transition-[transform,border-color] duration-300"
      style={{
        border: `1px solid ${isPro ? 'rgba(200,255,50,0.25)' : BORDER}`,
        transform: hovered ? 'translateY(-2px)' : 'none',
      }}
    >
      {isPro && (
        <div
          className="absolute top-0 left-0 right-0 h-0.5"
          style={{
            background: `linear-gradient(90deg, transparent, ${ACCENT}, transparent)`,
          }}
        />
      )}
      <div
        className="text-sm font-medium font-[Inter,-apple-system,system-ui,sans-serif] mb-4 uppercase tracking-[1px]"
        style={{ color: isPro ? ACCENT : TEXT_SECONDARY }}
      >
        {title}
      </div>
      <div className="flex items-baseline gap-1 mb-2">
        <span className="text-[40px] sm:text-[44px] md:text-[48px] font-normal text-white font-[Unbounded,sans-serif] tracking-[-0.03em]">
          {price}
        </span>
        {period && (
          <span className="text-sm text-[#666] font-[Inter,-apple-system,system-ui,sans-serif]">
            {period}
          </span>
        )}
      </div>
      <ul className="list-none p-0 mt-7 mb-9 flex flex-col gap-3">
        {features.map((f) => (
          <li
            key={f}
            className="text-sm text-[#999] font-[Inter,-apple-system,system-ui,sans-serif] flex items-center gap-2.5"
          >
            <span className="text-[#c8ff32] text-sm">{'✓'}</span>
            {f}
          </li>
        ))}
      </ul>
      {ctaButtons || (
        <button
          disabled={loading}
          onClick={onCta}
          className="w-full py-3.5 rounded-xl text-[15px] font-semibold font-[Inter,-apple-system,system-ui,sans-serif] flex items-center justify-center gap-2 transition-opacity duration-200"
          style={{
            border: isPro ? 'none' : `1px solid ${BORDER}`,
            background: isPro ? ACCENT : 'transparent',
            color: isPro ? '#0a0a0a' : TEXT_PRIMARY,
            cursor: loading ? 'default' : 'pointer',
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading && <Spinner size={15} color={isPro ? '#0a0a0a' : undefined} />}
          {loading ? 'Redirecting…' : cta}
        </button>
      )}
    </div>
  );
}

function GuaranteePanel() {
  return (
    <div className="d3-guarantee-panel mt-4 mb-7 flex flex-col items-center gap-1.5">
      <div className="text-[13px] font-medium tracking-[-0.01em] text-[rgba(255,255,255,0.82)] text-center">
        {MONEY_BACK_GUARANTEE.label}
      </div>
      <p className="d3-guarantee-copy m-0 max-w-[460px] text-center text-[12.5px] leading-[1.6] text-[#666]">
        {MONEY_BACK_GUARANTEE.body}
      </p>
    </div>
  );
}

function LoginModal({
  tokenValue,
  onTokenChange,
  onSubmit,
  onClose,
}: {
  tokenValue: string;
  onTokenChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-[rgba(0,0,0,0.7)] backdrop-blur-[8px] p-4 sm:p-5"
      onClick={(e) => {
        if (e.target === e.currentTarget) startViewTransition(onClose);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') startViewTransition(onClose);
      }}
    >
      <div className="bg-[#141414] border border-[rgba(255,255,255,0.06)] rounded-[20px] p-6 sm:p-8 md:p-10 w-full max-w-[420px]">
        <h2 className="m-0 mb-2 text-2xl font-semibold text-white font-[Inter,-apple-system,system-ui,sans-serif]">
          Connect to Agendex
        </h2>
        <p className="m-0 mb-7 text-sm text-[#999] font-[Inter,-apple-system,system-ui,sans-serif] leading-normal">
          Paste the auth token from your terminal to connect.
        </p>
        <form onSubmit={onSubmit}>
          <input
            type="password"
            value={tokenValue}
            onChange={(e) => onTokenChange(e.target.value)}
            placeholder="Paste your token"
            className="w-full px-4 py-3.5 rounded-xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.04)] text-white text-sm font-mono outline-none box-border transition-[border-color] duration-200"
            onFocus={(e) => {
              e.currentTarget.style.borderColor = 'rgba(200,255,50,0.4)';
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = BORDER;
            }}
          />
          <button
            type="submit"
            className="w-full py-3.5 mt-4 rounded-xl border-none bg-[#c8ff32] text-[#0a0a0a] text-[15px] font-semibold font-[Inter,-apple-system,system-ui,sans-serif] cursor-pointer transition-opacity duration-200"
          >
            Connect
          </button>
        </form>
        <button
          onClick={onClose}
          className="w-full py-3 mt-2 rounded-xl border-none bg-transparent text-[#666] text-sm font-[Inter,-apple-system,system-ui,sans-serif] cursor-pointer"
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
    <div className="landing-pkg-install">
      <div className="landing-pkg-tabs">
        {PKG_MANAGERS.map((pm) => (
          <button
            key={pm.id}
            type="button"
            className={`landing-pkg-tab ${activePkg === pm.id ? 'landing-pkg-tab-active' : ''}`}
            onClick={() => setActivePkg(pm.id)}
          >
            {pm.label}
          </button>
        ))}
      </div>
      <div className="landing-pkg-cmd">
        <code>{cmd}</code>
        <button type="button" className="landing-pkg-copy" onClick={copy} aria-label="Copy command">
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
        <div key={step.number} className="landing-step-block">
          <div className="landing-step-bar">
            {step.number} — {step.title.toUpperCase()}
          </div>
          {'hasPkgManager' in step && step.hasPkgManager ? (
            <PkgManagerInstall />
          ) : (
            <pre className="landing-step-code">
              <code>{step.code}</code>
            </pre>
          )}
        </div>
      ))}
    </>
  );
}

function AnimatedSteps({ activeTab }: { activeTab: 'local' | 'cloud' }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevHeightRef = useRef(0);
  const prevTab = useRef(activeTab);

  if (containerRef.current) {
    prevHeightRef.current = containerRef.current.offsetHeight;
  }

  useLayoutEffect(() => {
    if (prevTab.current === activeTab) return;
    prevTab.current = activeTab;

    const el = containerRef.current;
    if (!el) return;

    const startHeight = prevHeightRef.current;
    const endHeight = el.offsetHeight;
    if (startHeight === endHeight) return;

    el.style.overflow = 'hidden';
    el.style.height = `${startHeight}px`;

    requestAnimationFrame(() => {
      el.style.transition = 'height 0.3s ease';
      el.style.height = `${endHeight}px`;

      const onEnd = () => {
        el.style.height = '';
        el.style.transition = '';
        el.style.overflow = '';
        el.removeEventListener('transitionend', onEnd);
      };
      el.addEventListener('transitionend', onEnd);
    });
  }, [activeTab]);

  return (
    <div ref={containerRef} className="flex flex-col gap-3">
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
      className="landing-auth-button text-[13px] px-5 py-2 rounded-lg border border-[rgba(255,255,255,0.06)] bg-transparent text-white font-medium font-[Inter,-apple-system,system-ui,sans-serif] transition-[border-color] duration-200 inline-flex items-center justify-center gap-1.5"
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
    <nav className="fixed top-0 left-0 right-0 z-[100] border-b border-[rgba(255,255,255,0.06)] bg-[rgba(10,10,10,0.85)] backdrop-blur-[8px]">
      <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
        <div className="flex min-w-0 items-center gap-4 sm:gap-7">
          <a
            href="#overview"
            onClick={onMobileMenuClose}
            className="shrink-0 font-[Unbounded,sans-serif] text-[15px] font-medium text-white tracking-[-0.02em] no-underline sm:text-base"
          >
            Agendex<span style={{ color: '#c8ff32' }}>.</span>
          </a>
          <div className="landing-nav-links hidden items-center gap-[18px] md:flex">
            {LANDING_SECTIONS.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className="text-[13px] text-[#666] no-underline font-medium tracking-[-0.01em] transition-colors duration-200 hover:text-white"
              >
                {section.label}
              </a>
            ))}
          </div>
        </div>

        <div className="hidden shrink-0 md:block">{authAction}</div>

        <button
          type="button"
          aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={mobileMenuOpen}
          aria-controls="landing-mobile-menu"
          onClick={onMobileMenuToggle}
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] text-white transition-[border-color,background-color] duration-200 md:hidden"
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
        className={`border-t border-[rgba(255,255,255,0.06)] px-4 py-4 md:hidden ${
          mobileMenuOpen ? 'block' : 'hidden'
        }`}
      >
        <div className="mx-auto flex max-w-[1200px] flex-col gap-3">
          {LANDING_SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              onClick={onMobileMenuClose}
              className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-4 py-3 text-[14px] font-medium text-white no-underline transition-[border-color,background-color] duration-200"
            >
              {section.label}
            </a>
          ))}
          <div className="landing-mobile-auth pt-1">{authSlot ? authSlot() : authAction}</div>
        </div>
      </div>
    </nav>
  );
}

function LandingFooter() {
  return (
    <footer className="flex flex-col items-center gap-3 border-t border-[rgba(255,255,255,0.06)] bg-[rgba(10,10,10,0.85)] px-4 py-5 text-center text-[13px] text-[#666] backdrop-blur-[8px] sm:px-6 md:flex-row md:justify-between md:gap-6 md:text-left">
      <span className="md:flex-1">© {new Date().getFullYear()} Agendex</span>
      <span className="md:flex-1 md:text-center">
        Made With ❤️ by{' '}
        <a
          href="https://tiru5.me"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:opacity-80 transition-opacity"
        >
          Tyrus Malmstrom
        </a>
      </span>
      <span className="md:flex-1 md:text-right">
        <a
          href="https://github.com/tiru5/agendex"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[13px] px-5 py-2 rounded-lg border border-[rgba(255,255,255,0.06)] bg-transparent text-white cursor-pointer font-medium font-[Inter,-apple-system,system-ui,sans-serif] transition-[border-color] duration-200 no-underline inline-flex items-center justify-center gap-2"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
          </svg>
          View on GitHub
        </a>
      </span>
    </footer>
  );
}

const GitHubIcon16 = () => <GitHubIcon />;
const GoogleIcon16 = () => <GoogleIcon />;

function LandingHero({
  activeTab,
  agentIconImages,
  onShowLogin,
  onSetActiveTab,
  ctaSlot,
}: {
  activeTab: 'local' | 'cloud';
  agentIconImages: string[];
  onShowLogin: () => void;
  onSetActiveTab: (v: 'local' | 'cloud') => void;
  ctaSlot?: ReactNode;
}) {
  return (
    <div className="relative overflow-hidden">
      <FAQBackground />
      <section
        id="overview"
        className="d3-hero relative grid grid-cols-1 items-center max-w-[1100px] mx-auto px-4 sm:px-6 md:grid-cols-2"
        style={{
          gap: 64,
          padding: 'calc(52px + clamp(80px, 15vh, 160px)) 24px clamp(60px, 10vh, 100px)',
          scrollMarginTop: LANDING_ANCHOR_OFFSET,
        }}
      >
        <div className="landing-hero-cloud absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.15]">
          <IconCloud images={agentIconImages} />
        </div>
        <div className="relative z-[1] text-center md:text-left">
          <div className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-[20px] bg-[rgba(200,255,50,0.08)] border border-[rgba(200,255,50,0.15)] text-[13px] font-medium text-[#c8ff32] mb-6 sm:mb-8">
            <span className="text-[8px] leading-none">{'●'}</span>
            Open Source
          </div>

          <h1 className="text-balance font-[Unbounded,sans-serif] text-[clamp(32px,10vw,56px)] font-normal leading-[1.08] tracking-[-0.03em] m-0 mb-5 text-white">
            One dashboard for
            <br />
            <span className="text-[#c8ff32]">every coding agent.</span>
          </h1>

          <p className="text-pretty text-[15px] leading-[1.7] text-[#777] m-0 mb-8 font-normal max-w-[440px] mx-auto md:mx-0">
            Agendex indexes the plans your AI agents create and surfaces them in a single,
            searchable interface.
          </p>

          <div className="landing-hero-actions flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:justify-center md:justify-start">
            {ctaSlot || (
              <button
                onClick={onShowLogin}
                className="landing-hero-action inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-xl border-none bg-[#c8ff32] px-7 py-3 text-[15px] font-semibold text-[#0a0a0a] cursor-pointer transition-[opacity,transform] duration-200 sm:w-auto"
              >
                Get Started
              </button>
            )}
            <a
              href="https://github.com/Tyru5/agendex"
              target="_blank"
              rel="noopener noreferrer"
              className="landing-hero-action inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-[rgba(255,255,255,0.06)] bg-transparent px-7 py-3 text-[15px] font-medium text-white cursor-pointer no-underline transition-[border-color] duration-200 sm:w-auto"
            >
              <GitHubIcon16 />
              View on GitHub
            </a>
          </div>
        </div>

        <div className="relative z-[1]">
          <div className="landing-steps-panel">
            <div className="landing-steps-tabs">
              <button
                type="button"
                className={`landing-steps-tab ${activeTab === 'local' ? 'landing-steps-tab-active' : ''}`}
                onClick={() => onSetActiveTab('local')}
              >
                Self-Hosted
              </button>
              <button
                type="button"
                className={`landing-steps-tab ${activeTab === 'cloud' ? 'landing-steps-tab-active' : ''}`}
                onClick={() => onSetActiveTab('cloud')}
              >
                Cloud
              </button>
            </div>
            <AnimatedSteps activeTab={activeTab} />
          </div>
        </div>
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
      className="max-w-[880px] mx-auto px-6"
      style={{
        padding: 'clamp(60px, 10vh, 120px) 24px',
        scrollMarginTop: LANDING_ANCHOR_OFFSET,
      }}
    >
      <div className="text-center mb-12">
        <h2 className="font-[Unbounded,sans-serif] text-[clamp(28px,4vw,40px)] font-normal tracking-[-0.025em] m-0 mb-3">
          Simple pricing. Run it your way.
        </h2>
        <p className="text-base text-[#999] m-0 mb-7 font-normal">
          Free forever for local use. Upgrade for cloud features.
        </p>
        <PricingToggle yearly={yearly} onChange={onSetYearly} />
        <GuaranteePanel />
      </div>
      <div className="d3-pricing-row flex gap-4 items-stretch">
        <PricingCard
          title="Self-Hosted"
          price="$0"
          period=""
          features={FREE_FEATURES}
          cta="Get Started"
          onCta={onShowLogin}
        />
        <PricingCard
          title="Pro"
          price={yearly ? '$69' : '$7'}
          period={yearly ? '/year' : '/month'}
          features={PRO_FEATURES}
          isPro
          cta="Start Free Trial"
          onCta={proCtaSlot ? undefined : onShowLogin}
          loading={!proCtaSlot ? signingIn : undefined}
          ctaButtons={proCtaSlot}
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
      className="max-w-[720px] mx-auto px-6"
      style={{
        padding: 'clamp(40px, 8vh, 80px) 24px clamp(80px, 12vh, 140px)',
        scrollMarginTop: LANDING_ANCHOR_OFFSET,
      }}
    >
      <div className="text-center mb-12">
        <span className="inline-block text-xs font-semibold tracking-[0.1em] uppercase text-[#c8ff32] font-[Inter,-apple-system,system-ui,sans-serif] mb-3">
          Support
        </span>
        <h2 className="font-[Unbounded,sans-serif] text-[clamp(28px,4vw,40px)] font-normal tracking-[-0.025em] m-0">
          Frequently asked questions
        </h2>
      </div>
      <div className="flex flex-col">
        {FAQ_ITEMS.map((item, i) => (
          <FAQItem
            key={item.q}
            question={item.q}
            answer={item.a}
            open={openFaq === i}
            onToggle={() => onSetOpenFaq(openFaq === i ? null : i)}
            isFirst={i === 0}
          />
        ))}
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
  const { token, showLogin, yearly, openFaq, activeTab, bentoInView, signingIn } = state;
  const setTokenValue = (v: string) => dispatch({ type: 'SET_TOKEN', value: v });
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
    const threshold = window.innerWidth < 768 ? 0.1 : 0.6;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          dispatch({ type: 'SET_BENTO_IN_VIEW' });
          observer.disconnect();
        }
      },
      { threshold },
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
    const sections = ids.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    if (!sections.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort(
            (a, b) =>
              Math.abs(a.boundingClientRect.top - LANDING_ANCHOR_OFFSET) -
              Math.abs(b.boundingClientRect.top - LANDING_ANCHOR_OFFSET),
          );

        const nextId = visible[0]?.target.id;
        if (!nextId) return;

        const url = new URL(window.location.href);
        url.hash = nextId === 'overview' ? '' : nextId;
        const next = `${url.pathname}${url.search}${url.hash}`;
        const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;

        if (next !== current) {
          window.history.replaceState(window.history.state, '', next);
        }
      },
      {
        rootMargin: `-${LANDING_ANCHOR_OFFSET}px 0px -55% 0px`,
        threshold: [0, 0.25, 0.6],
      },
    );

    for (const section of sections) observer.observe(section);

    return () => observer.disconnect();
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (token.trim()) {
      setToken(token.trim());
      window.location.reload();
    }
  }

  const agentIconImages = AGENT_ICON_IMAGES;

  return (
    <LandingContext.Provider value={ctxValue}>
      <div className="landing-page min-h-screen bg-[#0a0a0a] text-white font-[Inter,-apple-system,system-ui,sans-serif] overflow-x-hidden">
        <TopoNeurons />
        <style>{`
          @media (max-width: 768px) {
            .d3-hero {
              grid-template-columns: 1fr !important;
              text-align: center;
            }
            .d3-bento-grid {
              grid-template-columns: 1fr !important;
            }
            .d3-bento-grid > div {
              grid-column: span 1 !important;
            }
            .d3-pricing-row {
              flex-direction: column !important;
            }
            .d3-guarantee-panel {
              flex-direction: column;
            }
            .d3-guarantee-copy {
              width: 100%;
            }
            .landing-hero-cloud {
              opacity: 0.08 !important;
              transform: scale(0.82);
            }
            .d3-bento-card {
              transform: none !important;
            }
            .d3-bento-card > div {
              padding: 1.4rem !important;
            }
          }
          @property --border-angle {
            syntax: '<angle>';
            initial-value: 0deg;
            inherits: false;
          }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
          @keyframes d3-bento-enter {
            from { opacity: 0; transform: translateY(24px); }
            to { opacity: 1; transform: translateY(0); }
          }
          @keyframes d3-border-spin {
            to { --border-angle: 360deg; }
          }
          .d3-bento-card {
            --border-angle: 0deg;
            background: ${BORDER};
          }
          .d3-bento-card.d3-bento-active {
            animation: d3-bento-enter 0.5s ease both;
          }
          .d3-bento-card.d3-bento-active:hover {
            background: conic-gradient(
              from var(--border-angle),
              transparent 30%,
              rgba(200,255,50,0.5) 50%,
              transparent 70%
            );
            animation: d3-bento-enter 0.5s ease both, d3-border-spin 4s linear infinite;
          }
        `}</style>

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
          agentIconImages={agentIconImages}
          onShowLogin={() => startViewTransition(() => setShowLogin(true))}
          onSetActiveTab={setActiveTab}
          ctaSlot={heroCtaNode}
        />

        {/* Bento Feature Grid */}
        <section
          id="features"
          ref={bentoRef}
          className="max-w-[1100px] mx-auto px-4 sm:px-6"
          style={{
            padding: 'clamp(60px, 10vh, 120px) 24px',
            scrollMarginTop: LANDING_ANCHOR_OFFSET,
          }}
        >
          <div className="text-center mb-10 sm:mb-14">
            <h2 className="font-[Unbounded,sans-serif] text-[clamp(28px,4vw,40px)] font-normal tracking-[-0.025em] m-0 mb-3">
              Everything you need
            </h2>
            <p className="text-base text-[#999] m-0 font-normal">
              A complete toolkit for managing AI agent plans.
            </p>
          </div>

          <div className="d3-bento-grid grid grid-cols-[repeat(4,1fr)] grid-rows-[auto] gap-4">
            {FEATURES.map((feature, i) => (
              <BentoCard
                key={feature.title}
                feature={feature}
                layout={BENTO_MAP[i] ?? { colSpan: 1, rowSpan: 1 }}
                index={i}
                inView={bentoInView}
              />
            ))}
          </div>
        </section>

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
            onTokenChange={setTokenValue}
            onSubmit={submit}
            onClose={() => startViewTransition(() => setShowLogin(false))}
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
  question,
  answer,
  open,
  onToggle,
  isFirst,
}: {
  question: string;
  answer: string;
  open: boolean;
  onToggle: () => void;
  isFirst: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className="border-b border-[rgba(255,255,255,0.06)]"
      style={{
        borderTop: isFirst ? `1px solid ${BORDER}` : 'none',
      }}
    >
      <button
        onClick={onToggle}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        aria-expanded={open}
        className="w-full px-1 py-[22px] bg-none border-none text-[15px] font-medium font-[Inter,-apple-system,system-ui,sans-serif] text-left cursor-pointer flex justify-between items-start gap-4 transition-colors duration-200"
        style={{
          color: hovered || open ? TEXT_PRIMARY : 'rgba(255,255,255,0.85)',
        }}
      >
        <span className="text-pretty leading-[1.5]">{question}</span>
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
          style={{
            border: `1px solid ${open ? ACCENT : hovered ? 'rgba(255,255,255,0.2)' : BORDER}`,
            transition:
              'border-color 0.3s cubic-bezier(0.4, 0, 0.2, 1), background 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
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
              stroke={open ? '#000' : TEXT_MUTED}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
        style={{
          gridTemplateRows: open ? '1fr' : '0fr',
        }}
      >
        <div className="overflow-hidden">
          <p
            className="px-1 pb-[22px] m-0 text-sm leading-[1.75] text-[#999] font-[Inter,-apple-system,system-ui,sans-serif] max-w-[580px]"
            style={{
              opacity: open ? 1 : 0,
              transform: open ? 'translateY(0)' : 'translateY(-4px)',
              transition: 'opacity 0.25s 0.05s, transform 0.25s 0.05s',
            }}
          >
            {answer}
          </p>
        </div>
      </div>
    </div>
  );
}
