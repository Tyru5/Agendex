import { useState } from 'react';
import { AGENTS, FEATURES, FAQ_ITEMS, FREE_FEATURES, PRO_FEATURES, setToken } from './data.ts';

const LIME = '#c8ff32';
const TEAL = '#2dd4bf';
const BLUE = '#3b82f6';
const PURPLE = '#8b5cf6';

const GRADIENT_FULL = `linear-gradient(135deg, ${LIME}, ${TEAL}, ${BLUE}, ${PURPLE})`;
const GRADIENT_TEXT = `linear-gradient(90deg, ${LIME}, ${TEAL}, ${BLUE}, ${PURPLE})`;
const GRADIENT_CTA = `linear-gradient(135deg, ${LIME}, ${TEAL})`;

const cardGradients = [
  `linear-gradient(90deg, ${LIME}, ${TEAL})`,
  `linear-gradient(90deg, ${TEAL}, ${BLUE})`,
  `linear-gradient(90deg, ${BLUE}, ${PURPLE})`,
  `linear-gradient(90deg, ${PURPLE}, ${LIME})`,
  `linear-gradient(90deg, ${LIME}, ${BLUE})`,
  `linear-gradient(90deg, ${TEAL}, ${PURPLE})`,
  `linear-gradient(90deg, ${BLUE}, ${LIME})`,
  `linear-gradient(90deg, ${PURPLE}, ${TEAL})`,
  `linear-gradient(90deg, ${LIME}, ${PURPLE})`,
];

const gradientIconBgs = [
  `rgba(200, 255, 50, 0.08)`,
  `rgba(45, 212, 191, 0.08)`,
  `rgba(59, 130, 246, 0.08)`,
  `rgba(139, 92, 246, 0.08)`,
  `rgba(200, 255, 50, 0.06)`,
  `rgba(45, 212, 191, 0.06)`,
  `rgba(59, 130, 246, 0.06)`,
  `rgba(139, 92, 246, 0.06)`,
  `rgba(200, 255, 50, 0.07)`,
];

function GradientText({ children, style, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      style={{
        background: GRADIENT_TEXT,
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
        ...style,
      }}
      {...props}
    >
      {children}
    </span>
  );
}

export default function Design5() {
  const [token, setTokenValue] = useState('');
  const [showLogin, setShowLogin] = useState(false);
  const [yearly, setYearly] = useState(true);
  const [hoveredCard, setHoveredCard] = useState<number | null>(null);
  const [hoveredAgent, setHoveredAgent] = useState<number | null>(null);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

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
        background: '#050505',
        color: '#e5e5e5',
        fontFamily: "'Inter', system-ui, sans-serif",
        minHeight: '100vh',
        overflow: 'hidden',
      }}
    >
      <style>{`
        @property --d5-angle {
          syntax: '<angle>';
          initial-value: 0deg;
          inherits: false;
        }

        @keyframes d5-rotate {
          to { --d5-angle: 360deg; }
        }

        @keyframes d5-aurora-drift {
          0% { transform: translateX(-10%) scaleX(1.2); opacity: 0.6; }
          50% { transform: translateX(10%) scaleX(1.0); opacity: 0.8; }
          100% { transform: translateX(-10%) scaleX(1.2); opacity: 0.6; }
        }

        @keyframes d5-aurora-cta {
          0% { transform: translateX(-5%) scale(1.05); }
          50% { transform: translateX(5%) scale(1.0); }
          100% { transform: translateX(-5%) scale(1.05); }
        }

        @keyframes d5-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }

        @keyframes d5-glow-pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.7; }
        }

        .d5-pro-border {
          --d5-angle: 0deg;
          animation: d5-rotate 5s linear infinite;
          background: conic-gradient(from var(--d5-angle), ${LIME}, ${TEAL}, ${BLUE}, ${PURPLE}, ${LIME});
          border-radius: 20px;
          padding: 2px;
        }

        .d5-feature-card {
          transition: transform 0.3s ease, box-shadow 0.3s ease;
        }

        .d5-feature-card:hover {
          transform: translateY(-2px);
        }

        .d5-agent:hover {
          text-shadow: 0 0 20px rgba(200, 255, 50, 0.4);
          color: #999 !important;
        }

        .d5-btn-primary:hover {
          box-shadow: 0 0 30px rgba(200, 255, 50, 0.3);
        }

        .d5-btn-ghost:hover {
          background: rgba(255, 255, 255, 0.05) !important;
        }

        .d5-login-input:focus {
          outline: none;
          box-shadow: 0 0 0 2px rgba(200, 255, 50, 0.3), 0 0 0 4px rgba(45, 212, 191, 0.15);
        }

        .d5-faq-item {
          transition: background 0.2s ease;
        }
        .d5-faq-item:hover {
          background: rgba(255, 255, 255, 0.02);
        }
      `}</style>

      {/* ═══════ HERO ═══════ */}
      <section
        style={{
          position: 'relative',
          padding: 'clamp(100px, 15vw, 180px) 24px clamp(80px, 12vw, 140px)',
          textAlign: 'center',
          overflow: 'hidden',
        }}
      >
        {/* Aurora band */}
        <div
          style={{
            position: 'absolute',
            top: '-40%',
            left: '-20%',
            right: '-20%',
            height: '600px',
            background: `linear-gradient(90deg, ${LIME}15, ${TEAL}20, ${BLUE}18, ${PURPLE}15, transparent)`,
            filter: 'blur(100px)',
            animation: 'd5-aurora-drift 10s ease-in-out infinite',
            pointerEvents: 'none',
          }}
        />

        <div style={{ position: 'relative', zIndex: 1, maxWidth: 900, margin: '0 auto' }}>
          {/* Badge */}
          <div style={{ display: 'inline-block', marginBottom: 32 }}>
            <div
              style={{
                padding: '1px',
                borderRadius: 999,
                background: GRADIENT_FULL,
                display: 'inline-block',
              }}
            >
              <div
                style={{
                  background: '#0a0a0a',
                  borderRadius: 999,
                  padding: '6px 18px',
                  fontSize: 13,
                  fontWeight: 500,
                  letterSpacing: '0.05em',
                  color: '#ccc',
                }}
              >
                Open Source
              </div>
            </div>
          </div>

          {/* Heading */}
          <h1
            style={{
              fontSize: 'clamp(48px, 7vw, 80px)',
              fontWeight: 300,
              letterSpacing: '-0.03em',
              lineHeight: 1.05,
              margin: '0 0 24px',
            }}
          >
            <GradientText>One dashboard for every coding agent.</GradientText>
          </h1>

          {/* Subtitle */}
          <p
            style={{
              fontSize: 'clamp(16px, 2vw, 20px)',
              color: '#888',
              maxWidth: 560,
              margin: '0 auto 48px',
              lineHeight: 1.6,
              fontWeight: 400,
            }}
          >
            Agendex indexes plans from all your AI coding agents and surfaces them in a single,
            searchable dashboard.
          </p>

          {/* Buttons */}
          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
            <a
              href="https://github.com/Tyru5/agendex"
              target="_blank"
              rel="noreferrer"
              className="d5-btn-primary"
              style={{
                background: GRADIENT_CTA,
                color: '#050505',
                padding: '14px 32px',
                borderRadius: 12,
                fontSize: 15,
                fontWeight: 600,
                textDecoration: 'none',
                transition: 'box-shadow 0.3s ease',
              }}
            >
              Get Started
            </a>
            <button
              onClick={() => setShowLogin(true)}
              className="d5-btn-ghost"
              style={{
                background: 'transparent',
                border: '1px solid',
                borderImage: `${GRADIENT_FULL} 1`,
                color: '#e5e5e5',
                padding: '14px 32px',
                borderRadius: 12,
                fontSize: 15,
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'background 0.3s ease',
                borderImageSlice: 1,
              }}
            >
              Connect Instance
            </button>
          </div>
        </div>
      </section>

      {/* ═══════ AGENT RIBBON ═══════ */}
      <section
        style={{
          padding: '28px 24px',
          background: `linear-gradient(90deg, ${LIME}08, ${TEAL}06, ${BLUE}08, ${PURPLE}06)`,
          borderTop: '1px solid rgba(255,255,255,0.04)',
          borderBottom: '1px solid rgba(255,255,255,0.04)',
        }}
      >
        <div
          style={{
            maxWidth: 1100,
            margin: '0 auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexWrap: 'wrap',
            gap: '4px 0',
          }}
        >
          {AGENTS.map((agent, i) => (
            <span key={agent} style={{ display: 'inline-flex', alignItems: 'center' }}>
              <span
                className="d5-agent"
                onMouseEnter={() => setHoveredAgent(i)}
                onMouseLeave={() => setHoveredAgent(null)}
                style={{
                  color: hoveredAgent === i ? '#999' : '#666',
                  fontSize: 14,
                  fontWeight: 400,
                  padding: '4px 8px',
                  cursor: 'default',
                  transition: 'color 0.2s ease, text-shadow 0.3s ease',
                }}
              >
                {agent}
              </span>
              {i < AGENTS.length - 1 && (
                <span
                  style={{
                    display: 'inline-block',
                    width: 4,
                    height: 4,
                    borderRadius: '50%',
                    background: GRADIENT_FULL,
                    margin: '0 4px',
                    opacity: 0.5,
                  }}
                />
              )}
            </span>
          ))}
        </div>
      </section>

      {/* ═══════ FEATURES ═══════ */}
      <section style={{ padding: 'clamp(80px, 10vw, 120px) 24px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 64 }}>
            <h2
              style={{
                fontSize: 'clamp(32px, 5vw, 48px)',
                fontWeight: 300,
                letterSpacing: '-0.02em',
                margin: '0 0 16px',
              }}
            >
              <GradientText>Everything you need</GradientText>
            </h2>
            <p style={{ color: '#888', fontSize: 17, margin: 0 }}>
              A unified toolkit for managing plans across every AI coding agent.
            </p>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: 20,
            }}
          >
            {FEATURES.map((f, i) => {
              const grad = cardGradients[i % cardGradients.length];
              const isHovered = hoveredCard === i;
              return (
                <div
                  key={f.title}
                  className="d5-feature-card"
                  onMouseEnter={() => setHoveredCard(i)}
                  onMouseLeave={() => setHoveredCard(null)}
                  style={{
                    background: '#0a0a0a',
                    borderRadius: 16,
                    padding: 28,
                    borderTop: `2px solid transparent`,
                    borderImage: `${grad} 1`,
                    borderImageSlice: 1,
                    boxShadow: isHovered
                      ? `0 0 20px ${['rgba(200,255,50,0.08)', 'rgba(45,212,191,0.08)', 'rgba(59,130,246,0.08)', 'rgba(139,92,246,0.08)'][i % 4]}`
                      : 'none',
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  {/* Gradient top line glow */}
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      height: 1,
                      background: grad,
                      opacity: isHovered ? 0.8 : 0.4,
                      transition: 'opacity 0.3s ease',
                    }}
                  />

                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 12,
                      background: gradientIconBgs[i % gradientIconBgs.length],
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 20,
                      marginBottom: 16,
                    }}
                  >
                    {f.icon}
                  </div>
                  <h3
                    style={{
                      color: '#fff',
                      fontSize: 16,
                      fontWeight: 500,
                      margin: '0 0 8px',
                      letterSpacing: '-0.01em',
                    }}
                  >
                    {f.title}
                  </h3>
                  <p style={{ color: '#888', fontSize: 14, lineHeight: 1.6, margin: 0 }}>
                    {f.desc}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ═══════ PRICING ═══════ */}
      <section style={{ padding: 'clamp(80px, 10vw, 120px) 24px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <h2
              style={{
                fontSize: 'clamp(32px, 5vw, 48px)',
                fontWeight: 300,
                letterSpacing: '-0.02em',
                margin: '0 0 16px',
              }}
            >
              <GradientText>Simple pricing</GradientText>
            </h2>
            <p style={{ color: '#888', fontSize: 17, margin: '0 0 32px' }}>
              Start free. Upgrade when you need cloud.
            </p>

            {/* Toggle */}
            <div
              style={{
                display: 'inline-flex',
                background: '#111',
                borderRadius: 999,
                padding: 4,
                position: 'relative',
              }}
            >
              <button
                onClick={() => setYearly(false)}
                style={{
                  padding: '8px 24px',
                  borderRadius: 999,
                  border: 'none',
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: 'pointer',
                  background: !yearly ? GRADIENT_CTA : 'transparent',
                  color: !yearly ? '#050505' : '#888',
                  transition: 'color 0.2s ease',
                  position: 'relative',
                  zIndex: 1,
                }}
              >
                Monthly
              </button>
              <button
                onClick={() => setYearly(true)}
                style={{
                  padding: '8px 24px',
                  borderRadius: 999,
                  border: 'none',
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: 'pointer',
                  background: yearly ? GRADIENT_CTA : 'transparent',
                  color: yearly ? '#050505' : '#888',
                  transition: 'color 0.2s ease',
                  position: 'relative',
                  zIndex: 1,
                }}
              >
                Yearly
              </button>
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
            <div
              style={{
                background: '#0a0a0a',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 20,
                padding: 36,
              }}
            >
              <div style={{ marginBottom: 24 }}>
                <h3 style={{ color: '#fff', fontSize: 22, fontWeight: 500, margin: '0 0 4px' }}>
                  Self-Hosted
                </h3>
                <p style={{ color: '#666', fontSize: 14, margin: 0 }}>Free forever</p>
              </div>
              <div style={{ marginBottom: 28 }}>
                <span
                  style={{ color: '#fff', fontSize: 48, fontWeight: 300, letterSpacing: '-0.03em' }}
                >
                  $0
                </span>
                <span style={{ color: '#666', fontSize: 14, marginLeft: 4 }}>/month</span>
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 32px' }}>
                {FREE_FEATURES.map((f) => (
                  <li
                    key={f}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '6px 0',
                      color: '#aaa',
                      fontSize: 14,
                    }}
                  >
                    <span style={{ color: LIME, fontSize: 14 }}>&#10003;</span>
                    {f}
                  </li>
                ))}
              </ul>
              <a
                href="https://github.com/Tyru5/agendex"
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'block',
                  textAlign: 'center',
                  padding: '12px 24px',
                  borderRadius: 12,
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: '#e5e5e5',
                  textDecoration: 'none',
                  fontSize: 14,
                  fontWeight: 500,
                  transition: 'background 0.2s ease',
                }}
              >
                Clone Repository
              </a>
            </div>

            {/* Pro Card — animated gradient border */}
            <div className="d5-pro-border">
              <div
                style={{
                  background: '#0a0a0a',
                  borderRadius: 18,
                  padding: 36,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
                  <h3 style={{ color: '#fff', fontSize: 22, fontWeight: 500, margin: 0 }}>
                    Cloud Pro
                  </h3>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      padding: '3px 10px',
                      borderRadius: 999,
                      background: GRADIENT_CTA,
                      color: '#050505',
                      letterSpacing: '0.03em',
                    }}
                  >
                    POPULAR
                  </span>
                </div>
                <div style={{ marginBottom: 28 }}>
                  <span
                    style={{
                      color: '#fff',
                      fontSize: 48,
                      fontWeight: 300,
                      letterSpacing: '-0.03em',
                    }}
                  >
                    {yearly ? '$69' : '$7'}
                  </span>
                  <span style={{ color: '#666', fontSize: 14, marginLeft: 4 }}>
                    {yearly ? '/year' : '/month'}
                  </span>
                  {yearly && (
                    <span
                      style={{
                        marginLeft: 12,
                        fontSize: 12,
                        color: LIME,
                        fontWeight: 500,
                      }}
                    >
                      Save 18%
                    </span>
                  )}
                </div>
                <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 32px' }}>
                  {PRO_FEATURES.map((f) => (
                    <li
                      key={f}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '6px 0',
                        color: '#aaa',
                        fontSize: 14,
                      }}
                    >
                      <GradientText style={{ fontSize: 14 }}>&#10003;</GradientText>
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  style={{
                    width: '100%',
                    padding: '12px 24px',
                    borderRadius: 12,
                    border: 'none',
                    background: GRADIENT_CTA,
                    color: '#050505',
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'box-shadow 0.3s ease',
                  }}
                  className="d5-btn-primary"
                >
                  Subscribe
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════ FAQ ═══════ */}
      <section style={{ padding: 'clamp(60px, 8vw, 100px) 24px' }}>
        <div style={{ maxWidth: 700, margin: '0 auto' }}>
          <h2
            style={{
              fontSize: 'clamp(28px, 4vw, 40px)',
              fontWeight: 300,
              letterSpacing: '-0.02em',
              textAlign: 'center',
              margin: '0 0 48px',
            }}
          >
            <GradientText>Frequently asked questions</GradientText>
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {FAQ_ITEMS.map((item, i) => (
              <div
                key={i}
                className="d5-faq-item"
                style={{
                  borderRadius: 12,
                  overflow: 'hidden',
                }}
              >
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  style={{
                    width: '100%',
                    padding: '18px 20px',
                    background: 'transparent',
                    border: 'none',
                    color: '#e5e5e5',
                    fontSize: 15,
                    fontWeight: 400,
                    textAlign: 'left',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span>{item.q}</span>
                  <span
                    style={{
                      color: '#666',
                      fontSize: 18,
                      transition: 'transform 0.2s ease',
                      transform: openFaq === i ? 'rotate(45deg)' : 'rotate(0deg)',
                      flexShrink: 0,
                      marginLeft: 16,
                    }}
                  >
                    +
                  </span>
                </button>
                {openFaq === i && (
                  <div
                    style={{ padding: '0 20px 18px', color: '#888', fontSize: 14, lineHeight: 1.7 }}
                  >
                    {item.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════ CTA SECTION ═══════ */}
      <section
        style={{
          position: 'relative',
          padding: 'clamp(80px, 10vw, 120px) 24px',
          overflow: 'hidden',
          textAlign: 'center',
        }}
      >
        {/* Aurora CTA background */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `
              radial-gradient(ellipse 80% 50% at 20% 50%, ${LIME}12 0%, transparent 70%),
              radial-gradient(ellipse 60% 50% at 50% 50%, ${TEAL}15 0%, transparent 70%),
              radial-gradient(ellipse 60% 50% at 70% 50%, ${BLUE}12 0%, transparent 70%),
              radial-gradient(ellipse 50% 50% at 90% 50%, ${PURPLE}10 0%, transparent 70%)
            `,
            filter: 'blur(60px)',
            animation: 'd5-aurora-cta 12s ease-in-out infinite',
            pointerEvents: 'none',
          }}
        />

        <div style={{ position: 'relative', zIndex: 1, maxWidth: 600, margin: '0 auto' }}>
          <h2
            style={{
              fontSize: 'clamp(28px, 5vw, 44px)',
              fontWeight: 300,
              letterSpacing: '-0.02em',
              color: '#fff',
              margin: '0 0 16px',
              lineHeight: 1.15,
            }}
          >
            Ready to unify your agents?
          </h2>
          <p style={{ color: '#999', fontSize: 16, margin: '0 0 36px', lineHeight: 1.6 }}>
            Index every plan from every coding agent. One dashboard. Zero friction.
          </p>
          <a
            href="https://github.com/Tyru5/agendex"
            target="_blank"
            rel="noreferrer"
            className="d5-btn-primary"
            style={{
              display: 'inline-block',
              background: GRADIENT_CTA,
              color: '#050505',
              padding: '16px 40px',
              borderRadius: 14,
              fontSize: 16,
              fontWeight: 600,
              textDecoration: 'none',
              transition: 'box-shadow 0.3s ease',
            }}
          >
            Get Started Free
          </a>
        </div>
      </section>

      {/* ═══════ FOOTER ═══════ */}
      <footer
        style={{
          padding: '40px 24px',
          borderTop: '1px solid rgba(255,255,255,0.04)',
          textAlign: 'center',
        }}
      >
        <p style={{ color: '#444', fontSize: 13, margin: 0 }}>
          &copy; {new Date().getFullYear()} Agendex. Open source under MIT.
        </p>
      </footer>

      {/* ═══════ LOGIN MODAL ═══════ */}
      {showLogin && (
        <div
          onClick={() => setShowLogin(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#0c0c0c',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 20,
              padding: 36,
              width: '100%',
              maxWidth: 420,
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {/* Gradient accent line */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: 2,
                background: GRADIENT_FULL,
              }}
            />

            <h3
              style={{
                color: '#fff',
                fontSize: 20,
                fontWeight: 400,
                margin: '0 0 8px',
                letterSpacing: '-0.01em',
              }}
            >
              Connect your instance
            </h3>
            <p style={{ color: '#888', fontSize: 14, margin: '0 0 28px', lineHeight: 1.5 }}>
              Paste the token from your terminal to connect.
            </p>

            <form onSubmit={submit}>
              <input
                type="text"
                placeholder="Paste auth token…"
                value={token}
                onChange={(e) => setTokenValue(e.target.value)}
                className="d5-login-input"
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  background: '#111',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 12,
                  color: '#e5e5e5',
                  fontSize: 14,
                  outline: 'none',
                  transition: 'box-shadow 0.2s ease, border-color 0.2s ease',
                  boxSizing: 'border-box',
                  marginBottom: 16,
                }}
              />
              <button
                type="submit"
                className="d5-btn-primary"
                style={{
                  width: '100%',
                  padding: '12px 24px',
                  borderRadius: 12,
                  border: 'none',
                  background: GRADIENT_CTA,
                  color: '#050505',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'box-shadow 0.3s ease',
                }}
              >
                Connect
              </button>
            </form>

            <button
              onClick={() => setShowLogin(false)}
              style={{
                position: 'absolute',
                top: 16,
                right: 16,
                background: 'none',
                border: 'none',
                color: '#666',
                fontSize: 20,
                cursor: 'pointer',
                lineHeight: 1,
                padding: 4,
              }}
            >
              &times;
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
