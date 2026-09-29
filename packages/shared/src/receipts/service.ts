/**
 * Plan receipts service: groups plans by git repository, reads each repo's
 * history once, and caches the result per repository until its git state,
 * its plans, or a time-based status boundary changes.
 */

import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { captureGitContext, findGitRoot, resolvePlanRepoRoot } from '../git.ts';
import { getIndexablePlans } from '../services/plan-service.ts';
import type { Plan } from '../types.ts';
import {
  attributeRepoReceipts,
  mentionMatchesFile,
  type ReceiptPlanInput,
  type RepoHistory,
  type ResolvedMentions,
  unavailableReceipt,
} from './attribution.ts';
import { forgetCodeFileLists } from '../services/path-resolve.ts';
import { readRepoHistory, readRepoState, type RepoState } from './git-history.ts';
import { resolvePlanMentions } from './mentions.ts';
import type { PlanReceipt } from './types.ts';

/** Re-read a repository's git fingerprint at most this often. */
const FINGERPRINT_TTL_MS = 5_000;
/** Re-resolve a plan's repository root at most this often. */
const REPO_ROOT_TTL_MS = 30_000;
/** Retry a repository whose git reads failed after this long, instead of on every request. */
const GIT_FAILURE_RETRY_MS = 30_000;

interface RepoComputation {
  receipts: Map<string, PlanReceipt>;
  changedFiles: Map<string, Set<string>>;
  mentions: Map<string, ResolvedMentions>;
}

interface RepoCacheEntry {
  state?: { checkedAt: number; settled: boolean; promise: Promise<RepoState | null> };
  result?: { key: string; expiresAt: number; promise: Promise<RepoComputation> };
  /** Git state the workspace file lists were last trusted for. */
  fileListStateKey?: string;
}

interface MentionCacheEntry {
  signature: string;
  promise: Promise<ResolvedMentions>;
}

const repoCache = new Map<string, RepoCacheEntry>();
const repoRootCache = new Map<string, { at: number; root: string | null }>();
let mentionCache = new WeakMap<Plan, MentionCacheEntry>();

export function clearPlanReceiptCache(): void {
  repoCache.clear();
  repoRootCache.clear();
  mentionCache = new WeakMap();
}

function safeRealpath(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

function toMs(value: Date | string | number): number {
  return new Date(value).getTime();
}

/** Real path of the plan's git repository root, or null. */
function planRepoRoot(plan: Plan): string | null {
  const key = `${plan.workspace ?? ''}\0${plan.filePath}`;
  const now = Date.now();
  const cached = repoRootCache.get(key);
  if (cached && now - cached.at < REPO_ROOT_TTL_MS) return cached.root;
  const raw = resolvePlanRepoRoot(plan);
  const root = raw ? safeRealpath(raw) : null;
  repoRootCache.set(key, { at: now, root });
  return root;
}

function planStart(plan: Plan): number {
  const created = toMs(plan.createdAt);
  if (Number.isFinite(created)) return created;
  const updated = toMs(plan.updatedAt);
  return Number.isFinite(updated) ? updated : Date.now();
}

function plansSignature(plans: readonly Plan[]): string {
  const hash = createHash('sha1');
  for (const plan of [...plans].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    hash.update(
      [
        plan.id,
        toMs(plan.createdAt),
        toMs(plan.updatedAt),
        plan.content,
        plan.workspace ?? '',
        plan.filePath,
      ].join('\0'),
    );
    hash.update('\x1e');
  }
  return hash.digest('hex');
}

/** Mentions cached per plan object; re-resolved when content, location, or repo state changes. */
function planMentions(plan: Plan, repoRoot: string, stateKey: string): Promise<ResolvedMentions> {
  const signature = [plan.content, plan.workspace ?? '', plan.filePath, repoRoot, stateKey].join(
    '\0',
  );
  const cached = mentionCache.get(plan);
  if (cached?.signature === signature) return cached.promise;
  const promise = resolvePlanMentions(plan, repoRoot);
  mentionCache.set(plan, { signature, promise });
  // Don't pin a failed resolution; the next request retries.
  promise.catch(() => {
    if (mentionCache.get(plan)?.promise === promise) mentionCache.delete(plan);
  });
  return promise;
}

function repoState(repoRoot: string, entry: RepoCacheEntry): Promise<RepoState | null> {
  const now = Date.now();
  const cached = entry.state;
  if (cached && (!cached.settled || now - cached.checkedAt < FINGERPRINT_TTL_MS)) {
    return cached.promise;
  }
  const state = {
    checkedAt: now,
    settled: false,
    promise: readRepoState(repoRoot).catch(() => null),
  };
  state.promise.finally(() => {
    state.settled = true;
    state.checkedAt = Date.now();
  });
  entry.state = state;
  return state.promise;
}

async function buildRepo(
  repoRoot: string,
  plans: readonly Plan[],
  state: RepoState | null,
): Promise<{ computation: RepoComputation; expiresAt: number }> {
  const now = Date.now();
  const repo = state ? captureGitContext(repoRoot)?.repo : undefined;
  const stateKey = state?.key ?? 'git-unavailable';
  const inputs: ReceiptPlanInput[] = await Promise.all(
    plans.map(async (plan) => ({
      id: plan.id,
      createdAt: planStart(plan),
      mentions: await planMentions(plan, repoRoot, stateKey),
    })),
  );
  const mentions = new Map(inputs.map((input) => [input.id, input.mentions]));
  const tracked = inputs.filter((input) => input.mentions.mentions.length > 0);

  let history: RepoHistory | null = null;
  if (state && tracked.length === 0) {
    history = { commits: [], landed: new Set(), workingTree: state.workingTree };
  } else if (state) {
    const since = Math.min(...tracked.map((input) => input.createdAt));
    history = await readRepoHistory(repoRoot, state, since).catch(() => null);
  }

  if (!history) {
    const receipts = new Map(
      inputs.map((input) => [
        input.id,
        unavailableReceipt(
          input,
          input.mentions.mentions.length > 0 ? 'git-unavailable' : 'no-file-mentions',
          now,
          { repoRoot, ambiguous: input.mentions.ambiguous },
        ),
      ]),
    );
    return {
      computation: { receipts, changedFiles: new Map(), mentions },
      expiresAt: now + GIT_FAILURE_RETRY_MS,
    };
  }

  const result = attributeRepoReceipts({ repoRoot, repo, plans: inputs, history, now });
  return {
    computation: { receipts: result.receipts, changedFiles: result.changedFiles, mentions },
    expiresAt: result.nextTransitionAt,
  };
}

/** Single-flight, fingerprint-keyed receipts for every plan in one repository. */
async function computeRepo(repoRoot: string, plans: readonly Plan[]): Promise<RepoComputation> {
  let entry = repoCache.get(repoRoot);
  if (!entry) repoCache.set(repoRoot, (entry = {}));
  const state = await repoState(repoRoot, entry);
  const stateKey = state?.key ?? 'git-unavailable';
  const key = `${stateKey}\0${plansSignature(plans)}`;
  const cached = entry.result;
  if (cached && cached.key === key && Date.now() < cached.expiresAt) return cached.promise;

  // Files created or deleted since the last state would otherwise resolve against a
  // file list cached before the change, freezing a stale result under the new key.
  if (entry.fileListStateKey !== stateKey) {
    forgetCodeFileLists(repoRoot);
    entry.fileListStateKey = stateKey;
  }

  const built = buildRepo(repoRoot, plans, state).catch(() => {
    const now = Date.now();
    const receipts = new Map(
      plans.map((plan) => [
        plan.id,
        unavailableReceipt({ id: plan.id, createdAt: planStart(plan) }, 'git-unavailable', now, {
          repoRoot,
        }),
      ]),
    );
    return {
      computation: { receipts, changedFiles: new Map(), mentions: new Map() },
      expiresAt: now + GIT_FAILURE_RETRY_MS,
    };
  });
  const result = {
    key,
    // Pending results never expire, so concurrent callers share one computation.
    expiresAt: Number.POSITIVE_INFINITY,
    promise: built.then(({ computation }) => computation),
  };
  void built.then(({ expiresAt }) => {
    result.expiresAt = expiresAt;
  });
  entry.result = result;
  return result.promise;
}

/**
 * Group `requested` plans by repository and add every indexable plan in the
 * same repositories as window/supersede peers (requested plan objects win).
 */
function groupByRepo(requested: readonly Plan[]): {
  noRepo: Plan[];
  repos: Map<string, { requested: Plan[]; peers: Plan[] }>;
} {
  const noRepo: Plan[] = [];
  const repos = new Map<string, { requested: Plan[]; peers: Plan[] }>();
  const requestedIds = new Set<string>();
  for (const plan of requested) {
    requestedIds.add(plan.id);
    const root = planRepoRoot(plan);
    if (!root) {
      noRepo.push(plan);
      continue;
    }
    const group = repos.get(root);
    if (group) {
      group.requested.push(plan);
      group.peers.push(plan);
    } else repos.set(root, { requested: [plan], peers: [plan] });
  }
  if (repos.size === 0) return { noRepo, repos };
  for (const plan of getIndexablePlans()) {
    if (requestedIds.has(plan.id)) continue;
    const root = planRepoRoot(plan);
    if (root) repos.get(root)?.peers.push(plan);
  }
  return { noRepo, repos };
}

/** Receipts for `plans` (default: getIndexablePlans()), computed per repository and cached. */
export async function getPlanReceipts(plans?: readonly Plan[]): Promise<Map<string, PlanReceipt>> {
  const requested = plans ?? getIndexablePlans();
  const { noRepo, repos } = groupByRepo(requested);
  const byId = new Map<string, PlanReceipt>();
  const now = Date.now();
  for (const plan of noRepo) {
    byId.set(
      plan.id,
      unavailableReceipt({ id: plan.id, createdAt: planStart(plan) }, 'no-repository', now),
    );
  }
  await Promise.all(
    [...repos].map(async ([root, group]) => {
      const computation = await computeRepo(root, group.peers);
      for (const plan of group.requested) {
        const receipt = computation.receipts.get(plan.id);
        if (receipt) byId.set(plan.id, receipt);
      }
    }),
  );
  // Preserve the caller's order.
  const ordered = new Map<string, PlanReceipt>();
  for (const plan of requested) {
    const receipt = byId.get(plan.id);
    if (receipt) ordered.set(plan.id, receipt);
  }
  return ordered;
}

/** Receipt for one plan. Uses all indexable plans in the same repo for window/supersede logic. */
export async function getPlanReceipt(plan: Plan): Promise<PlanReceipt> {
  const receipts = await getPlanReceipts([plan]);
  return (
    receipts.get(plan.id) ??
    unavailableReceipt({ id: plan.id, createdAt: planStart(plan) }, 'no-repository', Date.now())
  );
}

export interface PlanFileMatch {
  plan: Plan;
  /** The plan's text mentions the file. */
  mentioned: boolean;
  /** A commit attributed to the plan changed the file (from its receipt). */
  changedByPlanCommits: boolean;
}

/**
 * Plans whose mentions (or attributed commits) cover `filePath`. Relative paths resolve against
 * `options.cwd` (default process.cwd()). Newest plan first.
 *
 * A bare file name (`Button.tsx`) that doesn't exist at that location matches
 * any mentioned or changed file with the same name in the repository.
 */
export async function findPlansForFile(
  filePath: string,
  options: { cwd?: string; plans?: readonly Plan[] } = {},
): Promise<PlanFileMatch[]> {
  const absolute = resolve(options.cwd ?? process.cwd(), filePath);
  const gitRoot = findGitRoot(dirname(absolute));
  if (!gitRoot) return [];
  const realRoot = safeRealpath(gitRoot);
  const rel = relative(gitRoot, absolute);
  if (!realRoot || !rel || rel.startsWith('..')) return [];
  const file = rel.split(sep).join('/');
  const bareName =
    !/[\\/]/.test(filePath) && safeRealpath(absolute) === null ? filePath.toLowerCase() : null;
  const coversFile = (candidate: string): boolean =>
    candidate === file || (bareName !== null && basename(candidate).toLowerCase() === bareName);

  const { repos } = groupByRepo(options.plans ?? getIndexablePlans());
  const group = repos.get(realRoot);
  if (!group) return [];
  const computation = await computeRepo(realRoot, group.peers);

  const matches: PlanFileMatch[] = [];
  for (const plan of group.requested) {
    const mentions = computation.mentions.get(plan.id)?.mentions ?? [];
    const mentioned = mentions.some(
      (mention) => mentionMatchesFile(mention, file) || coversFile(mention.key),
    );
    const changed = computation.changedFiles.get(plan.id);
    const changedByPlanCommits = changed ? [...changed].some(coversFile) : false;
    if (mentioned || changedByPlanCommits) matches.push({ plan, mentioned, changedByPlanCommits });
  }
  return matches.sort(
    (a, b) =>
      planStart(b.plan) - planStart(a.plan) || toMs(b.plan.updatedAt) - toMs(a.plan.updatedAt),
  );
}
