import type {
  PlanReceiptConfidence,
  PlanReceiptStatus,
  PlanReceiptSummary,
  PlanReceiptUnavailableReason,
} from '@agendex/shared/receipts';
import type { Plan } from './api.ts';

export const RECEIPT_STATUS_LABEL: Record<PlanReceiptStatus, string> = {
  planned: 'Planned',
  'in-progress': 'In progress',
  landed: 'Landed',
  stalled: 'Stalled',
  unavailable: 'No receipt',
};

export const RECEIPT_CONFIDENCE_LABEL: Record<PlanReceiptConfidence, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
};

/** Statuses worth a tag on a list row; `planned` and `unavailable` stay quiet. */
export type ReceiptTagStatus = Extract<PlanReceiptStatus, 'landed' | 'in-progress' | 'stalled'>;

export function receiptTagStatus(
  summary: Pick<PlanReceiptSummary, 'status'> | undefined,
): ReceiptTagStatus | undefined {
  const status = summary?.status;
  return status === 'landed' || status === 'in-progress' || status === 'stalled'
    ? status
    : undefined;
}

/** "7/9 files · 4 commits"; the file ratio drops out when nothing is trackable. */
export function formatReceiptCounts(
  summary: Pick<PlanReceiptSummary, 'changedFiles' | 'mentionedFiles' | 'commits'>,
): string {
  const commits = `${summary.commits} commit${summary.commits === 1 ? '' : 's'}`;
  if (summary.mentionedFiles === 0) return commits;
  const fileNoun = summary.mentionedFiles === 1 ? 'file' : 'files';
  return `${summary.changedFiles}/${summary.mentionedFiles} ${fileNoun} · ${commits}`;
}

/** One quiet line for an unavailable receipt, or nothing when silence reads better. */
export function receiptUnavailableMessage(
  reason: PlanReceiptUnavailableReason | undefined,
): string | undefined {
  if (reason === 'no-repository') return 'No receipt: this plan is not in a git repository.';
  if (reason === 'git-unavailable') return 'No receipt: git history could not be read.';
  return undefined;
}

/**
 * Receipts come from the local index, keyed by local plan id. Cloud rows carry that id as
 * `localPlanId`; local rows use their own id.
 */
export function receiptSummaryForPlan(
  receipts: Readonly<Record<string, PlanReceiptSummary>> | undefined,
  plan: Pick<Plan, 'id' | 'localPlanId'>,
): PlanReceiptSummary | undefined {
  return receipts?.[plan.localPlanId ?? plan.id];
}
