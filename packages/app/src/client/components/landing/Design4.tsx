import { useState } from 'react';
import { AGENTS, FEATURES, FAQ_ITEMS, FREE_FEATURES, PRO_FEATURES, setToken } from './data.ts';

const mono = '"SF Mono", "JetBrains Mono", "Fira Code", monospace';
const lime = '#c8ff32';
const black = '#000';
const white = '#fff';

const heading = (extra: React.CSSProperties = {}): React.CSSProperties => ({
  fontFamily: mono,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  lineHeight: 0.95,
  fontWeight: 900,
  margin: 0,
  ...extra,
});

const body = (extra: React.CSSProperties = {}): React.CSSProperties => ({
  fontFamily: mono,
  fontSize: 15,
  lineHeight: 1.6,
  margin: 0,
  ...extra,
});

export default function Design4() {
  const [token, setTokenValue] = useState('');
  const [showLogin, setShowLogin] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (token.trim()) {
      setToken(token.trim());
      window.location.reload();
    }
  }

  return (
    <div
      style={{
        background: white,
        color: black,
        fontFamily: mono,
        minHeight: '100vh',
        margin: 0,
        padding: 0,
        overflowX: 'hidden',
      }}
    >
      {/* ───── TOP BAR ───── */}
      <div
        style={{
          background: black,
          padding: '14px 32px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderRadius: 0,
        }}
      >
        <span
          style={{
            color: white,
            fontFamily: mono,
            fontWeight: 900,
            fontSize: 18,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
          }}
        >
          AGENDEX
        </span>
        <button
          onClick={() => setShowLogin(true)}
          style={{
            fontFamily: mono,
            fontSize: 13,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            background: lime,
            color: black,
            border: `2px solid ${white}`,
            borderRadius: 0,
            padding: '8px 20px',
            cursor: 'pointer',
          }}
        >
          Connect
        </button>
      </div>

      {/* ───── HERO ───── */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          borderBottom: `3px solid ${black}`,
          minHeight: '70vh',
        }}
      >
        {/* Left — 60% */}
        <div
          style={{
            flex: '1 1 58%',
            minWidth: 320,
            padding: '80px 48px 60px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          }}
        >
          <h1
            style={heading({
              fontSize: 'clamp(40px, 6vw, 72px)',
              maxWidth: 700,
            })}
          >
            ONE DASHBOARD
            <br />
            FOR{' '}
            <span
              style={{
                background: lime,
                padding: '0 8px',
                display: 'inline',
                borderRadius: 0,
              }}
            >
              EVERY
            </span>
            <br />
            CODING AGENT.
          </h1>

          <p
            style={body({
              marginTop: 32,
              maxWidth: 480,
              fontSize: 16,
              color: '#333',
            })}
          >
            Index, search, share, and comment on the plans your AI agents create. Self-hosted or
            cloud. Open source.
          </p>

          <div style={{ marginTop: 40, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <a
              href="https://github.com/Tyru5/agendex"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontFamily: mono,
                fontSize: 14,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                background: black,
                color: white,
                border: `3px solid ${black}`,
                borderRadius: 0,
                padding: '14px 28px',
                cursor: 'pointer',
                textDecoration: 'none',
                display: 'inline-block',
              }}
            >
              GitHub
            </a>
            <button
              onClick={() => setShowLogin(true)}
              style={{
                fontFamily: mono,
                fontSize: 14,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                background: white,
                color: black,
                border: `3px solid ${black}`,
                borderRadius: 0,
                padding: '14px 28px',
                cursor: 'pointer',
              }}
            >
              Connect Instance
            </button>
          </div>
        </div>

        {/* Right — 40% install box */}
        <div
          style={{
            flex: '1 1 38%',
            minWidth: 300,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '60px 32px',
            borderLeft: `3px solid ${black}`,
          }}
        >
          <div
            style={{
              background: black,
              color: lime,
              fontFamily: mono,
              fontSize: 14,
              lineHeight: 1.8,
              padding: '32px 28px',
              width: '100%',
              maxWidth: 420,
              borderRadius: 0,
            }}
          >
            <div style={{ color: '#666', marginBottom: 4 }}># self-hosted</div>
            <div>
              <span style={{ color: '#888' }}>$</span> git clone
              https://github.com/Tyru5/agendex.git
            </div>
            <div>
              <span style={{ color: '#888' }}>$</span> cd agendex && bun install
            </div>
            <div>
              <span style={{ color: '#888' }}>$</span> bun run dev
            </div>
            <div style={{ color: '#666', marginTop: 20, marginBottom: 4 }}># cloud</div>
            <div>
              <span style={{ color: '#888' }}>$</span> bun install -g @agendex/cli
            </div>
            <div>
              <span style={{ color: '#888' }}>$</span> agendex login
            </div>
            <div>
              <span style={{ color: '#888' }}>$</span> agendex start
            </div>
          </div>
        </div>
      </div>

      {/* ───── AGENT STRIP ───── */}
      <div
        style={{
          borderBottom: `3px solid ${black}`,
          padding: '20px 32px',
          overflowX: 'auto',
          whiteSpace: 'nowrap',
        }}
      >
        <span
          style={{
            fontFamily: mono,
            fontSize: 13,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: black,
          }}
        >
          {AGENTS.map((agent, i) => (
            <span key={agent}>
              {agent.toUpperCase()}
              {i < AGENTS.length - 1 && (
                <span style={{ margin: '0 12px', color: '#999' }}>&bull;</span>
              )}
            </span>
          ))}
        </span>
      </div>

      {/* ───── FEATURES INDEX ───── */}
      <div style={{ borderBottom: `3px solid ${black}` }}>
        <div style={{ padding: '48px 32px 24px' }}>
          <h2
            style={heading({
              fontSize: 'clamp(28px, 4vw, 48px)',
              marginBottom: 0,
            })}
          >
            FEATURES
          </h2>
        </div>

        {FEATURES.map((f, i) => (
          <div
            key={f.title}
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 32,
              padding: '20px 32px',
              borderTop: `2px solid ${black}`,
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{
                fontFamily: mono,
                fontSize: 'clamp(24px, 3vw, 36px)',
                fontWeight: 900,
                minWidth: 60,
                color: '#ccc',
              }}
            >
              {String(i + 1).padStart(2, '0')}
            </span>
            <span
              style={heading({
                fontSize: 'clamp(16px, 2vw, 22px)',
                minWidth: 200,
                flex: '0 0 auto',
              })}
            >
              {f.title.toUpperCase()}
            </span>
            <span
              style={body({
                flex: '1 1 300px',
                color: '#444',
                fontSize: 14,
              })}
            >
              {f.desc}
            </span>
          </div>
        ))}
      </div>

      {/* ───── PRICING ───── */}
      <div style={{ padding: '80px 32px', borderBottom: `3px solid ${black}` }}>
        <h2
          style={heading({
            fontSize: 'clamp(28px, 4vw, 48px)',
            marginBottom: 48,
          })}
        >
          PRICING
        </h2>

        <div
          style={{
            display: 'flex',
            gap: 0,
            flexWrap: 'wrap',
          }}
        >
          {/* Free tier */}
          <div
            style={{
              flex: '1 1 320px',
              border: `3px solid ${black}`,
              padding: '40px 32px',
              background: white,
              borderRadius: 0,
            }}
          >
            <div
              style={heading({
                fontSize: 14,
                letterSpacing: '0.15em',
                marginBottom: 24,
              })}
            >
              SELF-HOSTED
            </div>
            <div
              style={heading({
                fontSize: 'clamp(48px, 6vw, 72px)',
                marginBottom: 32,
              })}
            >
              $0
            </div>
            <div style={{ borderTop: `2px solid ${black}`, paddingTop: 20 }}>
              {FREE_FEATURES.map((f) => (
                <div
                  key={f}
                  style={body({
                    padding: '6px 0',
                    fontSize: 14,
                  })}
                >
                  - {f}
                </div>
              ))}
            </div>
          </div>

          {/* Pro tier */}
          <div
            style={{
              flex: '1 1 320px',
              border: `3px solid ${black}`,
              borderLeft: 0,
              padding: '40px 32px',
              background: lime,
              borderRadius: 0,
            }}
          >
            <div
              style={heading({
                fontSize: 14,
                letterSpacing: '0.15em',
                marginBottom: 24,
              })}
            >
              CLOUD PRO
            </div>
            <div
              style={heading({
                fontSize: 'clamp(48px, 6vw, 72px)',
                marginBottom: 4,
              })}
            >
              $7
            </div>
            <div
              style={body({
                fontSize: 13,
                color: '#333',
                marginBottom: 28,
              })}
            >
              /month &middot; $69/year
            </div>
            <div style={{ borderTop: `2px solid ${black}`, paddingTop: 20 }}>
              {PRO_FEATURES.map((f) => (
                <div
                  key={f}
                  style={body({
                    padding: '6px 0',
                    fontSize: 14,
                  })}
                >
                  - {f}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ───── FAQ ───── */}
      <div style={{ padding: '80px 32px', borderBottom: `3px solid ${black}` }}>
        <h2
          style={heading({
            fontSize: 'clamp(28px, 4vw, 48px)',
            marginBottom: 48,
          })}
        >
          FAQ
        </h2>

        {FAQ_ITEMS.map((item, i) => (
          <div
            key={i}
            style={{
              borderTop: `3px solid ${black}`,
              padding: '28px 0',
            }}
          >
            <div
              style={heading({
                fontSize: 'clamp(14px, 1.5vw, 18px)',
                marginBottom: 12,
                display: 'flex',
                gap: 16,
                alignItems: 'baseline',
              })}
            >
              <span style={{ color: '#bbb', minWidth: 32 }}>{String(i + 1).padStart(2, '0')}</span>
              <span>{item.q.toUpperCase()}</span>
            </div>
            <p
              style={body({
                paddingLeft: 48,
                color: '#444',
                maxWidth: 700,
                fontSize: 14,
              })}
            >
              {item.a}
            </p>
          </div>
        ))}
        <div style={{ borderTop: `3px solid ${black}` }} />
      </div>

      {/* ───── FOOTER ───── */}
      <div
        style={{
          background: black,
          color: white,
          padding: '32px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 16,
          borderRadius: 0,
        }}
      >
        <span
          style={{
            fontFamily: mono,
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
          }}
        >
          AGENDEX
        </span>
        <span
          style={{
            fontFamily: mono,
            fontSize: 12,
            color: '#888',
          }}
        >
          OPEN SOURCE &middot; MIT LICENSE
        </span>
      </div>

      {/* ───── LOGIN MODAL ───── */}
      {showLogin && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 24,
          }}
          onClick={() => setShowLogin(false)}
        >
          <div
            style={{
              background: white,
              border: `3px solid ${black}`,
              borderRadius: 0,
              padding: '48px 40px',
              width: '100%',
              maxWidth: 440,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              style={heading({
                fontSize: 24,
                marginBottom: 8,
              })}
            >
              CONNECT
            </h3>
            <p
              style={body({
                color: '#666',
                fontSize: 13,
                marginBottom: 28,
              })}
            >
              Paste your auth token from the terminal.
            </p>

            <form onSubmit={submit}>
              <input
                type="text"
                value={token}
                onChange={(e) => setTokenValue(e.target.value)}
                placeholder="AUTH TOKEN"
                autoFocus
                style={{
                  fontFamily: mono,
                  fontSize: 14,
                  width: '100%',
                  padding: '14px 16px',
                  border: `3px solid ${black}`,
                  borderRadius: 0,
                  outline: 'none',
                  background: white,
                  color: black,
                  boxSizing: 'border-box',
                  letterSpacing: '0.05em',
                }}
              />
              <button
                type="submit"
                style={{
                  fontFamily: mono,
                  fontSize: 14,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  width: '100%',
                  marginTop: 16,
                  padding: '14px 16px',
                  background: black,
                  color: white,
                  border: `3px solid ${black}`,
                  borderRadius: 0,
                  cursor: 'pointer',
                }}
              >
                Submit
              </button>
            </form>

            <button
              onClick={() => setShowLogin(false)}
              style={{
                fontFamily: mono,
                fontSize: 12,
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                background: 'none',
                border: 'none',
                color: '#999',
                cursor: 'pointer',
                marginTop: 20,
                padding: 0,
                borderRadius: 0,
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
