import { useState } from 'react';
import { AGENTS, FEATURES, FAQ_ITEMS, FREE_FEATURES, PRO_FEATURES, setToken } from './data.ts';

const GREEN = '#00ff41';
const DIM_GREEN = '#0a5f1c';
const BG = '#000000';
const MONO = '"SF Mono", "JetBrains Mono", "Fira Code", monospace';

const keyframes = `
@keyframes blink {
  0%, 49% { opacity: 1; }
  50%, 100% { opacity: 0; }
}
@keyframes scanline {
  0% { transform: translateY(-100%); }
  100% { transform: translateY(100%); }
}
@keyframes marquee {
  0% { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}
@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes typewriter {
  from { width: 0; }
  to { width: 100%; }
}
@keyframes glowPulse {
  0%, 100% { text-shadow: 0 0 4px #00ff4180, 0 0 8px #00ff4140; }
  50% { text-shadow: 0 0 8px #00ff41b0, 0 0 20px #00ff4160, 0 0 40px #00ff4130; }
}
`;

const Cursor = () => (
  <span
    style={{
      display: 'inline-block',
      width: '0.6em',
      height: '1.1em',
      backgroundColor: GREEN,
      animation: 'blink 1s step-end infinite',
      verticalAlign: 'text-bottom',
      marginLeft: 2,
    }}
  />
);

const Scanlines = () => (
  <div
    style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: 9999,
      background:
        'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,65,0.015) 2px, rgba(0,255,65,0.015) 4px)',
    }}
  >
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '200%',
        background: 'linear-gradient(transparent 0%, rgba(0,255,65,0.03) 50%, transparent 100%)',
        animation: 'scanline 8s linear infinite',
      }}
    />
  </div>
);

const TerminalWindow = ({
  title,
  children,
  style: extraStyle,
}: {
  title: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) => (
  <div
    style={{
      background: '#0a0a0a',
      border: `1px solid ${DIM_GREEN}`,
      borderRadius: 6,
      overflow: 'hidden',
      boxShadow: `0 0 30px ${DIM_GREEN}40, inset 0 0 60px rgba(0,0,0,0.5)`,
      ...extraStyle,
    }}
  >
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 16px',
        background: '#111',
        borderBottom: `1px solid ${DIM_GREEN}60`,
      }}
    >
      <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#ff5f57' }} />
      <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#febc2e' }} />
      <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#28c840' }} />
      <span
        style={{
          marginLeft: 12,
          color: '#666',
          fontFamily: MONO,
          fontSize: 12,
        }}
      >
        {title}
      </span>
    </div>
    <div style={{ padding: '24px 28px' }}>{children}</div>
  </div>
);

const PromptLine = ({
  command,
  dim,
  noPrompt,
}: {
  command: string;
  dim?: boolean;
  noPrompt?: boolean;
}) => (
  <div style={{ marginBottom: 4 }}>
    {!noPrompt && <span style={{ color: dim ? DIM_GREEN : GREEN, fontFamily: MONO }}>$ </span>}
    <span
      style={{
        color: dim ? '#555' : GREEN,
        fontFamily: MONO,
        fontSize: 'inherit',
      }}
    >
      {command}
    </span>
  </div>
);

export default function Design1() {
  const [token, setTokenValue] = useState('');
  const [showLogin, setShowLogin] = useState(false);
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (token.trim()) {
      setToken(token.trim());
      window.location.reload();
    }
  }

  const agentString = AGENTS.join(' │ ');
  const doubledAgents = `${agentString} │ ${agentString}`;

  return (
    <div
      style={{
        backgroundColor: BG,
        color: GREEN,
        fontFamily: MONO,
        minHeight: '100vh',
        overflowX: 'hidden',
        position: 'relative',
      }}
    >
      <style>{keyframes}</style>
      <Scanlines />

      {/* ── NAV ── */}
      <nav
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 1000,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '16px 40px',
          background: 'linear-gradient(180deg, #000000ee 0%, #000000cc 100%)',
          backdropFilter: 'blur(12px)',
          borderBottom: `1px solid ${DIM_GREEN}40`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: DIM_GREEN, fontSize: 14 }}>~$</span>
          <span
            style={{
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: 2,
              color: GREEN,
              animation: 'glowPulse 3s ease-in-out infinite',
            }}
          >
            AGENDEX
          </span>
        </div>
        <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
          {['features', 'pricing', 'faq'].map((s) => (
            <a
              key={s}
              href={`#${s}`}
              style={{
                color: DIM_GREEN,
                textDecoration: 'none',
                fontSize: 13,
                letterSpacing: 1,
                transition: 'color 0.2s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = GREEN)}
              onMouseLeave={(e) => (e.currentTarget.style.color = DIM_GREEN)}
            >
              /{s}
            </a>
          ))}
          <button
            onClick={() => setShowLogin(true)}
            style={{
              background: 'transparent',
              border: `1px solid ${GREEN}`,
              color: GREEN,
              fontFamily: MONO,
              fontSize: 12,
              padding: '6px 16px',
              cursor: 'pointer',
              letterSpacing: 1,
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = GREEN;
              e.currentTarget.style.color = BG;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = GREEN;
            }}
          >
            [LOGIN]
          </button>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '120px 24px 80px',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 600,
            height: 600,
            background: `radial-gradient(circle, ${DIM_GREEN}15 0%, transparent 70%)`,
            pointerEvents: 'none',
          }}
        />

        <TerminalWindow
          title="agendex — bash — 80x24"
          style={{ maxWidth: 720, width: '100%', animation: 'fadeInUp 0.8s ease-out' }}
        >
          <div style={{ fontSize: 14, lineHeight: 1.8 }}>
            <PromptLine command="agendex --info" />
            <div style={{ marginTop: 12, marginBottom: 4 }}>
              <span style={{ color: GREEN, fontWeight: 700, fontSize: 20, letterSpacing: 3 }}>
                AGENDEX
              </span>
              <span style={{ color: DIM_GREEN, fontSize: 13, marginLeft: 12 }}>v1.0</span>
            </div>
            <div style={{ color: '#ccc', fontSize: 15, marginBottom: 4, fontFamily: MONO }}>
              One dashboard for every coding agent.
            </div>
            <div style={{ color: '#777', fontSize: 13, marginBottom: 16, fontFamily: MONO }}>
              Indexes plans from {AGENTS.length}+ AI coding agents into a single interface.
            </div>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span style={{ color: GREEN }}>$ </span>
              <Cursor />
            </div>
          </div>
        </TerminalWindow>

        <div
          style={{
            display: 'flex',
            gap: 16,
            marginTop: 40,
            animation: 'fadeInUp 0.8s ease-out 0.3s both',
          }}
        >
          <a
            href="https://github.com/Tyru5/agendex"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-block',
              padding: '12px 32px',
              background: GREEN,
              color: BG,
              fontFamily: MONO,
              fontSize: 14,
              fontWeight: 700,
              textDecoration: 'none',
              letterSpacing: 1,
              cursor: 'pointer',
              transition: 'all 0.2s',
              border: 'none',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow = `0 0 20px ${GREEN}60, 0 0 40px ${GREEN}30`;
              e.currentTarget.style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = 'none';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            [GET STARTED]
          </a>
          <a
            href="https://github.com/Tyru5/agendex"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-block',
              padding: '12px 32px',
              background: 'transparent',
              color: GREEN,
              fontFamily: MONO,
              fontSize: 14,
              fontWeight: 700,
              textDecoration: 'none',
              letterSpacing: 1,
              cursor: 'pointer',
              border: `1px solid ${DIM_GREEN}`,
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = GREEN;
              e.currentTarget.style.boxShadow = `0 0 15px ${GREEN}30`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = DIM_GREEN;
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            [VIEW SOURCE]
          </a>
        </div>

        <div
          style={{
            marginTop: 60,
            color: DIM_GREEN,
            fontSize: 12,
            animation: 'fadeInUp 0.8s ease-out 0.6s both',
            textAlign: 'center',
          }}
        >
          <span style={{ opacity: 0.6 }}>scroll ↓ or press</span>{' '}
          <span style={{ color: GREEN }}>SPACE</span>
        </div>
      </section>

      {/* ── AGENT MARQUEE ── */}
      <section
        style={{
          padding: '32px 0',
          borderTop: `1px solid ${DIM_GREEN}30`,
          borderBottom: `1px solid ${DIM_GREEN}30`,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 80,
            background: 'linear-gradient(90deg, #000 0%, transparent 100%)',
            zIndex: 2,
          }}
        />
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: 80,
            background: 'linear-gradient(270deg, #000 0%, transparent 100%)',
            zIndex: 2,
          }}
        />
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <span style={{ color: DIM_GREEN, fontSize: 11, letterSpacing: 2 }}>
            {'┌─── SUPPORTED AGENTS ───┐'}
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            whiteSpace: 'nowrap',
            animation: 'marquee 30s linear infinite',
            width: 'max-content',
          }}
        >
          <span
            style={{
              fontFamily: MONO,
              fontSize: 14,
              color: GREEN,
              letterSpacing: 1,
              paddingRight: 24,
            }}
          >
            {doubledAgents}
          </span>
        </div>
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <span style={{ color: DIM_GREEN, fontSize: 11, letterSpacing: 2 }}>
            {'└────────────────────────┘'}
          </span>
        </div>
      </section>

      {/* ── FEATURES (man page) ── */}
      <section
        id="features"
        style={{
          padding: '100px 24px',
          maxWidth: 900,
          margin: '0 auto',
        }}
      >
        <TerminalWindow title="man agendex — Manual Page" style={{ width: '100%' }}>
          <div style={{ fontSize: 14, lineHeight: 1.9 }}>
            <div style={{ marginBottom: 24 }}>
              <div
                style={{
                  color: '#ccc',
                  fontWeight: 700,
                  fontSize: 13,
                  letterSpacing: 2,
                  marginBottom: 8,
                  textDecoration: 'underline',
                  textUnderlineOffset: 4,
                }}
              >
                NAME
              </div>
              <div style={{ paddingLeft: 32, color: GREEN }}>
                <span style={{ fontWeight: 700 }}>agendex</span>
                <span style={{ color: '#888' }}> — unified AI agent plan dashboard</span>
              </div>
            </div>

            <div style={{ marginBottom: 24 }}>
              <div
                style={{
                  color: '#ccc',
                  fontWeight: 700,
                  fontSize: 13,
                  letterSpacing: 2,
                  marginBottom: 8,
                  textDecoration: 'underline',
                  textUnderlineOffset: 4,
                }}
              >
                SYNOPSIS
              </div>
              <div style={{ paddingLeft: 32 }}>
                <span style={{ color: GREEN, fontWeight: 700 }}>agendex</span>
                <span style={{ color: '#888' }}> [</span>
                <span style={{ color: '#ccc' }}>start</span>
                <span style={{ color: '#888' }}>|</span>
                <span style={{ color: '#ccc' }}>login</span>
                <span style={{ color: '#888' }}>|</span>
                <span style={{ color: '#ccc' }}>sync</span>
                <span style={{ color: '#888' }}>|</span>
                <span style={{ color: '#ccc' }}>status</span>
                <span style={{ color: '#888' }}>]</span>
              </div>
            </div>

            <div>
              <div
                style={{
                  color: '#ccc',
                  fontWeight: 700,
                  fontSize: 13,
                  letterSpacing: 2,
                  marginBottom: 16,
                  textDecoration: 'underline',
                  textUnderlineOffset: 4,
                }}
              >
                FEATURES
              </div>
              <div style={{ paddingLeft: 32 }}>
                {FEATURES.map((f, i) => {
                  const slug = f.title.toLowerCase().replace(/\s+/g, '-');
                  return (
                    <div
                      key={i}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '200px 1fr',
                        gap: 16,
                        marginBottom: 12,
                        alignItems: 'baseline',
                      }}
                    >
                      <span style={{ color: GREEN, fontWeight: 600 }}>{slug}</span>
                      <span style={{ color: '#999', fontSize: 13 }}>{f.desc}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </TerminalWindow>
      </section>

      {/* ── PRICING (diff style) ── */}
      <section
        id="pricing"
        style={{
          padding: '100px 24px',
          maxWidth: 1000,
          margin: '0 auto',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <span style={{ color: DIM_GREEN, fontSize: 12, letterSpacing: 2 }}>
            $ diff pricing.conf
          </span>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 32,
          }}
        >
          {/* Free */}
          <div
            style={{
              border: `1px solid ${DIM_GREEN}60`,
              padding: 32,
              background: '#0a0a0a',
              position: 'relative',
            }}
          >
            <div
              style={{
                fontFamily: MONO,
                fontSize: 13,
                color: '#e06c75',
                marginBottom: 24,
                paddingBottom: 16,
                borderBottom: `1px solid ${DIM_GREEN}30`,
              }}
            >
              <div>--- /dev/null</div>
              <div style={{ color: '#888', fontSize: 12 }}>Self-Hosted (Free & Open Source)</div>
            </div>

            <div
              style={{
                fontFamily: MONO,
                fontSize: 36,
                color: '#ccc',
                marginBottom: 8,
              }}
            >
              $0
              <span style={{ fontSize: 14, color: '#555' }}>/forever</span>
            </div>

            <div style={{ marginTop: 24 }}>
              {FREE_FEATURES.map((f, i) => (
                <div
                  key={i}
                  style={{
                    fontFamily: MONO,
                    fontSize: 13,
                    color: '#999',
                    padding: '8px 0',
                    borderBottom: `1px solid ${DIM_GREEN}15`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <span style={{ color: DIM_GREEN }}>~</span>
                  {f}
                </div>
              ))}
            </div>

            <a
              href="https://github.com/Tyru5/agendex"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'block',
                marginTop: 32,
                padding: '10px 0',
                textAlign: 'center',
                fontFamily: MONO,
                fontSize: 13,
                color: GREEN,
                border: `1px solid ${DIM_GREEN}`,
                textDecoration: 'none',
                letterSpacing: 1,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = GREEN;
                e.currentTarget.style.background = `${GREEN}10`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = DIM_GREEN;
                e.currentTarget.style.background = 'transparent';
              }}
            >
              $ git clone
            </a>
          </div>

          {/* Pro */}
          <div
            style={{
              border: `1px solid ${GREEN}60`,
              padding: 32,
              background: '#0a0a0a',
              position: 'relative',
              boxShadow: `0 0 40px ${DIM_GREEN}20`,
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: -1,
                left: 20,
                right: 20,
                height: 2,
                background: `linear-gradient(90deg, transparent, ${GREEN}, transparent)`,
              }}
            />

            <div
              style={{
                fontFamily: MONO,
                fontSize: 13,
                color: GREEN,
                marginBottom: 24,
                paddingBottom: 16,
                borderBottom: `1px solid ${DIM_GREEN}30`,
              }}
            >
              <div>+++ cloud</div>
              <div style={{ color: '#888', fontSize: 12 }}>
                Pro{' '}
                <span
                  style={{
                    background: `${GREEN}20`,
                    color: GREEN,
                    padding: '2px 8px',
                    fontSize: 11,
                  }}
                >
                  RECOMMENDED
                </span>
              </div>
            </div>

            <div
              style={{
                fontFamily: MONO,
                fontSize: 36,
                color: GREEN,
                marginBottom: 8,
                animation: 'glowPulse 3s ease-in-out infinite',
              }}
            >
              $7
              <span style={{ fontSize: 14, color: DIM_GREEN }}>/month</span>
            </div>
            <div style={{ fontFamily: MONO, fontSize: 12, color: '#555' }}>
              or $69/year (save 18%)
            </div>

            <div style={{ marginTop: 24 }}>
              {PRO_FEATURES.map((f, i) => (
                <div
                  key={i}
                  style={{
                    fontFamily: MONO,
                    fontSize: 13,
                    color: i === 0 ? '#999' : '#ccc',
                    padding: '8px 0',
                    borderBottom: `1px solid ${DIM_GREEN}15`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <span style={{ color: GREEN }}>+</span>
                  {f}
                </div>
              ))}
            </div>

            <button
              style={{
                display: 'block',
                width: '100%',
                marginTop: 32,
                padding: '12px 0',
                textAlign: 'center',
                fontFamily: MONO,
                fontSize: 13,
                fontWeight: 700,
                color: BG,
                background: GREEN,
                border: 'none',
                letterSpacing: 1,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = `0 0 20px ${GREEN}60`;
                e.currentTarget.style.transform = 'translateY(-1px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = 'none';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              [SUBSCRIBE]
            </button>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section
        id="faq"
        style={{
          padding: '100px 24px',
          maxWidth: 800,
          margin: '0 auto',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <span style={{ color: DIM_GREEN, fontSize: 12, letterSpacing: 2 }}>$ agendex --help</span>
          <div
            style={{
              color: GREEN,
              fontSize: 22,
              fontWeight: 700,
              marginTop: 12,
              letterSpacing: 2,
            }}
          >
            FAQ
          </div>
        </div>

        {FAQ_ITEMS.map((item, i) => (
          <div
            key={i}
            style={{
              borderBottom: `1px solid ${DIM_GREEN}30`,
              marginBottom: 0,
            }}
          >
            <button
              onClick={() => setExpandedFaq(expandedFaq === i ? null : i)}
              style={{
                width: '100%',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '20px 0',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontFamily: MONO,
                fontSize: 14,
                color: expandedFaq === i ? GREEN : '#ccc',
                textAlign: 'left',
                transition: 'color 0.2s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = GREEN)}
              onMouseLeave={(e) =>
                (e.currentTarget.style.color = expandedFaq === i ? GREEN : '#ccc')
              }
            >
              <span>
                <span style={{ color: DIM_GREEN, marginRight: 12 }}>{'>'}</span>
                {item.q}
              </span>
              <span style={{ color: DIM_GREEN, fontSize: 12 }}>
                {expandedFaq === i ? '[-]' : '[+]'}
              </span>
            </button>
            {expandedFaq === i && (
              <div
                style={{
                  padding: '0 0 20px 28px',
                  color: '#999',
                  fontSize: 13,
                  lineHeight: 1.7,
                  fontFamily: MONO,
                }}
              >
                {item.a}
              </div>
            )}
          </div>
        ))}
      </section>

      {/* ── FOOTER ── */}
      <footer
        style={{
          borderTop: `1px solid ${DIM_GREEN}30`,
          padding: '40px 24px',
          textAlign: 'center',
        }}
      >
        <div style={{ color: DIM_GREEN, fontSize: 12, lineHeight: 2 }}>
          <div>┌──────────────────────────────────────────────────┐</div>
          <div>
            │{'  '}AGENDEX — Built for developers who use AI agents{'  '}│
          </div>
          <div>
            │{'       '}
            <a
              href="https://github.com/Tyru5/agendex"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: GREEN, textDecoration: 'none' }}
            >
              github.com/Tyru5/agendex
            </a>
            {'        '}│
          </div>
          <div>└──────────────────────────────────────────────────┘</div>
        </div>
        <div style={{ marginTop: 16, color: '#333', fontSize: 11 }}>
          © {new Date().getFullYear()} Agendex. MIT License.
        </div>
      </footer>

      {/* ── LOGIN MODAL ── */}
      {showLogin && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.85)',
            backdropFilter: 'blur(8px)',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowLogin(false);
          }}
        >
          <TerminalWindow
            title="agendex login — auth"
            style={{ maxWidth: 520, width: '100%', margin: '0 24px' }}
          >
            <div style={{ fontSize: 14, lineHeight: 1.8 }}>
              <PromptLine command="agendex login" />
              <div style={{ color: '#888', marginBottom: 16, fontSize: 13 }}>
                Paste the auth token from your terminal output.
              </div>
              <div style={{ color: DIM_GREEN, fontSize: 11, marginBottom: 20 }}>
                ┌─── Authentication ─────────────────────────────┐
              </div>
              <form onSubmit={submit}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                  <span style={{ color: GREEN }}>{'>'}</span>
                  <span style={{ color: '#888' }}>Enter token:</span>
                  <input
                    type="password"
                    value={token}
                    onChange={(e) => setTokenValue(e.target.value)}
                    placeholder="••••••••••••"
                    autoFocus
                    style={{
                      flex: 1,
                      background: 'transparent',
                      border: 'none',
                      borderBottom: `1px solid ${DIM_GREEN}`,
                      color: GREEN,
                      fontFamily: MONO,
                      fontSize: 14,
                      padding: '4px 0',
                      outline: 'none',
                      caretColor: GREEN,
                    }}
                    onFocus={(e) => (e.currentTarget.style.borderBottomColor = GREEN)}
                    onBlur={(e) => (e.currentTarget.style.borderBottomColor = DIM_GREEN)}
                  />
                  <Cursor />
                </div>
                <div style={{ color: DIM_GREEN, fontSize: 11, marginBottom: 20 }}>
                  └────────────────────────────────────────────────┘
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                  <button
                    type="submit"
                    style={{
                      flex: 1,
                      padding: '10px 0',
                      fontFamily: MONO,
                      fontSize: 13,
                      fontWeight: 700,
                      color: BG,
                      background: GREEN,
                      border: 'none',
                      cursor: 'pointer',
                      letterSpacing: 1,
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.boxShadow = `0 0 20px ${GREEN}60`;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  >
                    [AUTHENTICATE]
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowLogin(false)}
                    style={{
                      padding: '10px 24px',
                      fontFamily: MONO,
                      fontSize: 13,
                      color: '#666',
                      background: 'transparent',
                      border: `1px solid #333`,
                      cursor: 'pointer',
                      letterSpacing: 1,
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = '#666';
                      e.currentTarget.style.color = '#999';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = '#333';
                      e.currentTarget.style.color = '#666';
                    }}
                  >
                    [ESC]
                  </button>
                </div>
              </form>
            </div>
          </TerminalWindow>
        </div>
      )}
    </div>
  );
}
