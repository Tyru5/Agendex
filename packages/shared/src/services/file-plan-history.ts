import { isAbsolute, resolve } from 'node:path';
import { resolvePlanRepoRoot } from '../git.ts';
import { getIndexablePlans } from './plan-service.ts';
import {
  FILE_PLAN_HISTORY_DEFAULT_LIMIT,
  FILE_PLAN_HISTORY_MAX_LIMIT,
  type FilePlanHistory,
} from '../file-plan-history.ts';
import { findPlansForFile, getPlanReceipts } from '../receipts/service.ts';
import { summarizePlanReceipt } from '../receipts/types.ts';
import type { Plan } from '../types.ts';

/** Same cached file/commit attribution as MCP, with bounded, content-free results. */
export async function getFilePlanHistory(
  path: string,
  options: {
    cwd?: string;
    plans?: readonly Plan[];
    limit?: number;
    offset?: number;
    allWorkspaces?: boolean;
  } = {},
): Promise<FilePlanHistory> {
  const filePath = path.trim();
  if (!filePath || filePath.includes('\0') || filePath.length > 4096) {
    throw new Error('path must be a non-empty file path of at most 4096 characters');
  }
  const limit = options.limit ?? FILE_PLAN_HISTORY_DEFAULT_LIMIT;
  const offset = options.offset ?? 0;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > FILE_PLAN_HISTORY_MAX_LIMIT) {
    throw new Error(`limit must be an integer from 1 to ${FILE_PLAN_HISTORY_MAX_LIMIT}`);
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error('offset must be a non-negative integer');
  }
  const workspace = resolve(options.cwd ?? process.cwd());
  const matches = await filePlanMatches(filePath, { ...options, cwd: workspace });
  const page = matches.slice(offset, offset + limit);
  const receipts = await getPlanReceipts(page.map((match) => match.plan));
  return {
    path: filePath,
    workspace,
    ...(options.allWorkspaces && { allWorkspaces: true }),
    total: matches.length,
    limit,
    offset,
    plans: page.map(({ plan, mentioned, changedByPlanCommits }) => {
      const receipt = receipts.get(plan.id);
      return {
        id: plan.id,
        title: plan.title,
        agent: plan.agent,
        workspace: plan.workspace,
        filePath: plan.filePath,
        createdAt: plan.createdAt.toISOString(),
        updatedAt: plan.updatedAt.toISOString(),
        mentioned,
        changedByPlanCommits,
        receipt: receipt ? summarizePlanReceipt(receipt) : null,
      };
    }),
  };
}

async function filePlanMatches(
  filePath: string,
  options: { cwd?: string; plans?: readonly Plan[]; allWorkspaces?: boolean },
) {
  const workspace = resolve(options.cwd ?? process.cwd());
  let matches;
  if (options.allWorkspaces && !isAbsolute(filePath)) {
    const plans = options.plans ?? getIndexablePlans();
    const roots = [
      ...new Set(plans.map(resolvePlanRepoRoot).filter((root): root is string => root !== null)),
    ];
    const groups = await Promise.all(
      roots.map((cwd) => findPlansForFile(filePath, { cwd, plans })),
    );
    matches = [...new Map(groups.flat().map((match) => [match.plan.id, match])).values()].sort(
      (a, b) =>
        b.plan.createdAt.getTime() - a.plan.createdAt.getTime() ||
        b.plan.updatedAt.getTime() - a.plan.updatedAt.getTime(),
    );
  } else {
    matches = await findPlansForFile(filePath, { cwd: workspace, plans: options.plans });
  }
  return matches;
}

/** Batched counts reuse attribution cache without building receipt summaries. */
export async function getFilePlanCounts(
  paths: readonly string[],
  options: { cwd?: string; plans?: readonly Plan[]; allWorkspaces?: boolean } = {},
) {
  if (
    paths.length > 20 ||
    paths.some((path) => !path.trim() || path.length > 4096 || path.includes('\0'))
  ) {
    throw new Error('Provide at most 20 non-empty file paths of at most 4096 characters');
  }
  return Promise.all(
    [...new Set(paths)].map(async (path) => ({
      path,
      count: (await filePlanMatches(path.trim(), options)).length,
      exact: true,
    })),
  );
}
