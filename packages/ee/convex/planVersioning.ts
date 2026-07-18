import type { Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';

export type PlanVersionSource = 'cli_sync' | 'editor' | 'restore';

export type PlanVersionSnapshot = {
  title: string;
  content: string;
  format: string;
  filePath?: string;
  workspace?: string;
  metadata?: unknown;
};

type PlanVersionWriteCtx = Pick<MutationCtx, 'db'>;

/** True when title or body changed enough to warrant a new history snapshot. */
export function planContentChanged(
  previous: { title: string; content: string },
  next: { title: string; content: string },
): boolean {
  return previous.title !== next.title || previous.content !== next.content;
}

/** Insert an immutable planVersions row for the given plan version number. */
export async function recordPlanVersion(
  ctx: PlanVersionWriteCtx,
  args: {
    ownerId: string;
    planId: Id<'plans'>;
    version: number;
    snapshot: PlanVersionSnapshot;
    source?: PlanVersionSource;
    createdAt?: number;
  },
): Promise<Id<'planVersions'>> {
  return await ctx.db.insert('planVersions', {
    ownerId: args.ownerId,
    planId: args.planId,
    version: args.version,
    title: args.snapshot.title,
    content: args.snapshot.content,
    format: args.snapshot.format,
    filePath: args.snapshot.filePath,
    workspace: args.snapshot.workspace,
    metadata: args.snapshot.metadata,
    ...(args.source ? { source: args.source } : {}),
    createdAt: args.createdAt ?? Date.now(),
  });
}

/**
 * If a plan has never been snapshotted (common for rows created before history
 * was wired into sync), capture the current live content at `version` so the
 * next bump does not lose the pre-change state.
 */
export async function ensureBaselinePlanVersion(
  ctx: PlanVersionWriteCtx,
  args: {
    ownerId: string;
    planId: Id<'plans'>;
    version: number;
    snapshot: PlanVersionSnapshot;
    createdAt?: number;
  },
): Promise<boolean> {
  const existing = await ctx.db
    .query('planVersions')
    .withIndex('by_plan', (q) => q.eq('planId', args.planId))
    .first();
  if (existing) return false;

  await recordPlanVersion(ctx, {
    ownerId: args.ownerId,
    planId: args.planId,
    version: args.version,
    snapshot: args.snapshot,
    createdAt: args.createdAt,
  });
  return true;
}
