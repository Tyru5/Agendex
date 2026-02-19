import { useState } from 'react';
import { useAuth } from '../hooks/useAuth.ts';
import { setToken } from '../lib/api.ts';
import { PricingModal } from './PricingModal.tsx';

const _DEBUG = true;

const FAQ_ITEMS = [
  {
    q: 'What is Agendex?',
    a: "Agendex indexes the plan/todo files that AI coding agents create (like Claude Code's plan.md) and surfaces them in a single dashboard. Search, comment, share, and track plans across all your agents.",
  },
  {
    q: 'Which agents are supported?',
    a: 'Claude Code, Cursor, Codex CLI, Windsurf, Amp, Cline, GitHub Copilot, OpenCode, Continue, Aider, Droid, Kilo Code, Roo Code, Goose, Gemini CLI, and more. Adding a new agent is just implementing a single adapter interface.',
  },
  {
    q: 'Is my data private?',
    a: 'With self-hosted, your data never leaves your machine. With Cloud, plans are synced to your account and only accessible to you unless you explicitly share them.',
  },
  {
    q: 'Can I switch from self-hosted to Cloud later?',
    a: 'Yes. Install the CLI, run `agendex login`, and start the daemon. Your local plans sync to the cloud automatically — no migration needed.',
  },
  {
    q: 'Do I need to pay to use Agendex?',
    a: 'Self-hosted is completely free and open source. Cloud Pro is $7/month ($69/year) and includes cloud sync, sharing, comments, workspace collaboration for up to 5 members, and access from any device.',
  },
  {
    q: 'How does Cloud sync work?',
    a: 'The CLI daemon watches your local plan files and pushes changes to the cloud in real time. Plans are synced automatically — just run `agendex start`.',
  },
];

const AGENTS = [
  'Claude Code',
  'Cursor',
  'Codex',
  'Windsurf',
  'Amp',
  'Cline',
  'GitHub Copilot',
  'OpenCode',
  'Continue',
  'Aider',
  'Droid',
  'Kilo Code',
  'Roo Code',
  'Goose',
  'Gemini CLI',
];

const LOCAL_STEPS = [
  {
    number: '1',
    title: 'Clone & Install',
    code: `git clone https://github.com/Tyru5/agendex.git\ncd agendex && bun install`,
  },
  {
    number: '2',
    title: 'Start Dev Servers',
    code: `bun run dev          # API server :4890\nbun run dev:client   # Vite HMR  :5173`,
  },
  {
    number: '3',
    title: 'Connect',
    code: `# paste the auth token from your terminal`,
  },
];

const PKG_MANAGERS = [
  { id: 'bun', label: 'bun', cmd: 'bun install -g @agendex/cli' },
  { id: 'npm', label: 'npm', cmd: 'npm install -g @agendex/cli' },
  { id: 'yarn', label: 'yarn', cmd: 'yarn global add @agendex/cli' },
  { id: 'pnpm', label: 'pnpm', cmd: 'pnpm add -g @agendex/cli' },
] as const;

type CloudStep = {
  number: string;
  title: string;
  code?: string;
  render?: () => React.ReactNode;
};

const CLOUD_STEPS: CloudStep[] = [
  {
    number: '1',
    title: 'Install CLI',
    render: () => <PkgManagerInstall />,
  },
  {
    number: '2',
    title: 'Authenticate',
    code: `agendex login        # opens browser OAuth`,
  },
  {
    number: '3',
    title: 'Start Daemon',
    code: `agendex start        # watches + syncs plans`,
  },
];

function _Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <rect
        x="2"
        y="2"
        width="24"
        height="24"
        rx="6"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.5"
      />
      <rect x="7" y="7" width="6" height="6" rx="1.5" fill="currentColor" />
      <rect x="15" y="7" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.4" />
      <rect x="7" y="15" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.4" />
      <rect x="15" y="15" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.15" />
    </svg>
  );
}

function ArrowRight() {
  return (
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
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

function CopyIcon() {
  return (
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
  );
}

function CheckIcon() {
  return (
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
  );
}

function FaqItem({
  q,
  a,
  open,
  onToggle,
}: {
  q: string;
  a: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={`landing-faq-item ${open ? 'landing-faq-item-open' : ''}`}>
      <button type="button" className="landing-faq-q" onClick={onToggle} aria-expanded={open}>
        {q}
        <span className="landing-faq-icon" aria-hidden="true" />
      </button>
      <div className="landing-faq-body">
        <div className="landing-faq-body-inner">
          <p className="landing-faq-a">{a}</p>
        </div>
      </div>
    </div>
  );
}

function PkgManagerInstall() {
  const [activePkg, setActivePkg] = useState(PKG_MANAGERS[0].id);
  const [copied, setCopied] = useState(false);
  const cmd = PKG_MANAGERS.find((p) => p.id === activePkg)?.cmd;

  function copy() {
    navigator.clipboard.writeText(cmd);
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
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
      </div>
    </div>
  );
}

export function LandingPage() {
  const [token, setTokenValue] = useState('');
  const [showLogin, setShowLogin] = useState(false);
  const [showPricing, setShowPricing] = useState(false);
  const [activeTab, setActiveTab] = useState<'cloud' | 'local'>('local');
  const [pricingPeriod, setPricingPeriod] = useState<'monthly' | 'yearly'>('monthly');
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const { isAuthenticated } = useAuth();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (token.trim()) {
      setToken(token.trim());
      window.location.reload();
    }
  }

  function handleGetStarted() {
    if (isAuthenticated) {
      window.location.href = '/dashboard';
    } else if (activeTab === 'local') {
      setShowLogin(true);
    } else {
      setShowPricing(true);
    }
  }

  return (
    <div className="landing-page">
      {/* Hero — two-column */}
      <section className="landing-hero">
        <div className="landing-hero-left">
          <h1 className="landing-hero-title">
            One dashboard for
            <br />
            <span className="landing-hero-accent">every coding agent.</span>
          </h1>
          <p className="landing-hero-sub">
            Agendex indexes plans from all your AI coding agents in a single, unified interface.
            Search, comment, share, and sync to the cloud across Claude Code, Cursor, Codex,
            Windsurf, and <strong>{AGENTS.length - 4}+ more</strong>.
          </p>
          <div className="landing-hero-actions">
            <button
              type="button"
              className="landing-btn-primary landing-btn-lg"
              onClick={handleGetStarted}
            >
              Get Started <ArrowRight />
            </button>
            <a
              href="https://github.com/Tyru5/agendex"
              target="_blank"
              rel="noopener noreferrer"
              className="landing-btn-ghost landing-btn-lg"
            >
              <GitHubIcon /> GitHub
            </a>
          </div>
        </div>

        <div className="landing-hero-right">
          <div className="landing-steps-panel">
            <div className="landing-steps-tabs">
              <button
                type="button"
                className={`landing-steps-tab ${activeTab === 'local' ? 'landing-steps-tab-active' : ''}`}
                onClick={() => setActiveTab('local')}
              >
                🖥️ Self-Hosted
              </button>
              <button
                type="button"
                className={`landing-steps-tab ${activeTab === 'cloud' ? 'landing-steps-tab-active' : ''}`}
                onClick={() => setActiveTab('cloud')}
              >
                ☁️ Cloud
              </button>
            </div>
            {(activeTab === 'cloud' ? CLOUD_STEPS : LOCAL_STEPS).map((step) => (
              <div key={step.number} className="landing-step-block">
                <div className="landing-step-bar">
                  {step.number} — {step.title.toUpperCase()}
                </div>
                {'render' in step && step.render ? (
                  step.render()
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

      {/* Features */}
      <section className="landing-features-section">
        <h2 className="landing-section-title">Everything in one place.</h2>
        <div className="landing-features-grid">
          <div className="landing-feature-card">
            <div className="landing-feature-icon">⚡</div>
            <h3>Instant Indexing</h3>
            <p>
              File watchers detect new plans the moment your agents create them. No polling, no
              manual refresh.
            </p>
          </div>
          <div className="landing-feature-card">
            <div className="landing-feature-icon">🔗</div>
            <h3>Share Plans</h3>
            <p>
              Publish any plan to the cloud and generate shareable links. Control access with
              token-based permissions.
            </p>
          </div>
          <div className="landing-feature-card">
            <div className="landing-feature-icon">💬</div>
            <h3>Comments</h3>
            <p>
              Leave comments on any plan. Threaded discussions keep feedback attached to the plans
              that matter.
            </p>
          </div>
          <div className="landing-feature-card">
            <div className="landing-feature-icon">☁️</div>
            <h3>Cloud Sync</h3>
            <p>
              The CLI daemon watches local plans and syncs them to the cloud automatically. Access
              your plans from anywhere.
            </p>
          </div>
          <div className="landing-feature-card">
            <div className="landing-feature-icon">🔍</div>
            <h3>Fuzzy Search</h3>
            <p>
              Find any plan across all agents instantly with blazing-fast fuzzy search powered by
              Fuse.js.
            </p>
          </div>
          <div className="landing-feature-card">
            <div className="landing-feature-icon">🔌</div>
            <h3>Adapter System</h3>
            <p>
              Modular adapters for each agent source. Enable or disable agents on the fly with zero
              config.
            </p>
          </div>
        </div>
      </section>

      {/* Local vs Cloud */}
      <section className="landing-pricing-section">
        <h2 className="landing-section-title">Run it your way.</h2>
        <p className="landing-section-sub">
          Self-host for free or use our managed infrastructure for cloud sync, sharing, and
          collaboration.
        </p>

        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '40px' }}>
          <div
            style={{
              display: 'inline-flex',
              backgroundColor: 'var(--landing-surface)',
              border: '1px solid var(--landing-border)',
              borderRadius: '8px',
              padding: '4px',
              gap: '4px',
            }}
          >
            <button
              type="button"
              onClick={() => setPricingPeriod('monthly')}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                border: 'none',
                backgroundColor:
                  pricingPeriod === 'monthly' ? 'var(--landing-accent)' : 'transparent',
                color: pricingPeriod === 'monthly' ? '#000' : 'var(--landing-text)',
                fontWeight: pricingPeriod === 'monthly' ? 600 : 500,
                fontSize: '14px',
                cursor: 'pointer',
                transition: 'background-color 200ms ease, color 200ms ease, font-weight 200ms ease',
              }}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setPricingPeriod('yearly')}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                border: 'none',
                backgroundColor:
                  pricingPeriod === 'yearly' ? 'var(--landing-accent)' : 'transparent',
                color: pricingPeriod === 'yearly' ? '#000' : 'var(--landing-text)',
                fontWeight: pricingPeriod === 'yearly' ? 600 : 500,
                fontSize: '14px',
                cursor: 'pointer',
                transition: 'background-color 200ms ease, color 200ms ease, font-weight 200ms ease',
              }}
            >
              Yearly
            </button>
          </div>
        </div>

        <div className="landing-pricing-grid">
          <div className="landing-pricing-card">
            <div className="landing-pricing-badge">Free</div>
            <h3 className="landing-pricing-name">Self-Hosted</h3>
            <div className="landing-pricing-price">
              <span className="landing-pricing-amount">$0</span>
              <span className="landing-pricing-period">forever</span>
            </div>
            <p className="landing-pricing-desc">
              Clone the repo and run locally. Full control over your data and infrastructure.
            </p>
            <ul className="landing-pricing-list">
              <li>Local plan indexing &amp; search</li>
              <li>All agent adapters</li>
              <li>Full source access</li>
              <li>No accounts or dependencies</li>
            </ul>
            <a
              href="https://github.com/Tyru5/agendex"
              target="_blank"
              rel="noopener noreferrer"
              className="landing-btn-ghost landing-btn-lg landing-btn-full"
            >
              <GitHubIcon /> Clone &amp; Run
            </a>
          </div>
          <div className="landing-pricing-card landing-pricing-card-highlight">
            <div className="landing-pricing-badge landing-pricing-badge-accent">Pro</div>
            <h3 className="landing-pricing-name">Cloud</h3>
            <div className="landing-pricing-price">
              {pricingPeriod === 'monthly' ? (
                <>
                  <span className="landing-pricing-amount">$7</span>
                  <span className="landing-pricing-period">/month</span>
                </>
              ) : (
                <>
                  <span className="landing-pricing-amount">$69</span>
                  <span className="landing-pricing-period">/year</span>
                </>
              )}
            </div>
            {pricingPeriod === 'yearly' && (
              <p className="landing-pricing-annual">Save 18% vs monthly</p>
            )}
            <p className="landing-pricing-desc">
              Ready to go — no setup, no servers. Just install the CLI and start syncing.
            </p>
            <ul className="landing-pricing-list">
              <li>Everything in Self-Hosted</li>
              <li>Cloud sync via CLI daemon</li>
              <li>Shareable plan links</li>
              <li>Comment threads</li>
              <li>Up to 5 workspace members</li>
              <li>Access from any device</li>
            </ul>
            <a
              href="https://app.agendex.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="landing-btn-primary landing-btn-lg landing-btn-full"
            >
              Get Started <ArrowRight />
            </a>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="landing-faq-section">
        <h2 className="landing-section-title">Frequently asked questions.</h2>
        <div className="landing-faq-list">
          {FAQ_ITEMS.map((item, i) => (
            <FaqItem
              key={item.q}
              q={item.q}
              a={item.a}
              open={openFaq === i}
              onToggle={() => setOpenFaq(openFaq === i ? null : i)}
            />
          ))}
        </div>
      </section>

      {/* Login modal */}
      {showLogin && (
        <div
          role="dialog"
          aria-modal="true"
          className="landing-modal-overlay"
          onClick={() => setShowLogin(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setShowLogin(false);
          }}
        >
          <div
            className="landing-modal"
            role="document"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="landing-modal-close"
              onClick={() => setShowLogin(false)}
              aria-label="Close"
            >
              ✕
            </button>
            <h2 className="landing-modal-title">Connect to Agendex</h2>
            <p className="landing-modal-sub">
              Enter the auth token printed in your terminal when the server starts.
            </p>
            <form onSubmit={submit} className="landing-modal-form">
              <input
                type="password"
                value={token}
                onChange={(e) => setTokenValue(e.target.value)}
                placeholder="Paste your token"
                className="landing-modal-input"
                ref={(el) => el?.focus()}
              />
              <button type="submit" className="landing-btn-primary landing-btn-lg landing-btn-full">
                Connect <ArrowRight />
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Pricing modal */}
      {showPricing && <PricingModal onClose={() => setShowPricing(false)} />}
    </div>
  );
}
