import { dinoShadow, dinoVitaIdleStrip, startViewTransition } from '@agendex/web';
import { useEffect } from 'react';
import { useLocation } from 'wouter';

const DINO_SIZE = 84;
const DINO_FRAMES = 4;

type StepStatus = 'merged' | 'in-progress';

const PLAN_STEPS: Array<{
  label: string;
  status: StepStatus;
  statusLabel: string;
  title: string;
  paragraphs: string[];
}> = [
  {
    label: 'Builder',
    status: 'merged',
    statusLabel: 'merged',
    title: 'I build tools for the moments software starts to sprawl.',
    paragraphs: [
      'I am an adaptable software engineer who likes turning practical friction into clear, usable interfaces.',
      'I tend to notice the small decisions in a project: naming, state, layout, and the moment a useful workflow starts feeling harder than it should. Shipping Agendex beyond my own machine is part of that work.',
    ],
  },
  {
    label: 'Origin',
    status: 'merged',
    statusLabel: 'merged',
    title: 'Agendex started as a specific annoyance in agent-heavy coding.',
    paragraphs: [
      'Coding agents create a lot of plans, but those plans usually scatter across sessions, folders, and machines. The context is valuable, yet it becomes hard to search, compare, and revisit.',
      'Agendex gives those plans a proper workspace. You can inspect what agents intended, edit the work, organize it, and keep local files and cloud collaboration connected.',
    ],
  },
  {
    label: 'Direction',
    status: 'in-progress',
    statusLabel: 'in progress',
    title: 'The project is moving toward calmer coordination for agent work.',
    paragraphs: [
      'The next version of agent tooling should make intent easier to read, not bury people under another task board. I want Agendex to stay precise, fast, and useful when the amount of agent work grows.',
      'Contributions, sharp feedback, and real workflow stories are welcome. The best features usually start as a small point of friction someone can describe clearly.',
    ],
  },
];

const ACCEPTANCE_CRITERIA = [
  'Plans should stay readable after the fourth agent gets involved.',
  'Local work should feel connected to cloud collaboration, not replaced by it.',
  'Polish matters most on the screens people return to every day.',
];

function BackArrow() {
  return (
    <svg
      aria-hidden="true"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m4.5 12.5 5 5 10-11" />
    </svg>
  );
}

function MascotSprite() {
  return (
    <span aria-hidden="true" className="about-mascot">
      <img src={dinoShadow} alt="" className="about-mascot-shadow" />
      <span
        className="about-mascot-sprite"
        style={{
          width: `${DINO_SIZE}px`,
          height: `${DINO_SIZE}px`,
          backgroundImage: `url(${dinoVitaIdleStrip})`,
          backgroundSize: `${DINO_SIZE * DINO_FRAMES}px ${DINO_SIZE}px`,
          animation: `about-dino-idle 0.72s steps(${DINO_FRAMES}) infinite`,
        }}
      />
    </span>
  );
}

export function AboutMePage() {
  const [, navigate] = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="about-page">
      <style>{`
        @keyframes about-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes about-dino-idle {
          from { background-position: 0 0; }
          to { background-position: -${DINO_SIZE * DINO_FRAMES}px 0; }
        }

        .about-page {
          --about-bg: oklch(10% 0.032 178);
          --about-bg-deep: oklch(7% 0.028 178);
          --about-surface: oklch(14.5% 0.035 180);
          --about-raised: oklch(19% 0.038 178);
          --about-text: oklch(94.5% 0.016 128);
          --about-muted: oklch(70% 0.025 166);
          --about-faint: oklch(58% 0.025 168);
          --about-border: color-mix(in oklch, var(--about-text) 13%, transparent);
          --about-border-strong: color-mix(in oklch, var(--about-text) 21%, transparent);
          --about-grid: color-mix(in oklch, var(--about-text) 7%, transparent);
          --about-accent: oklch(90% 0.22 129);
          --about-accent-soft: color-mix(in oklch, var(--about-accent) 12%, transparent);
          --about-mono: "SF Mono", "JetBrains Mono", "Fira Code", ui-monospace, monospace;

          min-height: 100vh;
          position: relative;
          overflow-x: clip;
          background-color: var(--about-bg);
          background-image:
            repeating-linear-gradient(
              to right,
              transparent 0,
              transparent calc(25% - 1px),
              var(--about-grid) calc(25% - 1px),
              var(--about-grid) 25%
            ),
            repeating-linear-gradient(
              to bottom,
              transparent 0,
              transparent 159px,
              var(--about-grid) 160px
            );
          color: var(--about-text);
          font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
          letter-spacing: 0;
        }

        .about-page *,
        .about-page *::before,
        .about-page *::after {
          box-sizing: border-box;
        }

        .about-page::before {
          content: "";
          position: fixed;
          inset: 0;
          z-index: 0;
          pointer-events: none;
          opacity: 0.04;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='256' height='256'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' fill='%23041f1d' filter='url(%23n)'/%3E%3C/svg%3E");
          background-repeat: repeat;
          background-size: 256px 256px;
        }

        .about-page ::selection {
          background: color-mix(in oklch, var(--about-accent) 34%, transparent);
          color: var(--about-text);
        }

        .about-page a,
        .about-page button {
          -webkit-tap-highlight-color: transparent;
        }

        .about-page a:focus-visible,
        .about-page button:focus-visible {
          outline: 2px solid color-mix(in oklch, var(--about-accent) 72%, var(--about-text));
          outline-offset: 3px;
        }

        .about-shell {
          position: relative;
          z-index: 1;
          width: min(100%, 1180px);
          margin: 0 auto;
          padding: 24px 24px 84px;
        }

        .about-nav {
          min-height: 42px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          animation: about-in 0.42s cubic-bezier(0.22, 1, 0.36, 1) both;
        }

        .about-back {
          min-height: 38px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          border: 1px solid var(--about-border);
          border-radius: 8px;
          background: color-mix(in oklch, var(--about-surface) 72%, transparent);
          color: var(--about-muted);
          padding: 0 12px;
          font: inherit;
          font-size: 12.5px;
          font-weight: 700;
          cursor: pointer;
          transition:
            color 150ms cubic-bezier(0.22, 1, 0.36, 1),
            background 150ms cubic-bezier(0.22, 1, 0.36, 1),
            border-color 150ms cubic-bezier(0.22, 1, 0.36, 1),
            transform 150ms cubic-bezier(0.22, 1, 0.36, 1);
        }

        .about-back:hover {
          transform: translateY(-1px);
          border-color: var(--about-border-strong);
          background: var(--about-surface);
          color: var(--about-text);
        }

        .about-brand {
          color: var(--about-muted);
          font-size: 14px;
          font-weight: 700;
          letter-spacing: -0.01em;
          text-decoration: none;
        }

        .about-brand-dot {
          color: var(--about-accent);
        }

        .about-hero {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 320px;
          align-items: end;
          gap: 48px;
          padding: 76px 0 64px;
          border-bottom: 1px solid var(--about-border);
          animation: about-in 0.5s cubic-bezier(0.22, 1, 0.36, 1) 70ms both;
        }

        .about-provenance {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px 10px;
          color: var(--about-muted);
          font-family: var(--about-mono);
          font-size: 11.5px;
          line-height: 1.5;
        }

        .about-provenance-file {
          display: inline-flex;
          align-items: center;
          padding: 3px 8px;
          border: 1px solid color-mix(in oklch, var(--about-accent) 26%, var(--about-border));
          border-radius: 6px;
          background: color-mix(in oklch, var(--about-accent) 8%, transparent);
          color: var(--about-accent);
          font-weight: 600;
        }

        .about-provenance-sep {
          color: var(--about-faint);
        }

        .about-provenance-status {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        .about-provenance-status::before {
          content: "";
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--about-accent);
          box-shadow: 0 0 12px color-mix(in oklch, var(--about-accent) 45%, transparent);
        }

        .about-title {
          max-width: 790px;
          margin: 20px 0 0;
          color: var(--about-text);
          font-size: 64px;
          font-weight: 760;
          line-height: 0.98;
          letter-spacing: -0.035em;
          text-wrap: balance;
        }

        .about-title-link {
          color: inherit;
          text-decoration: underline;
          text-decoration-color: color-mix(in oklch, var(--about-text) 24%, transparent);
          text-decoration-thickness: 1px;
          text-underline-offset: 6px;
          transition:
            color 150ms cubic-bezier(0.22, 1, 0.36, 1),
            text-decoration-color 150ms cubic-bezier(0.22, 1, 0.36, 1);
        }

        .about-title-link:hover {
          color: var(--about-accent);
          text-decoration-color: color-mix(in oklch, var(--about-accent) 52%, transparent);
        }

        .about-title-dot {
          color: var(--about-accent);
        }

        .about-lead {
          max-width: 60ch;
          margin: 26px 0 0;
          color: var(--about-muted);
          font-size: 16px;
          line-height: 1.75;
          text-wrap: pretty;
        }

        .about-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 30px;
        }

        .about-link {
          min-height: 42px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 1px solid var(--about-border);
          border-radius: 8px;
          background: color-mix(in oklch, var(--about-surface) 72%, transparent);
          color: var(--about-text);
          padding: 0 14px;
          font-size: 12.5px;
          font-weight: 800;
          text-decoration: none;
          transition:
            background 150ms cubic-bezier(0.22, 1, 0.36, 1),
            border-color 150ms cubic-bezier(0.22, 1, 0.36, 1),
            transform 150ms cubic-bezier(0.22, 1, 0.36, 1);
        }

        .about-link:hover {
          transform: translateY(-1px);
          border-color: var(--about-border-strong);
          background: var(--about-surface);
        }

        .about-link-primary {
          border-color: color-mix(in oklch, var(--about-accent) 44%, transparent);
          background: var(--about-accent);
          color: var(--about-bg-deep);
        }

        .about-link-primary:hover {
          border-color: color-mix(in oklch, var(--about-accent) 62%, transparent);
          background: color-mix(in oklch, var(--about-accent) 92%, var(--about-text));
        }

        .about-dossier {
          border: 1px solid var(--about-border);
          border-radius: 8px;
          overflow: hidden;
          background: color-mix(in oklch, var(--about-surface) 82%, transparent);
          box-shadow: 0 18px 40px color-mix(in oklch, var(--about-bg-deep) 58%, transparent);
        }

        .about-mascot-stage {
          min-height: 178px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-bottom: 1px solid var(--about-border);
          background:
            linear-gradient(
              to bottom,
              color-mix(in oklch, var(--about-raised) 56%, transparent),
              color-mix(in oklch, var(--about-bg) 74%, transparent)
            );
        }

        .about-mascot {
          position: relative;
          display: block;
          width: ${DINO_SIZE}px;
          height: ${DINO_SIZE}px;
        }

        .about-mascot-shadow {
          position: absolute;
          left: 10px;
          bottom: -2px;
          width: 64px;
          image-rendering: pixelated;
          opacity: 0.58;
        }

        .about-mascot-sprite {
          position: relative;
          display: block;
          overflow: hidden;
          background-repeat: no-repeat;
          background-position: 0 0;
          image-rendering: pixelated;
          filter: drop-shadow(0 14px 24px oklch(7% 0.02 178 / 0.36));
        }

        .about-dossier-body {
          padding: 15px;
        }

        .about-dossier-heading {
          margin: 0 0 12px;
          color: var(--about-text);
          font-size: 13px;
          font-weight: 800;
          line-height: 1.25;
        }

        .about-dossier-row {
          display: grid;
          grid-template-columns: 86px minmax(0, 1fr);
          gap: 12px;
          border-top: 1px solid var(--about-border);
          padding: 10px 0;
        }

        .about-dossier-row:first-of-type {
          border-top: 0;
        }

        .about-dossier-term {
          color: var(--about-faint);
          font-family: var(--about-mono);
          font-size: 11.5px;
          line-height: 1.5;
        }

        .about-dossier-value {
          min-width: 0;
          color: var(--about-muted);
          font-size: 12.5px;
          font-weight: 700;
          line-height: 1.5;
        }

        .about-plan {
          display: grid;
          grid-template-columns: 210px minmax(0, 1fr);
          gap: 54px;
          padding: 70px 0 78px;
          border-bottom: 1px solid var(--about-border);
        }

        .about-section-label {
          margin: 0;
          color: var(--about-faint);
          font-size: 12px;
          font-weight: 800;
          line-height: 1.4;
        }

        .about-section-sublabel {
          margin: 8px 0 0;
          max-width: 24ch;
          color: var(--about-faint);
          font-size: 12px;
          font-weight: 450;
          line-height: 1.6;
        }

        .about-steps {
          position: relative;
          margin: 0;
          padding: 0;
          list-style: none;
        }

        .about-steps::before {
          content: "";
          position: absolute;
          left: 6px;
          top: 14px;
          bottom: 14px;
          width: 1px;
          background: var(--about-border);
        }

        .about-step {
          position: relative;
          display: grid;
          grid-template-columns: 34px minmax(0, 1fr);
          padding: 0 0 46px;
        }

        .about-step:last-child {
          padding-bottom: 0;
        }

        .about-step-marker {
          position: relative;
          z-index: 1;
          width: 13px;
          height: 13px;
          margin-top: 5px;
          border-radius: 50%;
          background: var(--about-accent);
          border: 1.5px solid var(--about-accent);
          box-shadow: 0 0 0 4px var(--about-bg);
        }

        .about-step[data-status="in-progress"] .about-step-marker {
          background: var(--about-bg);
        }

        .about-step-meta {
          display: flex;
          align-items: baseline;
          gap: 12px;
        }

        .about-step-label {
          color: var(--about-text);
          font-family: var(--about-mono);
          font-size: 12px;
          font-weight: 700;
        }

        .about-step-status {
          color: var(--about-faint);
          font-family: var(--about-mono);
          font-size: 11px;
        }

        .about-step[data-status="in-progress"] .about-step-status {
          color: var(--about-accent);
        }

        .about-step-title {
          max-width: 680px;
          margin: 12px 0 0;
          color: var(--about-text);
          font-size: 25px;
          font-weight: 760;
          line-height: 1.22;
          letter-spacing: -0.015em;
          text-wrap: balance;
        }

        .about-step-copy {
          max-width: 62ch;
          margin: 16px 0 0;
          color: var(--about-muted);
          font-size: 15px;
          line-height: 1.78;
          text-wrap: pretty;
        }

        .about-step-copy p {
          margin: 0;
        }

        .about-step-copy p + p {
          margin-top: 15px;
        }

        .about-criteria {
          display: grid;
          grid-template-columns: 210px minmax(0, 1fr);
          gap: 54px;
          padding: 66px 0 74px;
          border-bottom: 1px solid var(--about-border);
        }

        .about-criteria-title {
          max-width: 650px;
          margin: 0 0 22px;
          color: var(--about-text);
          font-size: 28px;
          font-weight: 780;
          line-height: 1.2;
          letter-spacing: -0.02em;
          text-wrap: balance;
        }

        .about-criteria-list {
          margin: 0;
          padding: 0;
          border-top: 1px solid var(--about-border);
          list-style: none;
        }

        .about-criterion {
          display: grid;
          grid-template-columns: 24px minmax(0, 1fr);
          gap: 14px;
          align-items: start;
          border-bottom: 1px solid var(--about-border);
          padding: 18px 0;
          color: var(--about-muted);
          font-size: 14px;
          font-weight: 650;
          line-height: 1.6;
        }

        .about-criterion-check {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 20px;
          height: 20px;
          margin-top: 1px;
          border: 1px solid color-mix(in oklch, var(--about-accent) 38%, var(--about-border));
          border-radius: 6px;
          background: var(--about-accent-soft);
          color: var(--about-accent);
        }

        .about-footer {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 320px;
          gap: 48px;
          padding-top: 40px;
          color: var(--about-muted);
        }

        .about-footer-message {
          max-width: 600px;
          margin: 0;
          font-size: 15px;
          line-height: 1.75;
        }

        .about-footer-meta {
          margin: 0;
          color: var(--about-faint);
          font-size: 11.5px;
          line-height: 1.6;
        }

        .about-footer-meta a {
          color: var(--about-muted);
          text-decoration: underline;
          text-decoration-color: color-mix(in oklch, var(--about-muted) 34%, transparent);
          text-underline-offset: 3px;
          transition: color 150ms cubic-bezier(0.22, 1, 0.36, 1);
        }

        .about-footer-meta a:hover {
          color: var(--about-accent);
        }

        @media (max-width: 980px) {
          .about-shell {
            padding-inline: 20px;
          }

          .about-hero,
          .about-plan,
          .about-criteria,
          .about-footer {
            grid-template-columns: 1fr;
          }

          .about-hero {
            gap: 38px;
            padding-top: 62px;
          }

          .about-title {
            font-size: 52px;
          }

          .about-dossier {
            max-width: 420px;
          }

          .about-plan,
          .about-criteria {
            gap: 24px;
          }
        }

        @media (max-width: 640px) {
          .about-shell {
            padding: 18px 16px 62px;
          }

          .about-nav {
            align-items: flex-start;
          }

          .about-brand {
            padding-top: 10px;
          }

          .about-hero {
            padding: 50px 0 48px;
          }

          .about-title {
            font-size: 38px;
            line-height: 1.04;
            letter-spacing: -0.03em;
          }

          .about-lead {
            font-size: 14.5px;
          }

          .about-actions {
            flex-direction: column;
          }

          .about-link {
            width: 100%;
          }

          .about-dossier {
            max-width: none;
          }

          .about-plan,
          .about-criteria {
            padding: 52px 0 58px;
          }

          .about-step {
            grid-template-columns: 28px minmax(0, 1fr);
            padding-bottom: 40px;
          }

          .about-step-title {
            font-size: 21px;
          }

          .about-criteria-title {
            font-size: 24px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .about-page *,
          .about-page *::before,
          .about-page *::after {
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            scroll-behavior: auto !important;
            transition-duration: 0.01ms !important;
          }

          .about-mascot-sprite {
            animation: none !important;
          }
        }
      `}</style>

      <main className="about-shell">
        <nav className="about-nav" aria-label="About page navigation">
          <button
            type="button"
            onClick={() => startViewTransition(() => navigate('/'))}
            className="about-back"
          >
            <BackArrow />
            Back to Agendex
          </button>

          <a className="about-brand" href="/">
            Agendex<span className="about-brand-dot">.</span>
          </a>
        </nav>

        <header className="about-hero">
          <div>
            <p className="about-provenance">
              <span className="about-provenance-file">maintainer-note.md</span>
              <span className="about-provenance-sep" aria-hidden="true">
                /
              </span>
              <span>human-authored</span>
              <span className="about-provenance-sep" aria-hidden="true">
                /
              </span>
              <span className="about-provenance-status">actively maintained</span>
            </p>

            <h1 className="about-title">
              Hi, I&apos;m{' '}
              <a
                href="https://tiru5.me"
                target="_blank"
                rel="noreferrer"
                className="about-title-link"
              >
                Ti
              </a>
              <span className="about-title-dot">.</span>
            </h1>

            <p className="about-lead">
              Agendex came from a real workflow problem: coding agents make useful plans, but those
              plans need a place to stay readable, searchable, and worth returning to.
            </p>

            <div className="about-actions" aria-label="About Ti links">
              <a
                href="https://github.com/tiru5/agendex"
                target="_blank"
                rel="noreferrer"
                className="about-link about-link-primary"
              >
                View the project
              </a>
              <a href="https://tiru5.me" target="_blank" rel="noreferrer" className="about-link">
                Visit tiru5.me
              </a>
            </div>
          </div>

          <aside className="about-dossier" aria-label="Project note">
            <div className="about-mascot-stage">
              <MascotSprite />
            </div>
            <div className="about-dossier-body">
              <h2 className="about-dossier-heading">Project file</h2>
              <div className="about-dossier-row">
                <span className="about-dossier-term">Author</span>
                <span className="about-dossier-value">Ti, software engineer</span>
              </div>
              <div className="about-dossier-row">
                <span className="about-dossier-term">Focus</span>
                <span className="about-dossier-value">Agent plans, provenance, collaboration</span>
              </div>
              <div className="about-dossier-row">
                <span className="about-dossier-term">Mood</span>
                <span className="about-dossier-value">
                  Calm tool room, sharp edges, low ceremony
                </span>
              </div>
            </div>
          </aside>
        </header>

        <section className="about-plan" aria-labelledby="about-plan-title">
          <div>
            <h2 id="about-plan-title" className="about-section-label">
              The plan so far
            </h2>
            <p className="about-section-sublabel">
              Three steps, tracked the way Agendex tracks any plan.
            </p>
          </div>

          <ol className="about-steps">
            {PLAN_STEPS.map((step) => (
              <li key={step.label} className="about-step" data-status={step.status}>
                <span className="about-step-marker" aria-hidden="true" />
                <div>
                  <div className="about-step-meta">
                    <span className="about-step-label">{step.label}</span>
                    <span className="about-step-status">{step.statusLabel}</span>
                  </div>
                  <h3 className="about-step-title">{step.title}</h3>
                  <div className="about-step-copy">
                    {step.paragraphs.map((paragraph) => (
                      <p key={paragraph}>{paragraph}</p>
                    ))}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="about-criteria" aria-labelledby="about-criteria-label">
          <h2 id="about-criteria-label" className="about-section-label">
            Acceptance criteria
          </h2>

          <div>
            <p className="about-criteria-title">
              I want this to feel useful before it feels impressive.
            </p>

            <ul className="about-criteria-list">
              {ACCEPTANCE_CRITERIA.map((criterion) => (
                <li key={criterion} className="about-criterion">
                  <span className="about-criterion-check" aria-hidden="true">
                    <CheckIcon />
                  </span>
                  <span>{criterion}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <footer className="about-footer">
          <p className="about-footer-message">
            Thanks for checking out Agendex. Every issue, contribution, and workflow note helps
            shape the tool into something more useful for people building with agents.
          </p>

          <p className="about-footer-meta">
            Mascot sprite by{' '}
            <a href="https://arks.itch.io/dino-characters" target="_blank" rel="noreferrer">
              Arks
            </a>
            , CC BY 4.0.
          </p>
        </footer>
      </main>
    </div>
  );
}
