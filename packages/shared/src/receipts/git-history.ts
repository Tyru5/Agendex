/**
 * Async git reads for plan receipts: a cheap state fingerprint (HEAD, refs,
 * working tree) and one history pass per repository. Always `execFile`,
 * never a shell.
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import type { CommitRecord, RepoHistory } from './attribution.ts';

const GIT_TIMEOUT_MS = 15_000;
const GIT_MAX_BUFFER = 256 * 1024 * 1024;
const DEFAULT_BRANCH_CANDIDATES = ['main', 'master', 'trunk'];
const ORIGIN_HEAD_REF = 'refs/remotes/origin/HEAD';
const execFileAsync = promisify(execFile);

async function runGit(repoRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    windowsHide: true,
    // Read-only: never take the index lock `git status` would otherwise refresh.
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
  return stdout;
}

export interface RepoState {
  /** Changes whenever HEAD, any branch/remote ref, or the working tree changes. */
  key: string;
  /** Whether HEAD resolves to a commit (false in a repository without commits). */
  hasHead: boolean;
  /** Full ref name → object id, for `refs/heads` and `refs/remotes`. */
  refs: Map<string, string>;
  /** Target of `refs/remotes/origin/HEAD`, e.g. `refs/remotes/origin/main`. */
  originHead?: string;
  /** Repo-relative paths with working-tree or index changes (incl. untracked). */
  workingTree: Set<string>;
}

/** Paths from `git status --porcelain=v1 -z`; renames/copies list both sides. */
function parseStatus(output: string): Set<string> {
  const paths = new Set<string>();
  const entries = output.split('\0');
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] as string;
    if (entry.length < 4) continue;
    paths.add(entry.slice(3));
    const x = entry[0];
    if (x === 'R' || x === 'C') {
      const original = entries[++i];
      if (original) paths.add(original);
    }
  }
  return paths;
}

/** Fingerprint and working-tree snapshot. Throws when git fails. */
export async function readRepoState(repoRoot: string): Promise<RepoState> {
  const [head, refsOutput, statusOutput] = await Promise.all([
    // Fails in a repository without commits; that is still a readable state.
    runGit(repoRoot, ['rev-parse', '--verify', '--quiet', 'HEAD']).catch(() => ''),
    runGit(repoRoot, [
      'for-each-ref',
      '--format=%(objectname) %(refname) %(symref)',
      'refs/heads',
      'refs/remotes',
    ]),
    runGit(repoRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
  ]);

  const refs = new Map<string, string>();
  let originHead: string | undefined;
  for (const line of refsOutput.split('\n')) {
    const [sha, name, symref] = line.split(' ');
    if (!sha || !name) continue;
    refs.set(name, sha);
    if (name === ORIGIN_HEAD_REF && symref) originHead = symref;
  }

  const key = createHash('sha1')
    .update(head)
    .update('\0')
    .update(refsOutput)
    .update('\0')
    .update(statusOutput)
    .digest('hex');
  return {
    key,
    hasHead: head.trim() !== '',
    refs,
    ...(originHead && { originHead }),
    workingTree: parseStatus(statusOutput),
  };
}

export interface DefaultBranch {
  /** Display name, e.g. `main` or `origin/main`. */
  label: string;
  /** Existing full refs (local branch and/or `origin/<name>`) to test landing against. */
  refs: string[];
}

/**
 * `origin/HEAD` when set, else the first of main/master/trunk that exists
 * locally or on origin.
 */
export function detectDefaultBranch(
  state: Pick<RepoState, 'refs' | 'originHead'>,
): DefaultBranch | undefined {
  const remotePrefix = 'refs/remotes/origin/';
  let name: string | undefined;
  let label: string | undefined;
  if (state.originHead?.startsWith(remotePrefix)) {
    name = state.originHead.slice(remotePrefix.length);
    label = `origin/${name}`;
  } else {
    name = DEFAULT_BRANCH_CANDIDATES.find(
      (candidate) =>
        state.refs.has(`refs/heads/${candidate}`) || state.refs.has(remotePrefix + candidate),
    );
    if (name) label = state.refs.has(`refs/heads/${name}`) ? name : `origin/${name}`;
  }
  if (!name || !label) return undefined;
  const refs = [`refs/heads/${name}`, remotePrefix + name].filter((ref) => state.refs.has(ref));
  return refs.length > 0 ? { label, refs } : undefined;
}

/** Parse `git log -z --name-only --format=%x1e%H%x1f%an%x1f%ct%x1f%s`. */
function parseLog(output: string): CommitRecord[] {
  const commits: CommitRecord[] = [];
  for (const record of output.split('\x1e')) {
    if (!record) continue;
    const [header = '', ...rest] = record.split('\0');
    const [sha, authorName = '', committedSec, subject = ''] = header.split('\x1f');
    if (!sha || !committedSec) continue;
    const files: string[] = [];
    for (const raw of rest) {
      const file = raw.startsWith('\n') ? raw.slice(1) : raw;
      if (file) files.push(file);
    }
    commits.push({
      sha,
      authorName,
      subject,
      committedAt: Number(committedSec) * 1000,
      files,
    });
  }
  return commits;
}

/**
 * Commits since `sinceMs` on local branches, HEAD, and the default branch (local and `origin/`),
 * plus the default-branch landed set. Other remote-tracking branches are left out: they are
 * teammates' work, and in large repositories they multiply the history by orders of magnitude.
 * Throws on git failure.
 */
export async function readRepoHistory(
  repoRoot: string,
  state: RepoState,
  sinceMs: number,
): Promise<RepoHistory> {
  const since = `--since=@${Math.max(0, Math.floor(sinceMs / 1000))}`;
  const defaultBranch = detectDefaultBranch(state);
  const revisions = [
    '--branches',
    ...(state.hasHead ? ['HEAD'] : []),
    ...(defaultBranch?.refs ?? []),
  ];
  const [logOutput, landedOutput] = await Promise.all([
    runGit(repoRoot, [
      '-c',
      'core.quotePath=false',
      'log',
      '-z',
      '--no-merges',
      '--no-renames',
      '--name-only',
      since,
      '--format=%x1e%H%x1f%an%x1f%ct%x1f%s',
      ...revisions,
      '--',
    ]),
    defaultBranch ? runGit(repoRoot, ['rev-list', since, ...defaultBranch.refs, '--']) : '',
  ]);
  const landed = new Set(landedOutput.split('\n').filter(Boolean));
  return {
    commits: parseLog(logOutput),
    landed,
    workingTree: state.workingTree,
    ...(defaultBranch && { defaultBranch: defaultBranch.label }),
  };
}
