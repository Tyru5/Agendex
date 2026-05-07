import { useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import changelogMarkdown from '../../../../cli/CHANGELOG.md?raw';
import { TopoNeurons } from './landing/TopoNeurons.tsx';

export interface ChangelogPageProps {
  /** Called when the user activates the back link in the header. */
  onBack?: () => void;
  /** Path the brand mark + back affordance link to. Defaults to "/". */
  homeHref?: string;
}

type Tier = 'major' | 'minor' | 'patch';

interface ChangeNote {
  hash?: string;
  description: string;
}

interface ChangeSection {
  heading: string;
  tier: Tier;
  notes: ChangeNote[];
  trailing: string;
}

interface ChangelogEntry {
  version: string;
  topTier: Tier;
  sections: ChangeSection[];
}

interface ParsedChangelog {
  packageName: string;
  entries: ChangelogEntry[];
}

const TIER_RANK: Record<Tier, number> = { major: 3, minor: 2, patch: 1 };

function tierFromHeading(heading: string): Tier {
  const lower = heading.toLowerCase();
  if (lower.includes('major')) return 'major';
  if (lower.includes('patch')) return 'patch';
  return 'minor';
}

const BULLET_RE = /^\s*[-*]\s+(.*)$/;
const HASH_PREFIX_RE = /^([0-9a-f]{6,12}):\s+(.+)$/i;

function parseSectionBody(body: string): { notes: ChangeNote[]; trailing: string } {
  const notes: ChangeNote[] = [];
  const trailingLines: string[] = [];
  const lines = body.split(/\r?\n/);
  let currentNote: ChangeNote | null = null;

  for (const raw of lines) {
    const bulletMatch = raw.match(BULLET_RE);
    if (bulletMatch) {
      if (currentNote) notes.push(currentNote);
      const inner = bulletMatch[1] ?? '';
      const hashMatch = inner.match(HASH_PREFIX_RE);
      currentNote = hashMatch
        ? { hash: hashMatch[1], description: (hashMatch[2] ?? '').trim() }
        : { description: inner.trim() };
      continue;
    }

    if (currentNote) {
      if (/^\s+\S/.test(raw)) {
        currentNote.description += `\n${raw.trim()}`;
        continue;
      }
      if (!raw.trim()) {
        notes.push(currentNote);
        currentNote = null;
        continue;
      }
    }

    if (raw.trim()) trailingLines.push(raw);
  }

  if (currentNote) notes.push(currentNote);
  return { notes, trailing: trailingLines.join('\n').trim() };
}

function parseChangelog(raw: string): ParsedChangelog {
  const lines = raw.split(/\r?\n/);
  let packageName = '';
  let i = 0;

  while (i < lines.length && !lines[i]?.trim()) i++;
  if (lines[i]?.startsWith('# ')) {
    packageName = lines[i]!.slice(2).trim();
    i++;
  }

  const entries: ChangelogEntry[] = [];
  let currentEntry: ChangelogEntry | null = null;
  let currentHeading = '';
  let buffer: string[] = [];

  function flushSection() {
    if (currentEntry && currentHeading) {
      const tier = tierFromHeading(currentHeading);
      const { notes, trailing } = parseSectionBody(buffer.join('\n'));
      currentEntry.sections.push({ heading: currentHeading, tier, notes, trailing });
      if (TIER_RANK[tier] > TIER_RANK[currentEntry.topTier]) {
        currentEntry.topTier = tier;
      }
    }
    currentHeading = '';
    buffer = [];
  }

  function flushEntry() {
    flushSection();
    if (currentEntry) entries.push(currentEntry);
    currentEntry = null;
  }

  for (; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.startsWith('## ')) {
      flushEntry();
      currentEntry = { version: line.slice(3).trim(), topTier: 'patch', sections: [] };
    } else if (line.startsWith('### ')) {
      flushSection();
      currentHeading = line.slice(4).trim();
    } else if (currentHeading) {
      buffer.push(line);
    }
  }
  flushEntry();

  return { packageName: packageName || 'agendex-cli', entries };
}

const TIER_LABEL: Record<Tier, string> = {
  major: 'Breaking',
  minor: 'Feature',
  patch: 'Patch',
};

/**
 * Tier coloring stays **tonal only** to honor the Rare Signal Rule:
 * acid-lime is reserved for current-state / primary action,
 * signal-orange for conversion. Tiers differ by ivory weight + glyph.
 */
function TierBadge({ tier }: { tier: Tier }) {
  const styles = {
    major: {
      color: 'var(--landing-text)',
      borderColor: 'color-mix(in oklch, var(--landing-text) 38%, transparent)',
      background: 'color-mix(in oklch, var(--landing-surface-raised) 90%, transparent)',
    },
    minor: {
      color: 'var(--landing-text)',
      borderColor: 'var(--landing-border)',
      background: 'transparent',
    },
    patch: {
      color: 'var(--landing-muted)',
      borderColor: 'color-mix(in oklch, var(--landing-border) 70%, transparent)',
      background: 'transparent',
    },
  } satisfies Record<Tier, React.CSSProperties>;

  return (
    <span
      className="inline-flex items-center gap-[5px] rounded-[5px] border px-[7px] py-[2px] font-[Inter,ui-sans-serif,system-ui] text-[10.5px] font-[650] uppercase leading-none tracking-[0.08em]"
      style={styles[tier]}
    >
      <span aria-hidden="true">{tier === 'major' ? '◆' : tier === 'minor' ? '○' : '·'}</span>
      {TIER_LABEL[tier]}
    </span>
  );
}

export function ChangelogPage({ onBack, homeHref = '/' }: ChangelogPageProps = {}) {
  const parsed = useMemo(() => parseChangelog(changelogMarkdown), []);
  const latest = parsed.entries[0];
  const releaseCount = parsed.entries.length;

  function handleBack(e: React.MouseEvent<HTMLAnchorElement>) {
    if (!onBack) return;
    if (e.defaultPrevented) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    onBack();
  }

  return (
    <div className="changelog-page landing-page relative min-h-screen bg-[var(--landing-bg)] text-[var(--landing-text)]">
      <TopoNeurons />

      {/* MINIMAL NAVBAR — mirrors LandingNavbar's brand mark + back affordance. */}
      <nav className="relative z-[2] border-b border-[var(--landing-border)] bg-[color-mix(in_oklch,var(--landing-bg)_88%,transparent)] backdrop-blur-[14px]">
        <div className="flex min-h-16 items-center justify-between gap-5 px-[clamp(20px,5vw,88px)] max-sm:min-h-[58px] max-sm:px-4">
          <a
            href={homeHref}
            onClick={handleBack}
            className="shrink-0 font-[Unbounded,Inter,system-ui,sans-serif] text-[15px] font-[430] text-[var(--landing-text)] no-underline"
          >
            Agendex<span className="text-[var(--landing-accent)]">.</span>
          </a>
          <a
            href={homeHref}
            onClick={handleBack}
            className="inline-flex min-h-[38px] items-center gap-2 rounded-[8px] border border-[var(--landing-border)] bg-[color-mix(in_oklch,var(--landing-surface)_76%,transparent)] px-[13px] text-[12.5px] font-[600] text-[var(--landing-text)] no-underline transition-[background-color,border-color,color] duration-150 hover:border-[var(--landing-border-strong)] hover:bg-[var(--landing-surface-raised)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--landing-accent)]"
          >
            <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none">
              <path
                d="M19 12H5M12 5l-7 7 7 7"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Back
          </a>
        </div>
      </nav>

      <main className="relative z-[1] mx-auto max-w-[920px] px-[clamp(20px,5vw,88px)] pt-12 pb-20 max-sm:px-4 max-sm:pt-8 max-sm:pb-12">
        {/* HEADER — editorial moment, Display token earns its place. */}
        <header className="mb-10 max-sm:mb-7">
          <div className="font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace] text-[11px] font-[500] uppercase tracking-[0.16em] text-[var(--landing-muted)]">
            {parsed.packageName} / Releases
          </div>
          <h1 className="mt-[14px] mb-0 font-[Unbounded,Inter,system-ui,sans-serif] text-[clamp(34px,5vw,52px)] font-[430] leading-[1.04] tracking-[-0.02em] text-[var(--landing-text)]">
            CLI Changelog<span className="text-[var(--landing-accent)]">.</span>
          </h1>
          <p className="mt-4 mb-0 max-w-[58ch] text-[14px] font-[450] leading-[1.6] text-[var(--landing-muted)]">
            Release notes for the{' '}
            <code className="rounded-[4px] border border-[var(--landing-border)] bg-[color-mix(in_oklch,var(--landing-surface-raised)_72%,transparent)] px-[5px] py-[1px] font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace] text-[12.5px] text-[var(--landing-text)]">
              agendex-cli
            </code>{' '}
            package, generated from Changesets and shipped to npm.
          </p>

          {/* Stat strip — 1px hairline grid as architecture. */}
          <dl className="mt-7 grid grid-cols-3 gap-px overflow-hidden rounded-[8px] border border-[var(--landing-border)] bg-[var(--landing-border)] max-sm:grid-cols-1">
            <Stat
              label="Latest"
              value={latest ? `v${latest.version}` : '—'}
              tone={latest ? 'accent' : 'muted'}
            />
            <Stat label="Releases" value={String(releaseCount)} />
            <Stat label="Top tier" value={latest ? TIER_LABEL[latest.topTier] : '—'} tone="muted" />
          </dl>
        </header>

        {/* RELEASE LIST — hairline-separated rows, editorial 2-column rhythm. */}
        {parsed.entries.length === 0 ? (
          <div className="rounded-[10px] border border-[var(--landing-border)] bg-[color-mix(in_oklch,var(--landing-surface)_60%,transparent)] px-8 py-16 text-center">
            <div className="m-auto inline-flex h-12 w-12 items-center justify-center rounded-full border border-[var(--landing-border)] text-[var(--landing-muted)]">
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path
                  d="M4 6h16M4 12h10M4 18h16"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <p className="mt-4 mb-0 text-[13.5px] leading-[1.55] text-[var(--landing-muted)]">
              No releases recorded yet.
            </p>
          </div>
        ) : (
          <ol className="m-0 list-none border-t border-[var(--landing-border)] p-0">
            {parsed.entries.map((entry, index) => (
              <li
                key={entry.version}
                className="grid grid-cols-[200px_minmax(0,1fr)] gap-x-10 gap-y-3 border-b border-[var(--landing-border)] py-7 max-sm:grid-cols-1 max-sm:gap-x-0 max-sm:gap-y-3 max-sm:py-5"
              >
                {/* Left rail: version + tier */}
                <div className="flex flex-col gap-3 max-sm:flex-row max-sm:items-baseline max-sm:justify-between">
                  <div className="flex items-baseline gap-2.5">
                    <span
                      aria-hidden="true"
                      className="font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace] text-[10.5px] font-[600] tabular-nums text-[var(--landing-faint)]"
                    >
                      {String(parsed.entries.length - index).padStart(2, '0')}
                    </span>
                    <h2 className="m-0 font-[Unbounded,Inter,system-ui,sans-serif] text-[24px] font-[430] leading-[1.0] tracking-[-0.01em] text-[var(--landing-text)]">
                      {entry.version}
                    </h2>
                  </div>
                  <div>
                    <TierBadge tier={entry.topTier} />
                  </div>
                </div>

                {/* Right column: sections */}
                <div className="flex min-w-0 flex-col gap-5">
                  {entry.sections.length === 0 ? (
                    <p className="m-0 text-[13.5px] leading-[1.55] text-[var(--landing-muted)]">
                      No notes recorded.
                    </p>
                  ) : (
                    entry.sections.map((section) => (
                      <section key={section.heading} className="min-w-0">
                        <header className="mb-2.5 flex items-baseline gap-2.5">
                          <span
                            aria-hidden="true"
                            className="h-px w-5 bg-[var(--landing-border)]"
                          />
                          <span className="font-[Inter,ui-sans-serif,system-ui] text-[11px] font-[650] uppercase tracking-[0.1em] text-[var(--landing-muted)]">
                            {section.heading}
                          </span>
                        </header>

                        {section.notes.length > 0 && (
                          <ul className="m-0 flex list-none flex-col gap-2 p-0">
                            {section.notes.map((note, noteIndex) => (
                              <li
                                key={`${entry.version}-${section.heading}-${noteIndex}`}
                                className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-3 max-sm:grid-cols-1 max-sm:gap-1"
                              >
                                {note.hash ? (
                                  <code
                                    className="select-all justify-self-start rounded-[4px] border border-[var(--landing-border)] bg-[color-mix(in_oklch,var(--landing-surface-raised)_72%,transparent)] px-[7px] py-[2px] font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace] text-[11.5px] font-[500] tabular-nums text-[var(--landing-muted)]"
                                    title={`Commit ${note.hash}`}
                                  >
                                    {note.hash}
                                  </code>
                                ) : (
                                  <span aria-hidden="true" />
                                )}
                                <div className="changelog-note-body min-w-0 text-[14px] font-[450] leading-[1.6] text-[var(--landing-text)]">
                                  <Markdown remarkPlugins={[remarkGfm]}>
                                    {note.description}
                                  </Markdown>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}

                        {section.trailing && (
                          <div className="changelog-note-body mt-2 text-[14px] font-[450] leading-[1.6] text-[var(--landing-text)]">
                            <Markdown remarkPlugins={[remarkGfm]}>{section.trailing}</Markdown>
                          </div>
                        )}
                      </section>
                    ))
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}

        <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--landing-border)] pt-5 text-[12px] text-[var(--landing-muted)] max-sm:mt-7">
          <span className="font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace] text-[10.5px] font-[500] uppercase tracking-[0.14em]">
            {parsed.packageName} / changelog
          </span>
          <a
            href="https://github.com/Tyru5/Agendex/blob/main/packages/cli/CHANGELOG.md"
            target="_blank"
            rel="noopener noreferrer"
            className="font-[Inter,ui-sans-serif,system-ui] text-[12px] font-[600] text-[var(--landing-muted)] no-underline transition-colors duration-150 hover:text-[var(--landing-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--landing-accent)]"
          >
            Source on GitHub →
          </a>
        </footer>
      </main>

      <style>{`
        .changelog-note-body p { margin: 0; }
        .changelog-note-body p + p { margin-top: 4px; }
        .changelog-note-body code {
          font-family: 'SF Mono', 'JetBrains Mono', ui-monospace, monospace;
          font-size: 12.5px;
          padding: 0 5px;
          border-radius: 4px;
          background: color-mix(in oklch, var(--landing-surface-raised) 72%, transparent);
          border: 1px solid var(--landing-border);
          color: var(--landing-text);
        }
        .changelog-note-body a {
          color: var(--landing-text);
          text-decoration: underline;
          text-decoration-color: color-mix(in oklch, var(--landing-accent) 50%, transparent);
          text-underline-offset: 3px;
          transition: text-decoration-color 150ms ease-out;
        }
        .changelog-note-body a:hover { text-decoration-color: var(--landing-accent); }
        .changelog-note-body ul,
        .changelog-note-body ol { margin: 4px 0 0; padding-left: 18px; }
      `}</style>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'muted' | 'accent';
}) {
  const valueColor = tone === 'muted' ? 'var(--landing-muted)' : 'var(--landing-text)';
  return (
    <div className="bg-[color-mix(in_oklch,var(--landing-bg)_70%,transparent)] px-4 py-3.5">
      <dt className="font-[Inter,ui-sans-serif,system-ui] text-[10.5px] font-[650] uppercase tracking-[0.1em] text-[var(--landing-muted)]">
        {label}
      </dt>
      <dd
        className="mt-[3px] font-[Inter,ui-sans-serif,system-ui] text-[15px] font-[600] tabular-nums leading-[1.2]"
        style={{ color: valueColor }}
      >
        {value}
        {tone === 'accent' && (
          <span className="ml-1 text-[var(--landing-accent)]" aria-hidden="true">
            ·
          </span>
        )}
      </dd>
    </div>
  );
}
