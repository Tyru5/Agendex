import type { PlanReceiptSummary } from './receipts/types.ts';

/** Browser-safe response for file provenance. Full plan content is fetched separately. */
export interface FilePlanHistoryItem {
  id: string;
  title: string;
  agent: string;
  workspace?: string;
  filePath: string;
  createdAt: string;
  updatedAt: string;
  mentioned: boolean;
  changedByPlanCommits: boolean;
  receipt: PlanReceiptSummary | null;
}

export interface FilePlanHistory {
  path: string;
  workspace: string;
  allWorkspaces?: boolean;
  total: number;
  limit: number;
  offset: number;
  plans: FilePlanHistoryItem[];
}

export const FILE_PLAN_HISTORY_DEFAULT_LIMIT = 20;
export const FILE_PLAN_HISTORY_MAX_LIMIT = 100;
