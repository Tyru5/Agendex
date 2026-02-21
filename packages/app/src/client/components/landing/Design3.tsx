import { useState } from 'react';
import { AGENTS, FEATURES, FAQ_ITEMS, FREE_FEATURES, PRO_FEATURES, setToken } from './data.ts';

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
          fontFamily: 'Inter, -apple-system, sans-serif',
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
          fontFamily: 'Inter, -apple-system, sans-serif',
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
              fontFamily: 'Inter, -apple-system, sans-serif',
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
          fontFamily: 'Inter, -apple-system, sans-serif',
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
            fontWeight: 600,
            color: TEXT_PRIMARY,
            fontFamily: 'Inter, -apple-system, sans-serif',
            letterSpacing: -2,
          }}
        >
          {price}
        </span>
        {period && (
          <span
            style={{
              fontSize: 14,
              color: TEXT_MUTED,
              fontFamily: 'Inter, -apple-system, sans-serif',
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
              fontFamily: 'Inter, -apple-system, sans-serif',
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
          fontFamily: 'Inter, -apple-system, sans-serif',
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
        if (e.target === e.currentTarget) onClose();
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
            fontFamily: 'Inter, -apple-system, sans-serif',
          }}
        >
          Connect to Agendex
        </h2>
        <p
          style={{
            margin: '0 0 28px',
            fontSize: 14,
            color: TEXT_SECONDARY,
            fontFamily: 'Inter, -apple-system, sans-serif',
            lineHeight: 1.5,
          }}
        >
          Paste the auth token from your terminal to connect.
        </p>
        <form onSubmit={onSubmit}>
          <input
            type="text"
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
              fontFamily: 'Inter, -apple-system, sans-serif',
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
            fontFamily: 'Inter, -apple-system, sans-serif',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function Design3() {
  const [token, setTokenValue] = useState('');
  const [showLogin, setShowLogin] = useState(false);
  const [yearly, setYearly] = useState(true);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (token.trim()) {
      setToken(token.trim());
      window.location.reload();
    }
  }

  const agentsDoubled = [...AGENTS, ...AGENTS];

  return (
    <div
      style={{
        minHeight: '100vh',
        background: BG,
        color: TEXT_PRIMARY,
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
        overflowX: 'hidden',
      }}
    >
      <style>{`
        @keyframes d3-marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        @media (max-width: 768px) {
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

      {/* Hero */}
      <section
        style={{
          padding: 'clamp(80px, 15vh, 160px) 24px clamp(60px, 10vh, 100px)',
          textAlign: 'center',
          maxWidth: 800,
          margin: '0 auto',
        }}
      >
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
            fontSize: 'clamp(36px, 5vw, 56px)',
            fontWeight: 600,
            lineHeight: 1.1,
            letterSpacing: -1.5,
            margin: '0 0 20px',
            color: TEXT_PRIMARY,
          }}
        >
          One dashboard for
          <br />
          every coding agent.
        </h1>

        <p
          style={{
            fontSize: 'clamp(16px, 2vw, 19px)',
            lineHeight: 1.6,
            color: '#777',
            margin: '0 0 40px',
            fontWeight: 400,
            maxWidth: 520,
            marginLeft: 'auto',
            marginRight: 'auto',
          }}
        >
          Agendex indexes the plans your AI agents create and surfaces them in a single, searchable
          interface.
        </p>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => setShowLogin(true)}
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
      </section>

      {/* Agent Strip */}
      <section
        style={{
          background: 'rgba(255,255,255,0.02)',
          borderTop: `1px solid ${BORDER}`,
          borderBottom: `1px solid ${BORDER}`,
          padding: '20px 0',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            width: 'max-content',
            animation: 'd3-marquee 30s linear infinite',
          }}
        >
          {agentsDoubled.map((agent, i) => (
            <span
              key={`${agent}-${i}`}
              style={{
                fontFamily: '"SF Mono", "Fira Code", monospace',
                fontSize: 13,
                color: TEXT_MUTED,
                padding: '6px 20px',
                whiteSpace: 'nowrap',
              }}
            >
              {agent}
            </span>
          ))}
        </div>
      </section>

      {/* Bento Feature Grid */}
      <section
        style={{ padding: 'clamp(60px, 10vh, 120px) 24px', maxWidth: 1100, margin: '0 auto' }}
      >
        <div style={{ textAlign: 'center', marginBottom: 56 }}>
          <h2
            style={{
              fontSize: 'clamp(28px, 4vw, 40px)',
              fontWeight: 600,
              letterSpacing: -1,
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
              fontSize: 'clamp(28px, 4vw, 40px)',
              fontWeight: 600,
              letterSpacing: -1,
              margin: '0 0 12px',
            }}
          >
            Simple pricing
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
            onCta={() => setShowLogin(true)}
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
            fontSize: 'clamp(28px, 4vw, 40px)',
            fontWeight: 600,
            letterSpacing: -1,
            margin: '0 0 40px',
            textAlign: 'center',
          }}
        >
          FAQ
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {FAQ_ITEMS.map((item) => (
            <FAQItem key={item.q} question={item.q} answer={item.a} />
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
          onClose={() => setShowLogin(false)}
        />
      )}
    </div>
  );
}

function FAQItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
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
        onClick={() => setOpen(!open)}
        style={{
          width: '100%',
          padding: '18px 20px',
          background: 'none',
          border: 'none',
          color: TEXT_PRIMARY,
          fontSize: 15,
          fontWeight: 500,
          fontFamily: 'Inter, -apple-system, sans-serif',
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
            transition: 'transform 0.2s',
            transform: open ? 'rotate(45deg)' : 'none',
            flexShrink: 0,
          }}
        >
          +
        </span>
      </button>
      {open && (
        <div
          style={{
            padding: '0 20px 18px',
            fontSize: 14,
            lineHeight: 1.7,
            color: TEXT_SECONDARY,
            fontFamily: 'Inter, -apple-system, sans-serif',
          }}
        >
          {answer}
        </div>
      )}
    </div>
  );
}
