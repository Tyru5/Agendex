import { describe, expect, test } from 'bun:test';
import {
  attributeRepoReceipts,
  type CommitRecord,
  type PlanMention,
  type ReceiptPlanInput,
} from './attribution.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-06-01T00:00:00Z');

function found(path: string): PlanMention {
  return { key: path, found: true, exact: path };
}

function missing(path: string): PlanMention {
  const lower = path.toLowerCase();
  return lower.includes('/')
    ? { key: path, found: false, joined: path, suffix: lower }
    : { key: path, found: false, joined: path, basename: lower };
}

function plan(
  id: string,
  createdAt: number,
  mentions: PlanMention[],
  ambiguous: string[] = [],
): ReceiptPlanInput {
  return { id, createdAt, mentions: { mentions, ambiguous } };
}

function commit(sha: string, committedAt: number, files: string[]): CommitRecord {
  return { sha, subject: `change ${sha}`, authorName: 'Dev', committedAt, files };
}

function receiptsFor(
  plans: ReceiptPlanInput[],
  commits: CommitRecord[],
  options: { landed?: string[]; workingTree?: string[]; defaultBranch?: string | null } = {},
) {
  const defaultBranch = options.defaultBranch === undefined ? 'main' : options.defaultBranch;
  return attributeRepoReceipts({
    repoRoot: '/repo',
    plans,
    history: {
      // git log order: newest first
      commits: [...commits].sort((a, b) => b.committedAt - a.committedAt),
      landed: new Set(options.landed ?? []),
      workingTree: new Set(options.workingTree ?? []),
      ...(defaultBranch && { defaultBranch }),
    },
    now: NOW,
  }).receipts;
}

describe('attributeRepoReceipts status', () => {
  test('a commit on the default branch lands the plan', () => {
    const start = NOW - 2 * DAY;
    const receipt = receiptsFor(
      [plan('p', start, [found('src/a.ts'), found('src/b.ts')])],
      [commit('c1', start + HOUR, ['src/a.ts', 'docs/x.md'])],
      { landed: ['c1'] },
    ).get('p');

    expect(receipt).toMatchObject({
      status: 'landed',
      confidence: 'high',
      defaultBranch: 'main',
      landedAt: new Date(start + HOUR).toISOString(),
      lastActivityAt: new Date(start + HOUR).toISOString(),
      window: { start: new Date(start).toISOString() },
      files: { changed: ['src/a.ts'], untouched: ['src/b.ts'], unplanned: ['docs/x.md'] },
    });
    expect(receipt?.window.end).toBeUndefined();
    expect(receipt?.commits).toEqual([
      {
        sha: 'c1',
        subject: 'change c1',
        authorName: 'Dev',
        committedAt: new Date(start + HOUR).toISOString(),
        plannedFiles: ['src/a.ts'],
        unplannedFiles: ['docs/x.md'],
        onDefaultBranch: true,
        sharedWithPlanIds: [],
      },
    ]);
    expect(receipt?.reasons).toContain('1 of 2 mentioned files changed');
    expect(receipt?.reasons).toContain('1 commit reached main');
  });

  test('commits off the default branch keep the plan in progress', () => {
    const start = NOW - DAY;
    const receipt = receiptsFor(
      [plan('p', start, [found('src/a.ts')])],
      [commit('c1', start + HOUR, ['src/a.ts'])],
      { defaultBranch: 'origin/main' },
    ).get('p');
    expect(receipt?.status).toBe('in-progress');
    expect(receipt?.landedAt).toBeUndefined();
    expect(receipt?.commits[0]?.onDefaultBranch).toBe(false);
    expect(receipt?.reasons).toContain('No commits on main yet');
  });

  test('commits before the plan was written are never attributed', () => {
    const start = NOW - DAY;
    const receipt = receiptsFor(
      [plan('p', start, [found('src/a.ts')])],
      [commit('old', start - 1, ['src/a.ts'])],
      { landed: ['old'] },
    ).get('p');
    expect(receipt?.status).toBe('planned');
    expect(receipt?.commits).toEqual([]);
    expect(receipt?.confidence).toBeUndefined();
  });

  test('a fresh plan with no activity is planned; after 7 days it is stalled', () => {
    const receipts = receiptsFor(
      [
        plan('fresh', NOW - 6 * DAY, [found('src/a.ts')]),
        plan('old', NOW - 8 * DAY, [found('lib/z.ts')]),
      ],
      [],
    );
    expect(receipts.get('fresh')?.status).toBe('planned');
    expect(receipts.get('old')?.status).toBe('stalled');
    expect(receipts.get('old')?.reasons).toContain(
      'No commits touched the mentioned files in 8 days',
    );
  });

  test('working-tree changes to mentioned files mean in progress while the window is open', () => {
    const receipts = receiptsFor(
      [
        plan('open', NOW - DAY, [found('src/a.ts'), found('src/b.ts')]),
        plan('closed', NOW - 40 * DAY, [found('lib/c.ts')]),
      ],
      [],
      { workingTree: ['src/b.ts', 'lib/c.ts', 'other.ts'] },
    );
    expect(receipts.get('open')).toMatchObject({
      status: 'in-progress',
      files: { uncommitted: ['src/b.ts'], untouched: ['src/a.ts', 'src/b.ts'] },
    });
    expect(receipts.get('open')?.reasons).toContain('1 mentioned file has uncommitted changes');
    expect(receipts.get('closed')).toMatchObject({ status: 'stalled', files: { uncommitted: [] } });
  });

  test('uncommitted changes to a missing mention do not count', () => {
    const receipt = receiptsFor([plan('p', NOW - DAY, [missing('src/gone.ts')])], [], {
      workingTree: ['src/gone.ts'],
    }).get('p');
    expect(receipt?.status).toBe('planned');
    expect(receipt?.files.missing).toEqual(['src/gone.ts']);
  });

  test('a plan without trackable mentions is unavailable', () => {
    const receipt = receiptsFor([plan('p', NOW - DAY, [], ['Button.tsx'])], []).get('p');
    expect(receipt).toMatchObject({
      status: 'unavailable',
      unavailableReason: 'no-file-mentions',
      files: { ambiguous: ['Button.tsx'] },
    });
  });
});

describe('attributeRepoReceipts windows', () => {
  test('a newer plan covering the same files closes the older window', () => {
    const aStart = NOW - 3 * DAY;
    const bStart = NOW - 2 * DAY;
    const receipts = receiptsFor(
      [
        plan('a', aStart, [found('src/a.ts'), found('src/b.ts')]),
        plan('b', bStart, [found('src/a.ts'), found('src/b.ts'), found('src/c.ts')]),
      ],
      [commit('late', NOW - DAY, ['src/a.ts'])],
    );
    expect(receipts.get('a')).toMatchObject({
      status: 'stalled',
      window: { end: new Date(bStart).toISOString(), supersededByPlanId: 'b' },
      commits: [],
    });
    expect(receipts.get('a')?.reasons).toContain('Closed when a newer plan covered the same files');
    expect(receipts.get('b')?.commits.map((c) => c.sha)).toEqual(['late']);
    expect(receipts.get('b')?.commits[0]?.sharedWithPlanIds).toEqual([]);
  });

  test('commits before the superseding plan still belong to the older plan', () => {
    const aStart = NOW - 3 * DAY;
    const bStart = NOW - DAY;
    const receipts = receiptsFor(
      [plan('a', aStart, [found('src/a.ts')]), plan('b', bStart, [found('src/a.ts')])],
      [commit('early', aStart + HOUR, ['src/a.ts'])],
      { landed: ['early'] },
    );
    expect(receipts.get('a')?.status).toBe('landed');
    expect(receipts.get('b')?.status).toBe('planned');
  });

  test('a small overlap does not supersede, so both plans claim the commit', () => {
    const receipts = receiptsFor(
      [
        plan('a', NOW - 3 * DAY, ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'].map(found)),
        plan('b', NOW - 2 * DAY, ['src/a.ts', 'lib/x.ts', 'lib/y.ts', 'lib/z.ts'].map(found)),
      ],
      [commit('c1', NOW - DAY, ['src/a.ts'])],
    );
    expect(receipts.get('a')?.window.supersededByPlanId).toBeUndefined();
    expect(receipts.get('a')?.commits[0]?.sharedWithPlanIds).toEqual(['b']);
    expect(receipts.get('b')?.commits[0]?.sharedWithPlanIds).toEqual(['a']);
    expect(receipts.get('a')?.confidence).toBe('low');
    expect(receipts.get('a')?.reasons).toContain('1 commit also matches another plan');
  });

  test('windows close 30 days after the plan', () => {
    const start = NOW - 40 * DAY;
    const receipt = receiptsFor(
      [plan('p', start, [found('src/a.ts')])],
      [
        commit('late', start + 31 * DAY, ['src/a.ts']),
        commit('ok', start + 29 * DAY, ['src/a.ts']),
      ],
    ).get('p');
    expect(receipt?.window.end).toBe(new Date(start + 30 * DAY).toISOString());
    expect(receipt?.commits.map((c) => c.sha)).toEqual(['ok']);
  });
});

describe('attributeRepoReceipts file matching', () => {
  test('missing mentions match files created, moved or deleted later', () => {
    const start = NOW - DAY;
    const receipt = receiptsFor(
      [
        plan('p', start, [
          missing('src/new.ts'),
          missing('utils/moved.ts'),
          missing('Button.tsx'),
          missing('src/never.ts'),
        ]),
      ],
      [
        commit('create', start + HOUR, ['src/new.ts']),
        commit('move', start + 2 * HOUR, ['packages/core/Utils/Moved.ts']),
        commit('bare', start + 3 * HOUR, ['src/ui/button.tsx']),
      ],
    ).get('p');
    expect(receipt?.files.changed).toEqual(['src/new.ts', 'utils/moved.ts', 'Button.tsx']);
    expect(receipt?.files.missing).toEqual(['src/never.ts']);
    expect(receipt?.files.unplanned).toEqual([]);
  });

  test('found mentions match only their exact path', () => {
    const start = NOW - DAY;
    const receipt = receiptsFor(
      [plan('p', start, [found('src/a.ts')])],
      [commit('c1', start + HOUR, ['lib/src/a.ts', 'a.ts'])],
    ).get('p');
    expect(receipt?.status).toBe('planned');
    expect(receipt?.files.untouched).toEqual(['src/a.ts']);
  });

  test('unplanned files are the union across attributed commits, sorted', () => {
    const start = NOW - DAY;
    const receipt = receiptsFor(
      [plan('p', start, [found('src/a.ts')])],
      [
        commit('c1', start + HOUR, ['src/a.ts', 'z.md']),
        commit('c2', start + 2 * HOUR, ['src/a.ts', 'b.md', 'z.md']),
        commit('unrelated', start + 3 * HOUR, ['other.md']),
      ],
    ).get('p');
    expect(receipt?.files.unplanned).toEqual(['b.md', 'z.md']);
    expect(receipt?.commits.map((c) => c.sha)).toEqual(['c2', 'c1']);
  });
});

describe('attributeRepoReceipts confidence and caps', () => {
  test('partial coverage gives medium, low coverage gives low', () => {
    const start = NOW - DAY;
    const receipts = receiptsFor(
      [
        plan('medium', start, ['a.ts', 'b.ts', 'c.ts'].map(found)),
        plan('low', start, ['v.ts', 'w.ts', 'x.ts', 'y.ts', 'z.ts'].map(found)),
      ],
      [commit('c1', start + HOUR, ['a.ts']), commit('c2', start + HOUR, ['v.ts'])],
      { landed: ['c1', 'c2'] },
    );
    expect(receipts.get('medium')?.confidence).toBe('medium');
    expect(receipts.get('low')?.confidence).toBe('low');
  });

  test('a slow first commit caps confidence at medium', () => {
    const start = NOW - 10 * DAY;
    const receipt = receiptsFor(
      [plan('p', start, [found('a.ts')])],
      [commit('c1', start + 4 * DAY, ['a.ts'])],
      { landed: ['c1'] },
    ).get('p');
    expect(receipt?.confidence).toBe('medium');
    expect(receipt?.reasons).toContain('First commit 4 days after the plan');
  });

  test('commits are newest first and capped at 50', () => {
    const start = NOW - 20 * DAY;
    const commits = Array.from({ length: 60 }, (_, i) =>
      commit(`c${i}`, start + (i + 1) * HOUR, ['a.ts']),
    );
    const receipt = receiptsFor([plan('p', start, [found('a.ts')])], commits).get('p');
    expect(receipt?.commits).toHaveLength(50);
    expect(receipt?.omittedCommitCount).toBe(10);
    expect(receipt?.commits[0]?.sha).toBe('c59');
    expect(receipt?.lastActivityAt).toBe(new Date(start + 60 * HOUR).toISOString());
  });

  test('without a default branch nothing lands', () => {
    const start = NOW - DAY;
    const receipt = receiptsFor(
      [plan('p', start, [found('a.ts')])],
      [commit('c1', start + HOUR, ['a.ts'])],
      { defaultBranch: null },
    ).get('p');
    expect(receipt?.status).toBe('in-progress');
    expect(receipt?.defaultBranch).toBeUndefined();
  });
});
