import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { clearPathResolveCache } from '../services/path-resolve.ts';
import type { Plan } from '../types.ts';
import {
  clearPlanReceiptCache,
  findPlansForFile,
  getPlanReceipt,
  getPlanReceipts,
} from './service.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let baseDir: string;
let repo: string;
let planDir: string;

function git(cwd: string, args: string[], atMs?: number): string {
  const date = atMs === undefined ? undefined : `@${Math.floor(atMs / 1000)} +0000`;
  return execFileSync(
    'git',
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'core.hooksPath=/dev/null',
      ...args,
    ],
    {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      env: {
        ...process.env,
        ...(date && { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }),
      },
    },
  );
}

function write(path: string, content = `${path}\n`): void {
  const absolute = join(repo, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

function commitAll(message: string, atMs: number): string {
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', message], atMs);
  return git(repo, ['rev-parse', 'HEAD']).trim();
}

function makePlan(id: string, content: string, createdAt: number, workspace = repo): Plan {
  return {
    id,
    agent: 'claude',
    title: id,
    content,
    filePath: join(planDir, `${id}.md`),
    format: 'md',
    createdAt: new Date(createdAt),
    updatedAt: new Date(createdAt),
    workspace,
    metadata: {},
  };
}

beforeEach(() => {
  clearPlanReceiptCache();
  clearPathResolveCache();
  baseDir = realpathSync(mkdtempSync(join(tmpdir(), 'agendex-receipts-')));
  repo = join(baseDir, 'repo');
  planDir = join(baseDir, 'plans');
  mkdirSync(repo, { recursive: true });
  mkdirSync(planDir, { recursive: true });
  git(repo, ['init', '-q', '-b', 'main']);
});

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

describe('getPlanReceipt on a real repository', () => {
  test('edits made only in a merge commit land the plan', async () => {
    const start = Date.now() - DAY;
    write('src/a.ts');
    commitAll('initial', start - HOUR);
    git(repo, ['checkout', '-q', '-b', 'feature']);
    write('docs/feature.md');
    commitAll('unrelated feature', start + HOUR);
    git(repo, ['checkout', '-q', 'main']);
    git(repo, ['merge', '-q', '--no-ff', '--no-commit', 'feature']);
    write('src/a.ts', 'merge-only change\n');
    const sha = commitAll('Merge and adjust a', start + 2 * HOUR);

    const receipt = await getPlanReceipt(makePlan('p', 'Update `src/a.ts`.', start));
    expect(receipt.status).toBe('landed');
    expect(receipt.files.changed).toEqual(['src/a.ts']);
    expect(receipt.commits.map((commit) => commit.sha)).toEqual([sha]);
  });

  test('missing paths and basenames cannot claim commits in sibling packages', async () => {
    const start = Date.now() - DAY;
    write('packages/a/README.md');
    write('packages/b/src/foo.ts');
    commitAll('initial', start - HOUR);
    // Delete the sibling file, so attribution must consider its history rather than
    // finding it in the current working tree.
    unlinkSync(join(repo, 'packages/b/src/foo.ts'));
    commitAll('delete sibling foo', start + HOUR);

    for (const mention of ['src/foo.ts', 'foo.ts']) {
      const receipt = await getPlanReceipt(
        makePlan(mention, `Update \`${mention}\`.`, start, join(repo, 'packages/a')),
      );
      expect(receipt.status).toBe('planned');
      expect(receipt.commits).toEqual([]);
    }
  });

  test('missing suffix matches still find deleted files within the plan workspace', async () => {
    const start = Date.now() - DAY;
    write('packages/a/lib/src/foo.ts');
    commitAll('initial', start - HOUR);
    unlinkSync(join(repo, 'packages/a/lib/src/foo.ts'));
    commitAll('delete workspace foo', start + HOUR);
    const receipt = await getPlanReceipt(
      makePlan('p', 'Update `src/foo.ts`.', start, join(repo, 'packages/a')),
    );
    expect(receipt.status).toBe('landed');
    expect(receipt.files.changed).toEqual(['packages/a/src/foo.ts']);
  });

  test('explicit sibling references retain existing and deleted in-repository files', async () => {
    const start = Date.now() - DAY;
    write('packages/a/README.md');
    write('packages/shared/util.ts');
    write('packages/shared/removed.ts');
    write('packages/shared/untouched.ts');
    commitAll('initial', start - HOUR);
    write('packages/shared/util.ts', 'changed\n');
    unlinkSync(join(repo, 'packages/shared/removed.ts'));
    commitAll('change sibling utilities', start + HOUR);

    for (const prefix of ['../shared', join(repo, 'packages/shared')]) {
      const receipt = await getPlanReceipt(
        makePlan(
          prefix,
          `Edit \`${prefix}/util.ts\`, \`${prefix}/removed.ts\`, and \`${prefix}/untouched.ts\`.`,
          start,
          join(repo, 'packages/a'),
        ),
      );
      expect(receipt.status).toBe('landed');
      expect(receipt.files.changed).toEqual([
        'packages/shared/util.ts',
        'packages/shared/removed.ts',
      ]);
      expect(receipt.files.untouched).toEqual(['packages/shared/untouched.ts']);
      expect(receipt.files.missing).toEqual([]);
    }
  });

  test('missing parent-relative paths keep the plan directory as their base', async () => {
    const start = Date.now() - DAY;
    write('packages/a/config.ts');
    write('packages/a/plans/README.md');
    write('packages/config.ts');
    commitAll('initial', start - HOUR);
    // The intended file disappeared before the plan. Only the wrong same-named
    // file changes after it, which must not count as work on this plan.
    unlinkSync(join(repo, 'packages/a/config.ts'));
    commitAll('remove intended config', start - 1000);
    write('packages/config.ts', 'wrong file changed\n');
    commitAll('edit wrong config', start + HOUR);
    const plan = makePlan('p', 'Update `../config.ts`.', start, join(repo, 'packages/a'));
    plan.filePath = join(repo, 'packages/a/plans/p.md');
    const receipt = await getPlanReceipt(plan);
    expect(receipt.status).toBe('planned');
    expect(receipt.files.missing).toEqual(['packages/a/config.ts']);
    expect(receipt.commits).toEqual([]);

    // A later deletion of the intended file should remain attributable too.
    plan.createdAt = new Date(start - 2000);
    const earlier = await getPlanReceipt(plan);
    expect(earlier.status).toBe('landed');
    expect(earlier.files.changed).toEqual(['packages/a/config.ts']);
    expect(earlier.commits.map((c) => c.subject)).toEqual(['remove intended config']);
  });

  test('nested plans distinguish plan-relative siblings from workspace siblings', async () => {
    const start = Date.now() - DAY;
    write('packages/a/plans/README.md');
    write('packages/a/shared/util.ts');
    write('packages/shared/util.ts');
    commitAll('initial', start - HOUR);
    write('packages/shared/util.ts', 'workspace sibling\n');
    commitAll('change workspace sibling', start + HOUR);
    write('packages/a/shared/util.ts', 'plan sibling\n');
    commitAll('change plan sibling', start + 2 * HOUR);

    for (const [mention, expectedPath, subject] of [
      ['../shared/util.ts', 'packages/a/shared/util.ts', 'change plan sibling'],
      ['../../shared/util.ts', 'packages/shared/util.ts', 'change workspace sibling'],
      [
        join(repo, 'packages/shared/util.ts'),
        'packages/shared/util.ts',
        'change workspace sibling',
      ],
    ]) {
      const plan = makePlan('p', `Update \`${mention}\`.`, start, join(repo, 'packages/a'));
      plan.filePath = join(repo, 'packages/a/plans/p.md');
      const receipt = await getPlanReceipt(plan);
      expect(receipt.status).toBe('landed');
      expect(receipt.files.changed).toEqual([expectedPath]);
      expect(receipt.commits.map((c) => c.subject)).toEqual([subject]);
    }
  });

  test('a planned commit merged into main lands the plan', async () => {
    const start = Date.now() - DAY;
    write('src/a.ts');
    write('src/b.ts');
    commitAll('initial', start - HOUR);
    git(repo, ['checkout', '-q', '-b', 'feature']);
    write('src/a.ts', 'changed\n');
    write('docs/x.md');
    const sha = commitAll('Implement a', start + HOUR);
    git(repo, ['checkout', '-q', 'main']);
    git(repo, ['merge', '-q', '--no-ff', '-m', 'Merge feature', 'feature'], start + 2 * HOUR);

    const receipt = await getPlanReceipt(makePlan('p', 'Update `src/a.ts` and `src/b.ts`.', start));
    expect(receipt).toMatchObject({
      status: 'landed',
      repoRoot: repo,
      defaultBranch: 'main',
      files: { changed: ['src/a.ts'], untouched: ['src/b.ts'], unplanned: ['docs/x.md'] },
    });
    expect(receipt.commits).toHaveLength(1);
    expect(receipt.commits[0]).toMatchObject({
      sha,
      subject: 'Implement a',
      onDefaultBranch: true,
      committedAt: new Date(Math.floor((start + HOUR) / 1000) * 1000).toISOString(),
    });
  });

  test('the same commit only on a feature branch is in progress', async () => {
    const start = Date.now() - DAY;
    write('src/a.ts');
    write('src/b.ts');
    commitAll('initial', start - HOUR);
    git(repo, ['checkout', '-q', '-b', 'feature']);
    write('src/a.ts', 'changed\n');
    write('docs/x.md');
    commitAll('Implement a', start + HOUR);
    git(repo, ['checkout', '-q', 'main']);

    const receipt = await getPlanReceipt(makePlan('p', 'Update `src/a.ts` and `src/b.ts`.', start));
    expect(receipt.status).toBe('in-progress');
    expect(receipt.commits).toHaveLength(1);
    expect(receipt.commits[0]?.onDefaultBranch).toBe(false);
    expect(receipt.files.changed).toEqual(['src/a.ts']);
  });

  test("commits only on another remote-tracking branch are not the plan's work", async () => {
    const start = Date.now() - DAY;
    write('src/a.ts');
    commitAll('initial', start - HOUR);
    git(repo, ['checkout', '-q', '-b', 'teammate']);
    write('src/a.ts', 'teammate change\n');
    commitAll('Teammate edits a', start + HOUR);
    git(repo, ['update-ref', 'refs/remotes/origin/teammate', 'HEAD']);
    git(repo, ['checkout', '-q', 'main']);
    git(repo, ['branch', '-q', '-D', 'teammate']);

    const receipt = await getPlanReceipt(makePlan('p', 'Update `src/a.ts`.', start));
    expect(receipt.status).toBe('planned');
    expect(receipt.commits).toEqual([]);
    expect(receipt.files.untouched).toEqual(['src/a.ts']);
  });

  test('landing is detected through origin/HEAD without a local default branch', async () => {
    const start = Date.now() - DAY;
    const origin = join(baseDir, 'origin.git');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
    write('src/a.ts');
    commitAll('initial', start - HOUR);
    write('src/a.ts', 'changed\n');
    commitAll('Implement a', start + HOUR);
    git(repo, ['remote', 'add', 'origin', origin]);
    git(repo, ['push', '-q', 'origin', 'main']);
    git(repo, ['remote', 'set-head', 'origin', 'main']);
    git(repo, ['checkout', '-q', '-b', 'dev']);
    git(repo, ['branch', '-q', '-D', 'main']);

    const receipt = await getPlanReceipt(makePlan('p', 'Change `src/a.ts`.', start));
    expect(receipt.status).toBe('landed');
    expect(receipt.defaultBranch).toBe('origin/main');
  });

  test('deleted and newly created mentioned files count as changed', async () => {
    const start = Date.now() - DAY;
    write('src/old.ts');
    commitAll('initial', start - HOUR);
    unlinkSync(join(repo, 'src/old.ts'));
    write('src/new.ts');
    commitAll('Replace old with new', start + HOUR);

    const receipt = await getPlanReceipt(
      makePlan('p', 'Delete `src/old.ts`, add `src/new.ts`, later `src/later.ts`.', start),
    );
    expect(receipt.status).toBe('landed');
    expect(receipt.files.changed).toEqual(['src/old.ts', 'src/new.ts']);
    expect(receipt.files.missing).toEqual(['src/later.ts']);
  });

  test('uncommitted edits to a mentioned file mean in progress', async () => {
    const start = Date.now() - DAY;
    write('src/a.ts');
    write('src/b.ts');
    commitAll('initial', start - HOUR);
    write('src/b.ts', 'wip\n');

    const receipt = await getPlanReceipt(makePlan('p', 'Update `src/a.ts` and `src/b.ts`.', start));
    expect(receipt.status).toBe('in-progress');
    expect(receipt.files.uncommitted).toEqual(['src/b.ts']);
    expect(receipt.commits).toEqual([]);
  });

  test('an old plan with no follow-up commits is stalled', async () => {
    const start = Date.now() - 10 * DAY;
    write('src/a.ts');
    commitAll('initial', start - HOUR);
    write('README.md');
    commitAll('Unrelated', start + HOUR);

    const receipt = await getPlanReceipt(makePlan('p', 'Change `src/a.ts`.', start));
    expect(receipt.status).toBe('stalled');
  });

  test('plans outside a repository or without file mentions are unavailable', async () => {
    const start = Date.now() - DAY;
    write('src/a.ts');
    commitAll('initial', start - HOUR);
    const outside = join(baseDir, 'plain');
    mkdirSync(outside);
    const noRepo = { ...makePlan('no-repo', 'Change `src/a.ts`.', start, outside) };
    noRepo.filePath = join(outside, 'plan.md');

    const receipts = await getPlanReceipts([
      noRepo,
      makePlan('no-mentions', 'Think about naming.', start),
    ]);
    expect(receipts.get('no-repo')).toMatchObject({
      status: 'unavailable',
      unavailableReason: 'no-repository',
    });
    expect(receipts.get('no-mentions')).toMatchObject({
      status: 'unavailable',
      unavailableReason: 'no-file-mentions',
    });
  });

  test('an edited plan gets a fresh receipt without clearing the cache', async () => {
    const start = Date.now() - DAY;
    write('src/a.ts');
    write('src/b.ts');
    commitAll('initial', start - HOUR);
    write('src/a.ts', 'changed\n');
    commitAll('Implement a', start + HOUR);

    const first = await getPlanReceipt(makePlan('p', 'Change `src/b.ts`.', start));
    expect(first.status).toBe('planned');

    const edited = makePlan('p', 'Change `src/a.ts` instead.', start);
    edited.updatedAt = new Date(start + 2 * HOUR);
    const second = await getPlanReceipt(edited);
    expect(second.status).toBe('landed');
    expect(second.files.changed).toEqual(['src/a.ts']);
  });

  test('same-length content edits invalidate receipts even with unchanged timestamps', async () => {
    const start = Date.now() - DAY;
    write('src/a.ts');
    write('src/b.ts');
    commitAll('initial', start - HOUR);
    write('src/a.ts', 'changed\n');
    commitAll('Implement a', start + HOUR);

    const plan = makePlan('p', 'Change `src/b.ts`.', start);
    expect((await getPlanReceipt(plan)).status).toBe('planned');
    plan.content = 'Change `src/a.ts`.';
    const second = await getPlanReceipt(plan);
    expect(second.status).toBe('landed');
    expect(second.files.changed).toEqual(['src/a.ts']);
  });

  test('a real Git commit in the plan creation second is included', async () => {
    const second = Math.floor((Date.now() - DAY) / 1000) * 1000;
    write('src/a.ts');
    commitAll('initial', second - HOUR);
    write('src/a.ts', 'changed\n');
    const sha = commitAll('Implement a', second + 900);

    const receipt = await getPlanReceipt(makePlan('p', 'Change `src/a.ts`.', second + 500));
    expect(receipt.status).toBe('in-progress');
    expect(receipt.confidence).toBe('low');
    expect(receipt.landedAt).toBeUndefined();
    expect(receipt.commits.map((c) => c.sha)).toEqual([sha]);
  });

  test('a mentioned file created after a receipt resolves once git state changes', async () => {
    const start = Date.now() - DAY;
    write('src/a.ts');
    commitAll('initial', start - HOUR);
    const plan = makePlan('p', 'Add `Button.tsx` beside `src/a.ts`.', start);

    const first = await getPlanReceipt(plan);
    expect(first.files.missing).toEqual(['Button.tsx']);

    write('src/Button.tsx');
    // Past the git fingerprint recheck, still inside the workspace file-list TTL.
    setSystemTime(new Date(Date.now() + 6_000));
    try {
      const second = await getPlanReceipt(plan);
      expect(second.files.missing).toEqual([]);
      expect(second.files.uncommitted).toEqual(['src/Button.tsx']);
      expect(second.status).toBe('in-progress');
    } finally {
      setSystemTime();
    }
  });
});

describe('findPlansForFile', () => {
  async function setupTwoPlans(): Promise<Plan[]> {
    const start = Date.now() - 2 * DAY;
    write('src/a.ts');
    write('src/b.ts');
    commitAll('initial', start - HOUR);
    write('src/a.ts', 'changed\n');
    write('docs/x.md');
    commitAll('Implement a', start + HOUR);
    return [
      makePlan('older', 'Touch `src/a.ts`.', start),
      makePlan('newer', 'Touch `src/a.ts` and `src/b.ts` and `lib/c.ts`.', start + DAY),
    ];
  }

  test('relative, absolute and bare-name inputs find the same plans, newest first', async () => {
    const plans = await setupTwoPlans();
    const relative = await findPlansForFile('src/a.ts', { cwd: repo, plans });
    const absolute = await findPlansForFile(join(repo, 'src/a.ts'), { plans });
    const fromSubdir = await findPlansForFile('a.ts', { cwd: join(repo, 'src'), plans });
    const bare = await findPlansForFile('A.ts', { cwd: repo, plans });

    for (const result of [relative, absolute, fromSubdir, bare]) {
      expect(result.map((match) => match.plan.id)).toEqual(['newer', 'older']);
    }
    expect(relative.map((match) => match.mentioned)).toEqual([true, true]);
  });

  test('flags files changed by plan commits that the plan never mentioned', async () => {
    const plans = await setupTwoPlans();
    const matches = await findPlansForFile('docs/x.md', { cwd: repo, plans });
    expect(matches).toEqual([
      { plan: plans[0] as Plan, mentioned: false, changedByPlanCommits: true },
    ]);
  });

  test('mentions of files that do not exist yet still match', async () => {
    const plans = await setupTwoPlans();
    const matches = await findPlansForFile('lib/c.ts', { cwd: repo, plans });
    expect(matches.map((match) => [match.plan.id, match.mentioned])).toEqual([['newer', true]]);
  });

  test('files outside any repository match nothing', async () => {
    const plans = await setupTwoPlans();
    expect(await findPlansForFile(join(baseDir, 'elsewhere.ts'), { plans })).toEqual([]);
  });
});
