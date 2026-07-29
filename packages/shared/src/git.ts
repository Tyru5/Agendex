/**
 * Node-dependent git helpers used on the syncing machine (CLI daemon,
 * one-shot sync, uploads) to capture the git context of a plan's workspace.
 * Pure forge helpers (remote parsing, URL builders) live in `git-forge.ts`.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseRemoteUrl, type PlanGitContext, sanitizeRemoteUrl } from './git-forge.ts';

const GIT_TIMEOUT_MS = 3_000;
const GIT_CONTEXT_CACHE_TTL_MS = 60_000;

function runGit(cwd: string, args: string[]): string | null {
  try {
    const output = execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      timeout: GIT_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    const trimmed = output.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

/** Walk up from a directory looking for a `.git` entry (dir, or file for worktrees). */
export function findGitRoot(startDir: string): string | null {
  let dir = resolve(startDir);
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Resolve the git repository root for a plan: prefer the plan's workspace
 * directory, falling back to the directory containing the plan artifact
 * (covers custom plan dirs, which never set `workspace`).
 */
export function resolvePlanRepoRoot(plan: { workspace?: string; filePath?: string }): string | null {
  if (plan.workspace) {
    const workspace = resolve(plan.workspace);
    if (existsSync(workspace)) {
      const root = findGitRoot(workspace);
      if (root) return root;
    }
  }
  if (plan.filePath) {
    const dir = dirname(resolve(plan.filePath));
    if (existsSync(dir)) return findGitRoot(dir);
  }
  return null;
}

/** Capture the current branch, HEAD commit, and origin remote of a repo. */
export function captureGitContext(repoRoot: string): PlanGitContext | null {
  const commit = runGit(repoRoot, ['rev-parse', 'HEAD']) ?? undefined;
  const branchRaw = runGit(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  // `HEAD` means detached; omit the branch in that case.
  const branch = branchRaw && branchRaw !== 'HEAD' ? branchRaw : undefined;
  const remoteRaw = runGit(repoRoot, ['remote', 'get-url', 'origin']);
  // Sanitize before storing: remotes can embed credentials (e.g. CI token
  // rewrites via `url.<base>.insteadOf`) that must never sync to the cloud.
  const remoteUrl = remoteRaw ? sanitizeRemoteUrl(remoteRaw) : undefined;
  const repo = remoteUrl ? (parseRemoteUrl(remoteUrl) ?? undefined) : undefined;

  if (!commit && !branch && !remoteUrl) return null;
  return {
    ...(branch && { branch }),
    ...(commit && { commit }),
    ...(remoteUrl && { remoteUrl }),
    ...(repo && { repo }),
  };
}

interface GitContextCacheEntry {
  at: number;
  value: PlanGitContext | null;
}

const repoRootCache = new Map<string, GitContextCacheEntry & { root: string | null }>();
const gitContextCache = new Map<string, GitContextCacheEntry>();

/** Test helper: reset the per-directory git context caches. */
export function clearGitContextCache(): void {
  repoRootCache.clear();
  gitContextCache.clear();
}

/**
 * Cached lookup of a plan's git context. Many plans share one workspace, so
 * sync passes resolve the repo root and spawn git at most once per directory
 * per TTL window instead of once per plan.
 */
export function getPlanGitContext(plan: {
  workspace?: string;
  filePath?: string;
}): PlanGitContext | null {
  const startDir = plan.workspace ?? (plan.filePath ? dirname(plan.filePath) : undefined);
  if (!startDir) return null;

  const now = Date.now();
  const cachedRoot = repoRootCache.get(startDir);
  let root: string | null;
  if (cachedRoot && now - cachedRoot.at < GIT_CONTEXT_CACHE_TTL_MS) {
    root = cachedRoot.root;
  } else {
    root = resolvePlanRepoRoot(plan);
    repoRootCache.set(startDir, { at: now, value: null, root });
  }
  if (!root) return null;

  const cached = gitContextCache.get(root);
  if (cached && now - cached.at < GIT_CONTEXT_CACHE_TTL_MS) return cached.value;

  const value = captureGitContext(root);
  gitContextCache.set(root, { at: now, value });
  return value;
}
