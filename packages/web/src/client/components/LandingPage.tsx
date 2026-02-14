import { useState } from 'react';
import { setToken } from '../lib/api.ts';
import { WipMarquee } from './WipMarquee.tsx';

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

const STEPS = [
  {
    number: '1',
    title: 'Install & Start',
    code: `bun install\nbun run dev          # API server :4890\nbun run dev:client   # Vite HMR  :5173`,
  },
  {
    number: '2',
    title: 'Grab Your Token',
    code: `# printed on server start\n[agendex] token: abc123...`,
  },
  {
    number: '3',
    title: 'Open Dashboard',
    code: `# visit\nhttp://localhost:5173`,
  },
];

function Logo() {
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

export function LandingPage() {
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
    <div className="landing-page">
      <WipMarquee />

      {/* Hero — two-column */}
      <section className="landing-hero">
        <div className="landing-hero-left">
          <div className="landing-hero-badge">Free &amp; Open Source</div>
          <h1 className="landing-hero-title">
            One dashboard for
            <br />
            <span className="landing-hero-accent">every coding agent.</span>
          </h1>
          <p className="landing-hero-sub">
            Agendex indexes and displays plans from all your AI coding agents in a single, unified
            interface. Search, filter, and edit across Claude Code, Cursor, Codex, Windsurf, and{' '}
            <strong>{AGENTS.length - 4}+ more</strong>.
          </p>
          <div className="landing-hero-actions">
            <button
              type="button"
              className="landing-btn-primary landing-btn-lg"
              onClick={() => setShowLogin(true)}
            >
              Get Started <ArrowRight />
            </button>
            <a
              href="https://github.com/Tyru5/planfig"
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
            {STEPS.map((step) => (
              <div key={step.number} className="landing-step-block">
                <div className="landing-step-bar">
                  {step.number} — {step.title.toUpperCase()}
                </div>
                <pre className="landing-step-code">
                  <code>{step.code}</code>
                </pre>
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
            <div className="landing-feature-icon">🔍</div>
            <h3>Fuzzy Search</h3>
            <p>
              Find any plan across all agents instantly with blazing-fast fuzzy search powered by
              Fuse.js.
            </p>
          </div>
          <div className="landing-feature-card">
            <div className="landing-feature-icon">✏️</div>
            <h3>In-Place Editing</h3>
            <p>
              Edit plan markdown directly in the dashboard with a full-featured CodeMirror editor.
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

      {/* Login modal */}
      {showLogin && (
        <div className="landing-modal-overlay" onClick={() => setShowLogin(false)}>
          <div className="landing-modal" onClick={(e) => e.stopPropagation()}>
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
                autoFocus
              />
              <button type="submit" className="landing-btn-primary landing-btn-lg landing-btn-full">
                Connect <ArrowRight />
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
