import { useMemo, useState } from 'react';
import {
  AGENTS,
  FEATURES,
  FAQ_ITEMS,
  FREE_FEATURES,
  PRO_FEATURES,
  LOCAL_STEPS,
  CLOUD_STEPS,
  PKG_MANAGERS,
  setToken,
} from './landing/data.ts';
import { IconCloud } from './landing/IconCloud.tsx';
import { startViewTransition } from '../lib/view-transition.ts';

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
const BORDER_HOVER = 'rgba(255,255,255,0.12)';
const TEXT_PRIMARY = '#ffffff';
const TEXT_SECONDARY = '#999';
const TEXT_MUTED = '#666';
const RADIUS = 20;
const CARD_PAD = 36;

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
    <div style={{ position: 'relative', height: 80, marginTop: 16 }}>
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
            <g key={i}>
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
    <div
      style={{
        marginTop: 16,
        background: 'rgba(255,255,255,0.04)',
        borderRadius: 10,
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 13,
        color: TEXT_MUTED,
        fontFamily: '"SF Mono", "Fira Code", monospace',
      }}
    >
      <span style={{ opacity: 0.5 }}>{'>'}</span>
      <span>search plans...</span>
      <span
        style={{
          marginLeft: 'auto',
          fontSize: 11,
          background: 'rgba(255,255,255,0.06)',
          padding: '2px 6px',
          borderRadius: 4,
        }}
      >
        ⌘K
      </span>
    </div>
  );
}

function CloudIcon() {
  return (
    <div style={{ marginTop: 16, textAlign: 'center' }}>
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
    <div style={{ marginTop: 16, textAlign: 'center' }}>
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
    <div style={{ marginTop: 16, textAlign: 'center' }}>
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
    <div
      style={{
        marginTop: 16,
        display: 'flex',
        gap: 8,
        flexWrap: 'wrap',
        alignItems: 'center',
      }}
    >
      {names.map((name) => (
        <span
          key={name}
          style={{
            fontSize: 11,
            fontFamily: '"SF Mono", "Fira Code", monospace',
            background: 'rgba(200,255,50,0.08)',
            color: ACCENT,
            padding: '4px 10px',
            borderRadius: 6,
            border: '1px solid rgba(200,255,50,0.12)',
          }}
        >
          {name}
        </span>
      ))}
      <span style={{ fontSize: 12, color: TEXT_MUTED }}>+{AGENTS.length - 10} more</span>
    </div>
  );
}

function TechNodes() {
  return (
    <div style={{ marginTop: 16, textAlign: 'center' }}>
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
    <div style={{ marginTop: 16, textAlign: 'center' }}>
      <style>{`
        @keyframes d3-pulse {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.3); }
        }
      `}</style>
      <div style={{ position: 'relative', display: 'inline-block' }}>
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
          style={{
            position: 'absolute',
            top: 4,
            right: -2,
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: ACCENT,
            animation: 'd3-pulse 2s ease infinite',
          }}
        />
      </div>
    </div>
  );
}

function EditorMockup() {
  return (
    <div
      style={{
        marginTop: 16,
        background: 'rgba(255,255,255,0.03)',
        borderRadius: 10,
        padding: 16,
        fontFamily: '"SF Mono", "Fira Code", monospace',
        fontSize: 12,
        lineHeight: 1.7,
        color: TEXT_MUTED,
      }}
    >
      <div>
        <span style={{ color: ACCENT, opacity: 0.6 }}># </span>
        <span style={{ color: TEXT_PRIMARY, opacity: 0.7 }}>New Plan</span>
      </div>
      <div style={{ opacity: 0.4 }}>
        <span style={{ color: ACCENT, opacity: 0.6 }}>- </span>
        Refactor auth module
      </div>
      <div style={{ opacity: 0.3 }}>
        <span style={{ color: ACCENT, opacity: 0.6 }}>- </span>
        Add rate limiting
      </div>
      <div
        style={{
          display: 'inline-block',
          width: 2,
          height: 14,
          background: ACCENT,
          opacity: 0.6,
          marginLeft: 2,
          animation: 'd3-pulse 1s ease infinite',
        }}
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
}: {
  feature: (typeof FEATURES)[number];
  layout: (typeof BENTO_MAP)[number];
  index: number;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        gridColumn: `span ${layout.colSpan}`,
        gridRow: `span ${layout.rowSpan}`,
        background: SURFACE,
        border: `1px solid ${hovered ? BORDER_HOVER : BORDER}`,
        borderRadius: RADIUS,
        padding: CARD_PAD,
        transition: 'all 0.3s ease',
        transform: hovered ? 'translateY(-2px)' : 'none',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          background: 'rgba(200,255,50,0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 18,
        }}
      >
        {feature.icon}
      </div>
      <h3
        style={{
          margin: '16px 0 8px',
          fontSize: 18,
          fontWeight: 600,
          color: TEXT_PRIMARY,
          fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
        }}
      >
        {feature.title}
      </h3>
      <p
        style={{
          margin: 0,
          fontSize: 14,
          lineHeight: 1.6,
          color: TEXT_SECONDARY,
          fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
          fontWeight: 400,
        }}
      >
        {feature.desc}
      </p>
      {CARD_VISUALS[index]?.()}
    </div>
  );
}

function PricingToggle({ yearly, onChange }: { yearly: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      style={{
        display: 'inline-flex',
        background: SURFACE,
        border: `1px solid ${BORDER}`,
        borderRadius: 30,
        padding: 4,
        gap: 2,
      }}
    >
      {(['Monthly', 'Yearly'] as const).map((label) => {
        const active = label === 'Yearly' ? yearly : !yearly;
        return (
          <button
            key={label}
            onClick={() => onChange(label === 'Yearly')}
            style={{
              padding: '8px 20px',
              borderRadius: 26,
              border: 'none',
              background: active ? ACCENT : 'transparent',
              color: active ? '#0a0a0a' : TEXT_SECONDARY,
              fontSize: 13,
              fontWeight: 500,
              fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            {label}
            {label === 'Yearly' && (
              <span style={{ fontSize: 11, marginLeft: 4, opacity: 0.7 }}>Save 17%</span>
            )}
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
}: {
  title: string;
  price: string;
  period: string;
  features: string[];
  isPro?: boolean;
  cta: string;
  onCta?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        flex: 1,
        background: SURFACE,
        border: `1px solid ${isPro ? 'rgba(200,255,50,0.25)' : BORDER}`,
        borderRadius: RADIUS,
        padding: 40,
        transition: 'all 0.3s ease',
        transform: hovered ? 'translateY(-2px)' : 'none',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {isPro && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            background: `linear-gradient(90deg, transparent, ${ACCENT}, transparent)`,
          }}
        />
      )}
      <div
        style={{
          fontSize: 14,
          fontWeight: 500,
          color: isPro ? ACCENT : TEXT_SECONDARY,
          fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
          marginBottom: 16,
          textTransform: 'uppercase',
          letterSpacing: 1,
        }}
      >
        {title}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 8 }}>
        <span
          style={{
            fontSize: 48,
            fontWeight: 400,
            color: TEXT_PRIMARY,
            fontFamily: '"Unbounded", sans-serif',
            letterSpacing: '-0.03em',
          }}
        >
          {price}
        </span>
        {period && (
          <span
            style={{
              fontSize: 14,
              color: TEXT_MUTED,
              fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
            }}
          >
            {period}
          </span>
        )}
      </div>
      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          margin: '28px 0 36px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {features.map((f) => (
          <li
            key={f}
            style={{
              fontSize: 14,
              color: TEXT_SECONDARY,
              fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <span style={{ color: ACCENT, fontSize: 14 }}>{'✓'}</span>
            {f}
          </li>
        ))}
      </ul>
      <button
        onClick={onCta}
        style={{
          width: '100%',
          padding: '14px 0',
          borderRadius: 12,
          border: isPro ? 'none' : `1px solid ${BORDER}`,
          background: isPro ? ACCENT : 'transparent',
          color: isPro ? '#0a0a0a' : TEXT_PRIMARY,
          fontSize: 15,
          fontWeight: 600,
          fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
          cursor: 'pointer',
          transition: 'opacity 0.2s',
        }}
      >
        {cta}
      </button>
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
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(8px)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) startViewTransition(onClose);
      }}
    >
      <div
        style={{
          background: SURFACE,
          border: `1px solid ${BORDER}`,
          borderRadius: RADIUS,
          padding: 40,
          width: '100%',
          maxWidth: 420,
          margin: '0 20px',
        }}
      >
        <h2
          style={{
            margin: '0 0 8px',
            fontSize: 24,
            fontWeight: 600,
            color: TEXT_PRIMARY,
            fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
          }}
        >
          Connect to Agendex
        </h2>
        <p
          style={{
            margin: '0 0 28px',
            fontSize: 14,
            color: TEXT_SECONDARY,
            fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
            lineHeight: 1.5,
          }}
        >
          Paste the auth token from your terminal to connect.
        </p>
        <form onSubmit={onSubmit}>
          <input
            type="password"
            value={tokenValue}
            onChange={(e) => onTokenChange(e.target.value)}
            placeholder="Paste your token"
            autoFocus
            style={{
              width: '100%',
              padding: '14px 16px',
              borderRadius: 12,
              border: `1px solid ${BORDER}`,
              background: 'rgba(255,255,255,0.04)',
              color: TEXT_PRIMARY,
              fontSize: 14,
              fontFamily: '"SF Mono", "Fira Code", monospace',
              outline: 'none',
              boxSizing: 'border-box',
              transition: 'border-color 0.2s',
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = 'rgba(200,255,50,0.4)';
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = BORDER;
            }}
          />
          <button
            type="submit"
            style={{
              width: '100%',
              padding: '14px 0',
              marginTop: 16,
              borderRadius: 12,
              border: 'none',
              background: ACCENT,
              color: '#0a0a0a',
              fontSize: 15,
              fontWeight: 600,
              fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
              cursor: 'pointer',
              transition: 'opacity 0.2s',
            }}
          >
            Connect
          </button>
        </form>
        <button
          onClick={onClose}
          style={{
            width: '100%',
            padding: '12px 0',
            marginTop: 8,
            borderRadius: 12,
            border: 'none',
            background: 'transparent',
            color: TEXT_MUTED,
            fontSize: 14,
            fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
            cursor: 'pointer',
          }}
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

export function LandingPage() {
  const [token, setTokenValue] = useState('');
  const [showLogin, setShowLogin] = useState(false);
  const [yearly, setYearly] = useState(true);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'local' | 'cloud'>('local');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (token.trim()) {
      setToken(token.trim());
      window.location.reload();
    }
  }

  const agentIconImages = useMemo(() => AGENT_ICON_IMAGES, []);

  return (
    <div
      className="landing-page"
      style={{
        minHeight: '100vh',
        backgroundColor: BG,
        backgroundImage: `linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)`,
        backgroundSize: '36px 36px',
        color: TEXT_PRIMARY,
        fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
        overflowX: 'hidden',
      }}
    >
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
        }
      `}</style>

      {/* Hero — two-column */}
      <section
        className="d3-hero"
        style={{
          position: 'relative',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 230,
          alignItems: 'center',
          maxWidth: 1100,
          margin: '0 auto',
          padding: 'clamp(80px, 15vh, 160px) 24px clamp(60px, 10vh, 100px)',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            opacity: 0.15,
          }}
        >
          <IconCloud images={agentIconImages} />
        </div>
        <div>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 16px',
              borderRadius: 20,
              background: 'rgba(200,255,50,0.08)',
              border: '1px solid rgba(200,255,50,0.15)',
              fontSize: 13,
              fontWeight: 500,
              color: ACCENT,
              marginBottom: 32,
            }}
          >
            <span style={{ fontSize: 8, lineHeight: 1 }}>{'●'}</span>
            Open Source
          </div>

          <h1
            style={{
              fontFamily: '"Unbounded", sans-serif',
              fontSize: 'clamp(36px, 4.5vw, 56px)',
              fontWeight: 400,
              lineHeight: 1.08,
              letterSpacing: '-0.03em',
              margin: '0 0 20px',
              color: TEXT_PRIMARY,
            }}
          >
            One dashboard for
            <br />
            <span style={{ color: ACCENT }}>every coding agent.</span>
          </h1>

          <p
            style={{
              fontSize: 15,
              lineHeight: 1.7,
              color: '#777',
              margin: '0 0 32px',
              fontWeight: 400,
              maxWidth: 440,
            }}
          >
            Agendex indexes the plans your AI agents create and surfaces them in a single,
            searchable interface.
          </p>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button
              onClick={() => startViewTransition(() => setShowLogin(true))}
              style={{
                padding: '14px 32px',
                borderRadius: 12,
                border: 'none',
                background: ACCENT,
                color: '#0a0a0a',
                fontSize: 15,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'opacity 0.2s',
              }}
            >
              Get Started
            </button>
            <a
              href="https://github.com/Tyru5/agendex"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                padding: '14px 32px',
                borderRadius: 12,
                border: `1px solid ${BORDER}`,
                background: 'transparent',
                color: TEXT_PRIMARY,
                fontSize: 15,
                fontWeight: 500,
                cursor: 'pointer',
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                transition: 'border-color 0.2s',
              }}
            >
              View on GitHub
            </a>
          </div>
        </div>

        <div>
          <div className="landing-steps-panel">
            <div className="landing-steps-tabs">
              <button
                type="button"
                className={`landing-steps-tab ${activeTab === 'local' ? 'landing-steps-tab-active' : ''}`}
                onClick={() => setActiveTab('local')}
              >
                Self-Hosted
              </button>
              <button
                type="button"
                className={`landing-steps-tab ${activeTab === 'cloud' ? 'landing-steps-tab-active' : ''}`}
                onClick={() => setActiveTab('cloud')}
              >
                Cloud
              </button>
            </div>
            {(activeTab === 'cloud' ? CLOUD_STEPS : LOCAL_STEPS).map((step) => (
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
          </div>
        </div>
      </section>

      {/* Bento Feature Grid */}
      <section
        style={{ padding: 'clamp(60px, 10vh, 120px) 24px', maxWidth: 1100, margin: '0 auto' }}
      >
        <div style={{ textAlign: 'center', marginBottom: 56 }}>
          <h2
            style={{
              fontFamily: '"Unbounded", sans-serif',
              fontSize: 'clamp(28px, 4vw, 40px)',
              fontWeight: 400,
              letterSpacing: '-0.025em',
              margin: '0 0 12px',
            }}
          >
            Everything you need
          </h2>
          <p style={{ fontSize: 16, color: TEXT_SECONDARY, margin: 0, fontWeight: 400 }}>
            A complete toolkit for managing AI agent plans.
          </p>
        </div>

        <div
          className="d3-bento-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gridTemplateRows: 'auto',
            gap: 16,
          }}
        >
          {FEATURES.map((feature, i) => (
            <BentoCard
              key={feature.title}
              feature={feature}
              layout={BENTO_MAP[i] ?? { colSpan: 1, rowSpan: 1 }}
              index={i}
            />
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section
        style={{
          padding: 'clamp(60px, 10vh, 120px) 24px',
          maxWidth: 880,
          margin: '0 auto',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <h2
            style={{
              fontFamily: '"Unbounded", sans-serif',
              fontSize: 'clamp(28px, 4vw, 40px)',
              fontWeight: 400,
              letterSpacing: '-0.025em',
              margin: '0 0 12px',
            }}
          >
            Simple pricing. Run it your way.
          </h2>
          <p style={{ fontSize: 16, color: TEXT_SECONDARY, margin: '0 0 28px', fontWeight: 400 }}>
            Free forever for local use. Upgrade for cloud features.
          </p>
          <PricingToggle yearly={yearly} onChange={setYearly} />
        </div>

        <div
          className="d3-pricing-row"
          style={{
            display: 'flex',
            gap: 16,
            alignItems: 'stretch',
          }}
        >
          <PricingCard
            title="Self-Hosted"
            price="$0"
            period=""
            features={FREE_FEATURES}
            cta="Get Started"
            onCta={() => startViewTransition(() => setShowLogin(true))}
          />
          <PricingCard
            title="Pro"
            price={yearly ? '$69' : '$7'}
            period={yearly ? '/year' : '/month'}
            features={PRO_FEATURES}
            isPro
            cta="Start Free Trial"
          />
        </div>
      </section>

      {/* FAQ */}
      <section
        style={{
          padding: 'clamp(40px, 8vh, 80px) 24px clamp(80px, 12vh, 140px)',
          maxWidth: 680,
          margin: '0 auto',
        }}
      >
        <h2
          style={{
            fontFamily: '"Unbounded", sans-serif',
            fontSize: 'clamp(28px, 4vw, 40px)',
            fontWeight: 400,
            letterSpacing: '-0.025em',
            margin: '0 0 40px',
            textAlign: 'center',
          }}
        >
          FAQ
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {FAQ_ITEMS.map((item, i) => (
            <FAQItem
              key={item.q}
              question={item.q}
              answer={item.a}
              open={openFaq === i}
              onToggle={() => setOpenFaq(openFaq === i ? null : i)}
            />
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer
        style={{
          borderTop: `1px solid ${BORDER}`,
          padding: '32px 24px',
          textAlign: 'center',
          fontSize: 13,
          color: TEXT_MUTED,
        }}
      >
        Agendex — Open source agent plan dashboard
      </footer>

      {/* Login Modal */}
      {showLogin && (
        <LoginModal
          tokenValue={token}
          onTokenChange={setTokenValue}
          onSubmit={submit}
          onClose={() => startViewTransition(() => setShowLogin(false))}
        />
      )}
    </div>
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
  return (
    <div
      style={{
        background: open ? SURFACE : 'transparent',
        border: `1px solid ${open ? BORDER : 'transparent'}`,
        borderRadius: 14,
        transition: 'all 0.2s ease',
      }}
    >
      <button
        onClick={onToggle}
        aria-expanded={open}
        style={{
          width: '100%',
          padding: '18px 20px',
          background: 'none',
          border: 'none',
          color: TEXT_PRIMARY,
          fontSize: 15,
          fontWeight: 500,
          fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
          textAlign: 'left',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 16,
        }}
      >
        {question}
        <span
          style={{
            color: TEXT_MUTED,
            fontSize: 18,
            transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            transform: open ? 'rotate(45deg)' : 'none',
            flexShrink: 0,
          }}
        >
          +
        </span>
      </button>
      <div
        style={{
          display: 'grid',
          gridTemplateRows: open ? '1fr' : '0fr',
          transition: 'grid-template-rows 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <div style={{ overflow: 'hidden' }}>
          <p
            style={{
              padding: '0 20px 18px',
              margin: 0,
              fontSize: 14,
              lineHeight: 1.7,
              color: TEXT_SECONDARY,
              fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
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
