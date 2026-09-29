/**
 * Plan receipts: what happened in a plan's git repository after the plan was
 * written. Browser-safe (no Node built-ins) so the web UI, the local API, and
 * the MCP server share one contract. The Node-side engine lives beside this
 * file and is exported from the package root.
 */

import type { GitRepoInfo } from '../git-forge.ts';

/** How far a plan got, judged from the commits that followed it. */
export type PlanReceiptStatus = 'planned' | 'in-progress' | 'landed' | 'stalled' | 'unavailable';

export type PlanReceiptUnavailableReason =
  /** The plan has no workspace inside a git repository. */
  | 'no-repository'
  /** git is missing, timed out, or failed for the repository. */
  | 'git-unavailable'
  /** The plan mentions no file paths that can be tracked. */
  | 'no-file-mentions';

export type PlanReceiptConfidence = 'high' | 'medium' | 'low';

export interface PlanReceiptCommit {
  sha: string;
  subject: string;
  authorName: string;
  /** Committer timestamp, ISO 8601. */
  committedAt: string;
  /** Repo-relative paths this commit changed that the plan mentioned. */
  plannedFiles: string[];
  /** Repo-relative paths this commit changed that the plan did not mention. */
  unplannedFiles: string[];
  /** The commit is reachable from the repository's default branch. */
  onDefaultBranch: boolean;
  /** Other plans in the same repository whose windows also claim this commit. */
  sharedWithPlanIds: string[];
}

export interface PlanReceiptFiles {
  /** Mentioned files that attributed commits changed. */
  changed: string[];
  /** Mentioned files that exist but no attributed commit changed. */
  untouched: string[];
  /** Mentioned paths that don't exist and no attributed commit touched. */
  missing: string[];
  /** Mentions that matched several files; excluded from attribution. */
  ambiguous: string[];
  /** Files attributed commits changed that the plan never mentioned. */
  unplanned: string[];
  /** Mentioned files with uncommitted working-tree changes (open windows only). */
  uncommitted: string[];
}

export interface PlanReceiptWindow {
  /** Plan creation time, ISO 8601. Commits before this are never attributed. */
  start: string;
  /** Window close, ISO 8601; absent while the window is still open. */
  end?: string;
  /** A later plan in the same repository whose mentions overlap closed this window. */
  supersededByPlanId?: string;
}

export interface PlanReceipt {
  planId: string;
  status: PlanReceiptStatus;
  unavailableReason?: PlanReceiptUnavailableReason;
  /** Only for `landed` and `in-progress`. */
  confidence?: PlanReceiptConfidence;
  /** Short plain-language reasons behind the status and confidence. */
  reasons: string[];
  /** Absolute repository root on this machine. */
  repoRoot?: string;
  /** Default branch used for landing checks, e.g. `main` or `origin/main`. */
  defaultBranch?: string;
  /** Parsed `origin` remote, for commit links. */
  repo?: GitRepoInfo;
  window: PlanReceiptWindow;
  files: PlanReceiptFiles;
  /** Attributed commits, newest first, capped. */
  commits: PlanReceiptCommit[];
  /** Attributed commits left out of `commits` by the cap. */
  omittedCommitCount: number;
  /** Latest attributed commit that reached the default branch, ISO 8601. */
  landedAt?: string;
  /** Latest attributed commit, ISO 8601. */
  lastActivityAt?: string;
  computedAt: string;
}

/** Compact receipt for list rows, the brief, and MCP results. */
export interface PlanReceiptSummary {
  planId: string;
  status: PlanReceiptStatus;
  unavailableReason?: PlanReceiptUnavailableReason;
  confidence?: PlanReceiptConfidence;
  /** Mentioned files that attributed commits changed. */
  changedFiles: number;
  /** Trackable mentions: changed + untouched + missing. */
  mentionedFiles: number;
  /** All attributed commits, including any omitted by the cap. */
  commits: number;
  landedAt?: string;
  lastActivityAt?: string;
}

export function summarizePlanReceipt(receipt: PlanReceipt): PlanReceiptSummary {
  const { files } = receipt;
  return {
    planId: receipt.planId,
    status: receipt.status,
    ...(receipt.unavailableReason && { unavailableReason: receipt.unavailableReason }),
    ...(receipt.confidence && { confidence: receipt.confidence }),
    changedFiles: files.changed.length,
    mentionedFiles: files.changed.length + files.untouched.length + files.missing.length,
    commits: receipt.commits.length + receipt.omittedCommitCount,
    ...(receipt.landedAt && { landedAt: receipt.landedAt }),
    ...(receipt.lastActivityAt && { lastActivityAt: receipt.lastActivityAt }),
  };
}
