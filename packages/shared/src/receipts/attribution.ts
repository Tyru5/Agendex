/**
 * Pure receipt attribution: given a repository's plans (with resolved file
 * mentions) and its recent git history, decide which commits belong to which
 * plan and derive each plan's status. No I/O; the git and filesystem work
 * happens in `service.ts`.
 */

import type { GitRepoInfo } from '../git-forge.ts';
import type {
  PlanReceipt,
  PlanReceiptCommit,
  PlanReceiptConfidence,
  PlanReceiptStatus,
  PlanReceiptUnavailableReason,
  PlanReceiptWindow,
} from './types.ts';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const WINDOW_MAX_DAYS = 30;
export const STALE_AFTER_DAYS = 7;
/** A first commit this soon after the plan supports high confidence. */
const QUICK_START_DAYS = 3;
export const MAX_RECEIPT_COMMITS = 50;
export const MAX_UNPLANNED_FILES = 100;

/**
 * One file mention from a plan. Found mentions carry only `exact`; missing
 * ones carry `joined` plus a lowercase `suffix` (paths with `/`) or
 * `basename` (bare names) so files created, deleted or moved later still match.
 */
export interface PlanMention {
  /** Identity and display path: `exact ?? joined`, repo-relative POSIX. */
  key: string;
  /** The file exists now. */
  found: boolean;
  exact?: string;
  joined?: string;
  suffix?: string;
  basename?: string;
  /** Restrict fuzzy matches to the plan workspace within this repository. */
  workspacePrefix?: string;
}

export interface ResolvedMentions {
  mentions: PlanMention[];
  /** Mentions that matched several files; reported, never attributed. */
  ambiguous: string[];
}

export interface ReceiptPlanInput {
  id: string;
  /** Plan creation time, ms since epoch. */
  createdAt: number;
  mentions: ResolvedMentions;
}

export interface CommitRecord {
  sha: string;
  subject: string;
  authorName: string;
  /** Committer time, ms since epoch. */
  committedAt: number;
  /** Repo-relative POSIX paths the commit changed. */
  files: string[];
}

export interface RepoHistory {
  commits: readonly CommitRecord[];
  /** Commit shas reachable from the default branch. */
  landed: ReadonlySet<string>;
  /** Repo-relative paths with working-tree changes. */
  workingTree: ReadonlySet<string>;
  /** Branch used for landing checks; absent when none was found. */
  defaultBranch?: string;
}

export interface RepoReceiptInput {
  repoRoot: string;
  repo?: GitRepoInfo;
  plans: readonly ReceiptPlanInput[];
  history: RepoHistory;
  now: number;
}

export interface RepoReceiptResult {
  receipts: Map<string, PlanReceipt>;
  /** Every file changed by each plan's attributed commits (uncapped). */
  changedFiles: Map<string, Set<string>>;
  /** Earliest future time at which a receipt changes without new git activity. */
  nextTransitionAt: number;
}

function basenameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Whether repo-relative file `file` satisfies `mention`. */
export function mentionMatchesFile(mention: PlanMention, file: string): boolean {
  if (mention.workspacePrefix && !file.startsWith(mention.workspacePrefix + '/')) return false;
  if (file === mention.exact || file === mention.joined) return true;
  if (mention.suffix) {
    const lower = file.toLowerCase();
    return lower === mention.suffix || lower.endsWith('/' + mention.suffix);
  }
  if (mention.basename) return basenameOf(file).toLowerCase() === mention.basename;
  return false;
}

const UNAVAILABLE_REASON_TEXT: Record<PlanReceiptUnavailableReason, string> = {
  'no-repository': "The plan's workspace isn't in a git repository",
  'git-unavailable': "Couldn't read git history for this repository",
  'no-file-mentions': "The plan doesn't mention any files to track",
};

export function unavailableReceipt(
  plan: { id: string; createdAt: number },
  reason: PlanReceiptUnavailableReason,
  now: number,
  extra: { repoRoot?: string; repo?: GitRepoInfo; ambiguous?: string[] } = {},
): PlanReceipt {
  return {
    planId: plan.id,
    status: 'unavailable',
    unavailableReason: reason,
    reasons: [UNAVAILABLE_REASON_TEXT[reason]],
    ...(extra.repoRoot && { repoRoot: extra.repoRoot }),
    ...(extra.repo && { repo: extra.repo }),
    window: { start: new Date(plan.createdAt).toISOString() },
    files: {
      changed: [],
      untouched: [],
      missing: [],
      ambiguous: extra.ambiguous ?? [],
      unplanned: [],
      uncommitted: [],
    },
    commits: [],
    omittedCommitCount: 0,
    computedAt: new Date(now).toISOString(),
  };
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function formatDuration(ms: number): string {
  if (ms < MINUTE_MS) return 'under a minute';
  if (ms < HOUR_MS) return plural(Math.floor(ms / MINUTE_MS), 'minute');
  if (ms < DAY_MS) return plural(Math.floor(ms / HOUR_MS), 'hour');
  return plural(Math.floor(ms / DAY_MS), 'day');
}

function branchLabel(defaultBranch: string): string {
  return defaultBranch.startsWith('origin/')
    ? defaultBranch.slice('origin/'.length)
    : defaultBranch;
}

type MentionRef = { plan: number; mention: number };

/** Lookup tables from changed-file keys to the mentions they satisfy. */
class MentionIndex {
  private readonly exact = new Map<string, MentionRef[]>();
  private readonly suffix = new Map<string, MentionRef[]>();
  private readonly basename = new Map<string, MentionRef[]>();

  constructor(plans: readonly ReceiptPlanInput[]) {
    plans.forEach((plan, planIdx) => {
      plan.mentions.mentions.forEach((mention, mentionIdx) => {
        const ref = { plan: planIdx, mention: mentionIdx };
        if (mention.exact) add(this.exact, mention.exact, ref);
        if (mention.joined && mention.joined !== mention.exact)
          add(this.exact, mention.joined, ref);
        if (mention.suffix) add(this.suffix, mention.suffix, ref);
        if (mention.basename) add(this.basename, mention.basename, ref);
      });
    });
  }

  /** Mentions `file` satisfies, possibly with duplicates. */
  lookup(file: string, out: MentionRef[]): void {
    const exact = this.exact.get(file);
    if (exact) out.push(...exact);
    const lower = file.toLowerCase();
    const base = this.basename.get(basenameOf(lower));
    if (base) out.push(...base);
    if (this.suffix.size === 0) return;
    // A suffix key matches when it equals `file` or one of its `/`-bounded tails.
    let start = 0;
    for (;;) {
      const hit = this.suffix.get(lower.slice(start));
      if (hit) out.push(...hit);
      const slash = lower.indexOf('/', start);
      if (slash < 0) break;
      start = slash + 1;
    }
  }
}

function add<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

interface PlanWindow {
  start: number;
  /** Exclusive end; just after `now` for open windows. */
  end: number;
  open: boolean;
  supersededBy?: string;
}

function computeWindows(plans: readonly ReceiptPlanInput[], now: number): PlanWindow[] {
  const keys = plans.map((plan) => new Set(plan.mentions.mentions.map((mention) => mention.key)));
  return plans.map((plan, idx) => {
    const start = plan.createdAt;
    const maxEnd = start + WINDOW_MAX_DAYS * DAY_MS;
    let superseder: ReceiptPlanInput | undefined;
    const own = keys[idx] as Set<string>;
    plans.forEach((other, otherIdx) => {
      if (otherIdx === idx || other.createdAt <= start || own.size === 0) return;
      if (superseder && other.createdAt >= superseder.createdAt) return;
      const theirs = keys[otherIdx] as Set<string>;
      if (theirs.size === 0) return;
      const needed = Math.max(1, Math.ceil(0.5 * own.size));
      let shared = 0;
      for (const key of theirs) if (own.has(key)) shared++;
      if (shared >= needed) superseder = other;
    });
    if (superseder && superseder.createdAt < maxEnd) {
      return { start, end: superseder.createdAt, open: false, supersededBy: superseder.id };
    }
    if (maxEnd > now) return { start, end: now + 1, open: true };
    return { start, end: maxEnd, open: false };
  });
}

interface Attribution {
  commit: CommitRecord;
  plannedFiles: string[];
  unplannedFiles: string[];
  matchedMentions: Set<number>;
}

/** Attribute a repository's history to its plans and build every receipt. */
export function attributeRepoReceipts(input: RepoReceiptInput): RepoReceiptResult {
  const { plans, history, now } = input;
  const windows = computeWindows(plans, now);
  const index = new MentionIndex(plans);
  const attributions: Attribution[][] = plans.map(() => []);
  const claimedBy = new Map<string, string[]>();

  const refs: MentionRef[] = [];
  for (const commit of history.commits) {
    // plan index → (file → matched mention indexes)
    const perPlan = new Map<number, Map<string, number[]>>();
    for (const file of commit.files) {
      refs.length = 0;
      index.lookup(file, refs);
      for (const ref of refs) {
        const mention = plans[ref.plan]?.mentions.mentions[ref.mention];
        if (!mention || !mentionMatchesFile(mention, file)) continue;
        const window = windows[ref.plan] as PlanWindow;
        // Git records whole seconds. Include the creation second, but retain the
        // precise end so work in a partially overlapping final second is not lost.
        if (
          commit.committedAt < Math.floor(window.start / 1000) * 1000 ||
          commit.committedAt >= window.end
        )
          continue;
        let files = perPlan.get(ref.plan);
        if (!files) perPlan.set(ref.plan, (files = new Map()));
        add(files, file, ref.mention);
      }
    }
    for (const [planIdx, files] of perPlan) {
      const matchedMentions = new Set<number>();
      for (const mentionIdxs of files.values()) for (const m of mentionIdxs) matchedMentions.add(m);
      (attributions[planIdx] as Attribution[]).push({
        commit,
        plannedFiles: commit.files.filter((file) => files.has(file)),
        unplannedFiles: commit.files.filter((file) => !files.has(file)),
        matchedMentions,
      });
      add(claimedBy, commit.sha, (plans[planIdx] as ReceiptPlanInput).id);
    }
  }

  const receipts = new Map<string, PlanReceipt>();
  const changedFiles = new Map<string, Set<string>>();
  let nextTransitionAt = Number.POSITIVE_INFINITY;

  plans.forEach((plan, planIdx) => {
    const window = windows[planIdx] as PlanWindow;
    const planAttributions = attributions[planIdx] as Attribution[];
    const mentions = plan.mentions.mentions;
    if (mentions.length === 0) {
      receipts.set(
        plan.id,
        unavailableReceipt(plan, 'no-file-mentions', now, {
          repoRoot: input.repoRoot,
          repo: input.repo,
          ambiguous: plan.mentions.ambiguous,
        }),
      );
      return;
    }

    planAttributions.sort((a, b) => b.commit.committedAt - a.commit.committedAt);
    const matched = new Set<number>();
    const allChanged = new Set<string>();
    const unplanned = new Set<string>();
    for (const attribution of planAttributions) {
      for (const m of attribution.matchedMentions) matched.add(m);
      for (const file of attribution.commit.files) allChanged.add(file);
      for (const file of attribution.unplannedFiles) unplanned.add(file);
    }
    changedFiles.set(plan.id, allChanged);

    const changed: string[] = [];
    const untouched: string[] = [];
    const missing: string[] = [];
    const uncommitted: string[] = [];
    mentions.forEach((mention, idx) => {
      if (matched.has(idx)) changed.push(mention.key);
      else if (mention.found) untouched.push(mention.key);
      else missing.push(mention.key);
      if (window.open && mention.found && mention.exact && history.workingTree.has(mention.exact)) {
        uncommitted.push(mention.key);
      }
    });

    const commits: PlanReceiptCommit[] = planAttributions.map(
      ({ commit, plannedFiles, unplannedFiles }) => ({
        sha: commit.sha,
        subject: commit.subject,
        authorName: commit.authorName,
        committedAt: new Date(commit.committedAt).toISOString(),
        plannedFiles,
        unplannedFiles,
        onDefaultBranch: history.landed.has(commit.sha),
        sharedWithPlanIds: (claimedBy.get(commit.sha) ?? []).filter((id) => id !== plan.id),
      }),
    );
    // A timestamp rounded down into the plan's creation second cannot establish
    // whether the commit preceded the plan. Keep the evidence, but not a landing claim.
    const confirmedShas = new Set(
      planAttributions
        .filter(({ commit }) => commit.committedAt >= window.start)
        .map(({ commit }) => commit.sha),
    );
    const landedCommits = commits.filter(
      (commit) => commit.onDefaultBranch && confirmedShas.has(commit.sha),
    );
    const sharedCount = commits.filter((commit) => commit.sharedWithPlanIds.length > 0).length;

    let status: PlanReceiptStatus;
    if (landedCommits.length > 0) status = 'landed';
    else if (commits.length > 0 || uncommitted.length > 0) status = 'in-progress';
    else if (window.supersededBy || now - window.start > STALE_AFTER_DAYS * DAY_MS) {
      status = 'stalled';
    } else status = 'planned';

    const mentionedFiles = changed.length + untouched.length + missing.length;
    const coverage = changed.length / mentionedFiles;
    let confidence: PlanReceiptConfidence | undefined;
    if (status === 'landed' || status === 'in-progress') {
      const first = planAttributions.at(-1)?.commit.committedAt;
      const quickStart = first !== undefined && first - window.start <= QUICK_START_DAYS * DAY_MS;
      const allShared = commits.length > 0 && sharedCount === commits.length;
      if (coverage < 0.25 || allShared || confirmedShas.size === 0) confidence = 'low';
      else if (coverage >= 0.5 && quickStart && sharedCount < commits.length) confidence = 'high';
      else confidence = 'medium';
    }

    const reasons: string[] = [];
    if (commits.length > 0 || status === 'in-progress') {
      reasons.push(`${changed.length} of ${plural(mentionedFiles, 'mentioned file')} changed`);
    }
    const firstCommit = planAttributions.at(-1)?.commit;
    if (firstCommit && firstCommit.committedAt < window.start) {
      reasons.push(
        'A commit shares the plan creation second; Git timestamps cannot establish which came first',
      );
    } else if (firstCommit) {
      reasons.push(
        `First commit ${formatDuration(firstCommit.committedAt - window.start)} after the plan`,
      );
    }
    if (history.defaultBranch && landedCommits.length > 0) {
      reasons.push(
        `${plural(landedCommits.length, 'commit')} reached ${branchLabel(history.defaultBranch)}`,
      );
    } else if (history.defaultBranch && commits.length > 0) {
      reasons.push(
        commits.some((commit) => commit.onDefaultBranch)
          ? `No confirmed post-plan commits on ${branchLabel(history.defaultBranch)} yet`
          : `No commits on ${branchLabel(history.defaultBranch)} yet`,
      );
    } else if (commits.length > 0) {
      reasons.push('No default branch found to check landing');
    }
    if (sharedCount > 0) {
      reasons.push(
        `${plural(sharedCount, 'commit')} also ${sharedCount === 1 ? 'matches' : 'match'} another plan`,
      );
    }
    if (uncommitted.length > 0) {
      reasons.push(
        `${plural(uncommitted.length, 'mentioned file')} ${uncommitted.length === 1 ? 'has' : 'have'} uncommitted changes`,
      );
    }
    if (window.supersededBy) reasons.push('Closed when a newer plan covered the same files');
    if (status === 'stalled' && !window.supersededBy) {
      const idleDays = Math.floor((Math.min(now, window.end) - window.start) / DAY_MS);
      reasons.push(`No commits touched the mentioned files in ${plural(idleDays, 'day')}`);
    } else if (status === 'planned') {
      reasons.push('No commits touched the mentioned files yet');
    }

    const receiptWindow: PlanReceiptWindow = { start: new Date(window.start).toISOString() };
    if (!window.open) receiptWindow.end = new Date(window.end).toISOString();
    if (window.supersededBy) receiptWindow.supersededByPlanId = window.supersededBy;

    if (window.open) {
      nextTransitionAt = Math.min(nextTransitionAt, window.start + WINDOW_MAX_DAYS * DAY_MS);
    }
    if (status === 'planned') {
      nextTransitionAt = Math.min(nextTransitionAt, window.start + STALE_AFTER_DAYS * DAY_MS + 1);
    }

    const shown = commits.slice(0, MAX_RECEIPT_COMMITS);
    receipts.set(plan.id, {
      planId: plan.id,
      status,
      ...(confidence && { confidence }),
      reasons,
      repoRoot: input.repoRoot,
      ...(history.defaultBranch && { defaultBranch: history.defaultBranch }),
      ...(input.repo && { repo: input.repo }),
      window: receiptWindow,
      files: {
        changed,
        untouched,
        missing,
        ambiguous: plan.mentions.ambiguous,
        unplanned: [...unplanned].sort().slice(0, MAX_UNPLANNED_FILES),
        uncommitted,
      },
      commits: shown,
      omittedCommitCount: commits.length - shown.length,
      ...(landedCommits[0] && { landedAt: landedCommits[0].committedAt }),
      ...(commits[0] && { lastActivityAt: commits[0].committedAt }),
      computedAt: new Date(now).toISOString(),
    });
  });

  return { receipts, changedFiles, nextTransitionAt };
}
