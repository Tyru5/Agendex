import { useState } from 'react';
import { AGENTS, FEATURES, FAQ_ITEMS, FREE_FEATURES, PRO_FEATURES, setToken } from './data.ts';

export default function Design2() {
  const [token, setTokenValue] = useState('');
  const [showLogin, setShowLogin] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');

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
        minHeight: '100vh',
        background: '#06060f',
        color: '#e2e8f0',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        overflowX: 'hidden',
        position: 'relative',
      }}
    >
      <style
        dangerouslySetInnerHTML={{
          __html: `
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

        @keyframes d2-float-purple {
          0%, 100% { transform: translate(0, 0) scale(1); }
          25% { transform: translate(30px, -40px) scale(1.05); }
          50% { transform: translate(-20px, 20px) scale(0.95); }
          75% { transform: translate(40px, 30px) scale(1.02); }
        }

        @keyframes d2-float-teal {
          0%, 100% { transform: translate(0, 0) scale(1); }
          25% { transform: translate(-40px, 30px) scale(0.97); }
          50% { transform: translate(30px, -20px) scale(1.04); }
          75% { transform: translate(-20px, -40px) scale(1); }
        }

        @keyframes d2-float-lime {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(50px, 20px) scale(1.03); }
          66% { transform: translate(-30px, -30px) scale(0.98); }
        }

        @keyframes d2-pulse-glow {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.7; }
        }

        @keyframes d2-fade-in-up {
          from { opacity: 0; transform: translateY(30px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .d2-glass-card {
          background: rgba(255, 255, 255, 0.04);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 20px;
          transition: border-color 0.3s ease, box-shadow 0.3s ease;
        }

        .d2-glass-card:hover {
          border-color: rgba(139, 92, 246, 0.3);
          box-shadow: 0 0 40px rgba(139, 92, 246, 0.08);
        }

        .d2-gradient-text {
          background: linear-gradient(135deg, #8b5cf6, #06b6d4);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .d2-gradient-btn {
          background: linear-gradient(135deg, #8b5cf6, #06b6d4);
          border: none;
          color: #fff;
          cursor: pointer;
          transition: opacity 0.2s ease, transform 0.2s ease;
        }

        .d2-gradient-btn:hover {
          opacity: 0.9;
          transform: translateY(-1px);
        }

        .d2-ghost-btn {
          background: rgba(255, 255, 255, 0.06);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.12);
          color: #e2e8f0;
          cursor: pointer;
          transition: border-color 0.2s ease, background 0.2s ease;
        }

        .d2-ghost-btn:hover {
          border-color: rgba(139, 92, 246, 0.4);
          background: rgba(255, 255, 255, 0.08);
        }

        .d2-faq-toggle {
          transition: transform 0.3s ease;
        }

        .d2-faq-toggle-open {
          transform: rotate(45deg);
        }

        .d2-agent-pill {
          background: rgba(255, 255, 255, 0.05);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          transition: border-color 0.2s ease, background 0.2s ease;
        }

        .d2-agent-pill:hover {
          border-color: rgba(139, 92, 246, 0.3);
          background: rgba(255, 255, 255, 0.08);
        }

        .d2-feature-icon {
          transition: transform 0.3s ease;
        }

        .d2-glass-card:hover .d2-feature-icon {
          transform: scale(1.1);
        }

        * { box-sizing: border-box; }
      `,
        }}
      />

      {/* Background Orbs */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 0,
          overflow: 'hidden',
        }}
      >
        {/* Purple orb */}
        <div
          style={{
            position: 'absolute',
            top: '5%',
            left: '5%',
            width: 400,
            height: 400,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(139, 92, 246, 0.25) 0%, transparent 70%)',
            filter: 'blur(80px)',
            animation:
              'd2-float-purple 20s ease-in-out infinite, d2-pulse-glow 8s ease-in-out infinite',
          }}
        />
        {/* Teal orb */}
        <div
          style={{
            position: 'absolute',
            bottom: '10%',
            right: '5%',
            width: 350,
            height: 350,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(6, 182, 212, 0.2) 0%, transparent 70%)',
            filter: 'blur(80px)',
            animation:
              'd2-float-teal 25s ease-in-out infinite, d2-pulse-glow 10s ease-in-out infinite',
          }}
        />
        {/* Lime orb */}
        <div
          style={{
            position: 'absolute',
            top: '15%',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 300,
            height: 300,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(200, 255, 50, 0.08) 0%, transparent 70%)',
            filter: 'blur(100px)',
            animation: 'd2-float-lime 22s ease-in-out infinite',
          }}
        />
        {/* Subtle mesh gradient overlay */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(ellipse at 20% 80%, rgba(139, 92, 246, 0.05) 0%, transparent 50%), radial-gradient(ellipse at 80% 20%, rgba(6, 182, 212, 0.04) 0%, transparent 50%)',
          }}
        />
      </div>

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 1 }}>
        {/* ─── HERO ─── */}
        <section
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: '140px 24px 80px',
            maxWidth: 900,
            margin: '0 auto',
            animation: 'd2-fade-in-up 0.8s ease-out',
          }}
        >
          {/* Open Source pill */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 16px',
              borderRadius: 999,
              background: 'rgba(139, 92, 246, 0.12)',
              border: '1px solid rgba(139, 92, 246, 0.25)',
              fontSize: 13,
              fontWeight: 500,
              color: '#a78bfa',
              marginBottom: 32,
              letterSpacing: '0.02em',
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#8b5cf6' }} />
            Open Source
          </div>

          <h1
            style={{
              fontSize: 'clamp(36px, 6vw, 72px)',
              fontWeight: 300,
              lineHeight: 1.1,
              margin: '0 0 24px',
              letterSpacing: '-0.03em',
              color: '#f1f5f9',
            }}
          >
            One dashboard for{' '}
            <span className="d2-gradient-text" style={{ fontWeight: 600 }}>
              every coding agent
            </span>
            .
          </h1>

          <p
            style={{
              fontSize: 'clamp(16px, 2vw, 20px)',
              lineHeight: 1.6,
              color: '#94a3b8',
              maxWidth: 600,
              margin: '0 0 40px',
              fontWeight: 400,
            }}
          >
            Agendex indexes plan files from all your AI coding agents and surfaces them in a
            unified, searchable dashboard.
          </p>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
            <a
              href="https://github.com/Tyru5/agendex"
              target="_blank"
              rel="noopener noreferrer"
              className="d2-gradient-btn"
              style={{
                padding: '14px 32px',
                borderRadius: 14,
                fontSize: 15,
                fontWeight: 600,
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              Get Started
              <span style={{ fontSize: 18 }}>&#8594;</span>
            </a>
            <button
              onClick={() => setShowLogin(true)}
              className="d2-ghost-btn"
              style={{
                padding: '14px 32px',
                borderRadius: 14,
                fontSize: 15,
                fontWeight: 500,
              }}
            >
              Connect Dashboard
            </button>
          </div>
        </section>

        {/* ─── AGENT LOGOS ─── */}
        <section
          style={{
            maxWidth: 800,
            margin: '0 auto',
            padding: '0 24px 80px',
            animation: 'd2-fade-in-up 1s ease-out',
          }}
        >
          <p
            style={{
              textAlign: 'center',
              fontSize: 13,
              fontWeight: 500,
              color: '#64748b',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              marginBottom: 20,
            }}
          >
            Supported Agents
          </p>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: 10,
            }}
          >
            {AGENTS.map((agent) => (
              <span
                key={agent}
                className="d2-agent-pill"
                style={{
                  padding: '8px 16px',
                  borderRadius: 999,
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#cbd5e1',
                  whiteSpace: 'nowrap',
                }}
              >
                {agent}
              </span>
            ))}
          </div>
        </section>

        {/* ─── FEATURES ─── */}
        <section
          style={{
            maxWidth: 1100,
            margin: '0 auto',
            padding: '60px 24px 100px',
          }}
        >
          <div style={{ textAlign: 'center', marginBottom: 60 }}>
            <h2
              style={{
                fontSize: 'clamp(28px, 4vw, 44px)',
                fontWeight: 300,
                margin: '0 0 16px',
                letterSpacing: '-0.02em',
                color: '#f1f5f9',
              }}
            >
              Everything you need,{' '}
              <span className="d2-gradient-text" style={{ fontWeight: 600 }}>
                nothing you don't
              </span>
            </h2>
            <p style={{ fontSize: 17, color: '#64748b', margin: 0 }}>
              Built for developers who use multiple AI agents daily.
            </p>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              gap: 20,
            }}
          >
            {FEATURES.map((feature) => (
              <div key={feature.title} className="d2-glass-card" style={{ padding: 28 }}>
                <div
                  className="d2-feature-icon"
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    background:
                      'linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(6, 182, 212, 0.2))',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 20,
                    marginBottom: 18,
                  }}
                >
                  {feature.icon}
                </div>
                <h3
                  style={{
                    fontSize: 17,
                    fontWeight: 600,
                    margin: '0 0 10px',
                    color: '#f1f5f9',
                  }}
                >
                  {feature.title}
                </h3>
                <p
                  style={{
                    fontSize: 14,
                    lineHeight: 1.6,
                    color: '#94a3b8',
                    margin: 0,
                  }}
                >
                  {feature.desc}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ─── PRICING ─── */}
        <section
          style={{
            maxWidth: 880,
            margin: '0 auto',
            padding: '60px 24px 100px',
          }}
        >
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <h2
              style={{
                fontSize: 'clamp(28px, 4vw, 44px)',
                fontWeight: 300,
                margin: '0 0 16px',
                letterSpacing: '-0.02em',
                color: '#f1f5f9',
              }}
            >
              Simple,{' '}
              <span className="d2-gradient-text" style={{ fontWeight: 600 }}>
                transparent
              </span>{' '}
              pricing
            </h2>
            <p style={{ fontSize: 17, color: '#64748b', margin: '0 0 32px' }}>
              Free forever for local use. Upgrade for cloud features.
            </p>

            {/* Billing toggle */}
            <div
              style={{
                display: 'inline-flex',
                borderRadius: 999,
                background: 'rgba(255, 255, 255, 0.05)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                padding: 4,
              }}
            >
              {(['monthly', 'yearly'] as const).map((cycle) => (
                <button
                  key={cycle}
                  onClick={() => setBillingCycle(cycle)}
                  style={{
                    padding: '8px 24px',
                    borderRadius: 999,
                    border: 'none',
                    fontSize: 14,
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    background:
                      billingCycle === cycle
                        ? 'linear-gradient(135deg, #8b5cf6, #06b6d4)'
                        : 'transparent',
                    color: billingCycle === cycle ? '#fff' : '#94a3b8',
                  }}
                >
                  {cycle === 'monthly' ? 'Monthly' : 'Yearly'}
                  {cycle === 'yearly' && (
                    <span style={{ marginLeft: 6, fontSize: 11, opacity: 0.8 }}>Save 17%</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
              gap: 24,
              alignItems: 'start',
            }}
          >
            {/* Free Card */}
            <div className="d2-glass-card" style={{ padding: 36 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#94a3b8',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  marginBottom: 8,
                }}
              >
                Self-Hosted
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 8 }}>
                <span style={{ fontSize: 48, fontWeight: 300, color: '#f1f5f9' }}>$0</span>
                <span style={{ fontSize: 15, color: '#64748b' }}>/forever</span>
              </div>
              <p style={{ fontSize: 14, color: '#64748b', marginBottom: 28 }}>
                Full-featured local dashboard. No accounts, no cloud.
              </p>
              <a
                href="https://github.com/Tyru5/agendex"
                target="_blank"
                rel="noopener noreferrer"
                className="d2-ghost-btn"
                style={{
                  display: 'block',
                  textAlign: 'center',
                  padding: '12px 24px',
                  borderRadius: 12,
                  fontSize: 14,
                  fontWeight: 600,
                  textDecoration: 'none',
                  marginBottom: 28,
                  width: '100%',
                }}
              >
                Clone Repository
              </a>
              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14,
                }}
              >
                {FREE_FEATURES.map((f) => (
                  <li
                    key={f}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      fontSize: 14,
                      color: '#cbd5e1',
                    }}
                  >
                    <span
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: '50%',
                        background: 'rgba(139, 92, 246, 0.15)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 11,
                        color: '#a78bfa',
                        flexShrink: 0,
                      }}
                    >
                      &#10003;
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
            </div>

            {/* Pro Card — gradient border via wrapper */}
            <div
              style={{
                borderRadius: 21,
                padding: 1,
                background: 'linear-gradient(135deg, #8b5cf6, #06b6d4)',
              }}
            >
              <div
                style={{
                  background: '#0c0c1d',
                  borderRadius: 20,
                  padding: 36,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                    }}
                    className="d2-gradient-text"
                  >
                    Cloud Pro
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      padding: '3px 10px',
                      borderRadius: 999,
                      background:
                        'linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(6, 182, 212, 0.2))',
                      color: '#a78bfa',
                    }}
                  >
                    Popular
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 8 }}>
                  <span style={{ fontSize: 48, fontWeight: 300, color: '#f1f5f9' }}>
                    ${billingCycle === 'monthly' ? '7' : '69'}
                  </span>
                  <span style={{ fontSize: 15, color: '#64748b' }}>
                    /{billingCycle === 'monthly' ? 'month' : 'year'}
                  </span>
                </div>
                <p style={{ fontSize: 14, color: '#64748b', marginBottom: 28 }}>
                  Cloud sync, sharing, comments, and collaboration.
                </p>
                <button
                  className="d2-gradient-btn"
                  style={{
                    width: '100%',
                    padding: '12px 24px',
                    borderRadius: 12,
                    fontSize: 14,
                    fontWeight: 600,
                    marginBottom: 28,
                  }}
                >
                  Start Free Trial
                </button>
                <ul
                  style={{
                    listStyle: 'none',
                    padding: 0,
                    margin: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 14,
                  }}
                >
                  {PRO_FEATURES.map((f) => (
                    <li
                      key={f}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        fontSize: 14,
                        color: '#cbd5e1',
                      }}
                    >
                      <span
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: '50%',
                          background:
                            'linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(6, 182, 212, 0.2))',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 11,
                          color: '#a78bfa',
                          flexShrink: 0,
                        }}
                      >
                        &#10003;
                      </span>
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ─── FAQ ─── */}
        <section
          style={{
            maxWidth: 720,
            margin: '0 auto',
            padding: '60px 24px 120px',
          }}
        >
          <h2
            style={{
              fontSize: 'clamp(28px, 4vw, 44px)',
              fontWeight: 300,
              textAlign: 'center',
              margin: '0 0 48px',
              letterSpacing: '-0.02em',
              color: '#f1f5f9',
            }}
          >
            Frequently asked{' '}
            <span className="d2-gradient-text" style={{ fontWeight: 600 }}>
              questions
            </span>
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {FAQ_ITEMS.map((item, i) => (
              <div key={i}>
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '20px 0',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span
                    style={{
                      fontSize: 16,
                      fontWeight: 500,
                      color: '#f1f5f9',
                      paddingRight: 16,
                    }}
                  >
                    {item.q}
                  </span>
                  <span
                    className={`d2-faq-toggle ${openFaq === i ? 'd2-faq-toggle-open' : ''}`}
                    style={{
                      fontSize: 22,
                      color: '#64748b',
                      flexShrink: 0,
                      lineHeight: 1,
                      fontWeight: 300,
                    }}
                  >
                    +
                  </span>
                </button>
                <div
                  style={{
                    maxHeight: openFaq === i ? 300 : 0,
                    overflow: 'hidden',
                    transition: 'max-height 0.3s ease',
                  }}
                >
                  <p
                    style={{
                      fontSize: 14,
                      lineHeight: 1.7,
                      color: '#94a3b8',
                      margin: '0 0 20px',
                      paddingRight: 40,
                    }}
                  >
                    {item.a}
                  </p>
                </div>
                {i < FAQ_ITEMS.length - 1 && (
                  <div
                    style={{
                      height: 1,
                      background: 'rgba(255, 255, 255, 0.06)',
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ─── FOOTER ─── */}
        <footer
          style={{
            borderTop: '1px solid rgba(255, 255, 255, 0.06)',
            padding: '32px 24px',
            textAlign: 'center',
          }}
        >
          <p style={{ fontSize: 13, color: '#475569', margin: 0 }}>
            &copy; {new Date().getFullYear()} Agendex. Open source under MIT.
          </p>
        </footer>
      </div>

      {/* ─── LOGIN MODAL ─── */}
      {showLogin && (
        <div
          onClick={() => setShowLogin(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(6, 6, 15, 0.8)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 420,
              margin: '0 24px',
              background: 'rgba(255, 255, 255, 0.05)',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: 24,
              padding: 36,
              animation: 'd2-fade-in-up 0.3s ease-out',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 8,
              }}
            >
              <h3
                style={{
                  fontSize: 20,
                  fontWeight: 600,
                  margin: 0,
                  color: '#f1f5f9',
                }}
              >
                Connect to Dashboard
              </h3>
              <button
                onClick={() => setShowLogin(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#64748b',
                  fontSize: 20,
                  cursor: 'pointer',
                  padding: '4px 8px',
                  lineHeight: 1,
                }}
              >
                &times;
              </button>
            </div>
            <p
              style={{
                fontSize: 14,
                color: '#64748b',
                margin: '0 0 24px',
                lineHeight: 1.5,
              }}
            >
              Paste the auth token from your terminal to access your local Agendex instance.
            </p>
            <form onSubmit={submit}>
              <input
                type="text"
                value={token}
                onChange={(e) => setTokenValue(e.target.value)}
                placeholder="Paste your token..."
                autoFocus
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  borderRadius: 12,
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  background: 'rgba(255, 255, 255, 0.04)',
                  color: '#e2e8f0',
                  fontSize: 14,
                  outline: 'none',
                  marginBottom: 16,
                  fontFamily: "'Inter', sans-serif",
                  transition: 'border-color 0.2s ease',
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.4)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                }}
              />
              <button
                type="submit"
                className="d2-gradient-btn"
                style={{
                  width: '100%',
                  padding: '12px 24px',
                  borderRadius: 12,
                  fontSize: 15,
                  fontWeight: 600,
                }}
              >
                Connect
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
