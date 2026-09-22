import { useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import changelogMarkdown from '../../../../cli/CHANGELOG.md?raw';
import { InlineCode, SubpageHeader, SubpageShell, TextLink } from './landing/SubpageShell.tsx';

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
  preamble: string;
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
  let preambleBuffer: string[] = [];
  let buffer: string[] = [];

  function flushPreamble() {
    if (currentEntry && preambleBuffer.length > 0) {
      currentEntry.preamble = preambleBuffer.join('\n').trim();
    }
    preambleBuffer = [];
  }

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
    flushPreamble();
    if (currentEntry) entries.push(currentEntry);
    currentEntry = null;
  }

  for (; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.startsWith('## ')) {
      flushEntry();
      currentEntry = {
        version: line.slice(3).trim(),
        topTier: 'patch',
        preamble: '',
        sections: [],
      };
    } else if (line.startsWith('### ')) {
      flushPreamble();
      flushSection();
      currentHeading = line.slice(4).trim();
    } else if (currentHeading) {
      buffer.push(line);
    } else if (currentEntry) {
      preambleBuffer.push(line);
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
 * Release dates sourced from the Changesets "Release agendex-cli" commits
 * (`git log packages/cli/CHANGELOG.md`). When a new release ships, append
 * its `version → ISO date` here so the changelog page can render it.
 */
const RELEASE_DATES: Record<string, string> = {
  '0.16.0': '2026-04-30',
  '0.15.0': '2026-04-29',
  '0.14.0': '2026-04-27',
  '0.13.0': '2026-04-24',
  '0.12.0': '2026-04-16',
  '0.11.0': '2026-04-10',
  '0.10.1': '2026-04-07',
  '0.10.0': '2026-04-03',
  '0.9.1': '2026-04-01',
  '0.9.0': '2026-04-01',
  '0.8.5': '2026-03-31',
  '0.8.4': '2026-03-31',
  '0.8.3': '2026-03-27',
  '0.8.2': '2026-03-27',
  '0.8.1': '2026-03-27',
  '0.8.0': '2026-03-27',
  '0.7.0': '2026-03-23',
  '0.6.0': '2026-03-20',
  '0.5.0': '2026-03-20',
  '0.4.0': '2026-03-19',
  '0.3.2': '2026-03-19',
  '0.3.1': '2026-03-19',
  '0.3.0': '2026-03-18',
  '0.2.0': '2026-03-14',
};

const RELEASE_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

function formatReleaseDate(version: string): { display: string; iso: string } | null {
  const iso = RELEASE_DATES[version];
  if (!iso) return null;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return { display: RELEASE_DATE_FORMATTER.format(parsed), iso };
}

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
      className="inline-flex items-center rounded-[5px] border px-[7px] py-[3px] text-[11px] font-[600] leading-none"
      style={styles[tier]}
    >
      {TIER_LABEL[tier]}
    </span>
  );
}

export function ChangelogPage({ onBack, homeHref = '/' }: ChangelogPageProps = {}) {
  const parsed = useMemo(() => parseChangelog(changelogMarkdown), []);
  const latest = parsed.entries[0];
  const releaseCount = parsed.entries.length;
  const latestReleased = latest ? formatReleaseDate(latest.version) : null;

  return (
    <SubpageShell pageClass="changelog-page" onBack={onBack} homeHref={homeHref}>
      <SubpageHeader
        title="CLI changelog"
        lede={
          <>
            Release notes for the <InlineCode>agendex-cli</InlineCode> package, generated from
            Changesets and published to npm.
          </>
        }
        meta={
          latest ? (
            <>
              Latest release{' '}
              <span className="font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace] text-[var(--landing-text)]">
                v{latest.version}
              </span>
              {latestReleased && (
                <>
                  {' '}
                  · <time dateTime={latestReleased.iso}>{latestReleased.display}</time>
                </>
              )}{' '}
              · {releaseCount} releases
            </>
          ) : undefined
        }
      />

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
          {parsed.entries.map((entry) => {
            const released = formatReleaseDate(entry.version);
            return (
              <li
                key={entry.version}
                className="grid grid-cols-[200px_minmax(0,1fr)] gap-x-10 gap-y-3 border-b border-[var(--landing-border)] py-7 max-sm:grid-cols-1 max-sm:gap-x-0 max-sm:gap-y-3 max-sm:py-5"
              >
                <div className="flex flex-col gap-2 max-sm:flex-row max-sm:flex-wrap max-sm:items-baseline max-sm:justify-between max-sm:gap-x-3">
                  <h2 className="m-0 text-[22px] font-[740] leading-[1.0] tracking-[-0.02em] tabular-nums text-[var(--landing-text)]">
                    {entry.version}
                  </h2>
                  {released && (
                    <time
                      dateTime={released.iso}
                      className="text-[12.5px] font-[500] text-[var(--landing-muted)]"
                    >
                      {released.display}
                    </time>
                  )}
                  <div>
                    <TierBadge tier={entry.topTier} />
                  </div>
                </div>

                <div className="flex min-w-0 flex-col gap-5">
                  {entry.preamble && (
                    <div className="changelog-note-body max-w-[68ch] text-[14px] font-[450] leading-[1.6] text-[var(--landing-text)]">
                      <Markdown remarkPlugins={[remarkGfm]}>{entry.preamble}</Markdown>
                    </div>
                  )}

                  {entry.sections.length === 0 && !entry.preamble ? (
                    <p className="m-0 text-[13.5px] leading-[1.55] text-[var(--landing-muted)]">
                      No notes recorded.
                    </p>
                  ) : (
                    entry.sections.map((section) => (
                      <section key={section.heading} className="min-w-0">
                        <h3 className="mb-2 mt-0 text-[12.5px] font-[650] text-[var(--landing-muted)]">
                          {section.heading}
                        </h3>

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
            );
          })}
        </ol>
      )}

      <p className="mt-8 mb-0 text-[12.5px] text-[var(--landing-muted)]">
        Generated from{' '}
        <TextLink href="https://github.com/tyru5/agendex/blob/main/packages/cli/CHANGELOG.md">
          packages/cli/CHANGELOG.md
        </TextLink>
        .
      </p>
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
    </SubpageShell>
  );
}
