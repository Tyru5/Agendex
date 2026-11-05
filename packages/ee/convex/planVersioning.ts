import type { Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';

export type PlanVersionSource = 'cli_sync' | 'editor' | 'restore' | 'backfill';

export type PlanVersionSnapshot = {
  title: string;
  content: string;
  format: string;
  filePath?: string;
  workspace?: string;
  metadata?: unknown;
};

type PlanVersionWriteCtx = Pick<MutationCtx, 'db'>;

/** True when title, body, or an explicitly provided format changes the reviewed revision. */
export function planContentChanged(
  previous: { title: string; content: string; format?: string },
  next: { title: string; content: string; format?: string },
): boolean {
  return (
    previous.title !== next.title ||
    previous.content !== next.content ||
    (next.format !== undefined && previous.format !== next.format)
  );
}

/**
 * Plan history retention: each plan keeps its newest `PLAN_VERSION_RETENTION`
 * versions (the history UI lists at most this many), plus the owner's
 * "changes since last read" baseline. Older versions are pruned as new ones are
 * written, so every plan's history is bounded no matter how often it syncs.
 */
export const PLAN_VERSION_RETENTION = 100;

/**
 * Most pruned per write. Steady state prunes one row per insert; the slack drains
 * plans that already exceeded the cap without reading many full snapshots at once.
 */
export const PLAN_VERSION_PRUNE_BATCH = 5;

/** Delete versions that fell out of the retention window for `planId`. */
export async function prunePlanVersions(
  ctx: PlanVersionWriteCtx,
  args: { ownerId: string; planId: Id<'plans'>; latestVersion: number },
): Promise<number> {
  const cutoff = args.latestVersion - PLAN_VERSION_RETENTION;
  if (cutoff < 0) return 0;

  const preferences = await ctx.db
    .query('planPreferences')
    .withIndex('by_owner_plan', (q) => q.eq('ownerId', args.ownerId).eq('planId', args.planId))
    .first();
  const protectedVersion = preferences?.lastReadVersion;

  const candidates = await ctx.db
    .query('planVersions')
    .withIndex('by_plan_version', (q) => q.eq('planId', args.planId).lte('version', cutoff))
    .order('asc')
    .take(PLAN_VERSION_PRUNE_BATCH + 1);

  let deleted = 0;
  for (const row of candidates) {
    if (deleted >= PLAN_VERSION_PRUNE_BATCH) break;
    if (row.version === protectedVersion) continue;
    await ctx.db.delete(row._id);
    deleted++;
  }
  return deleted;
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
  const id = await ctx.db.insert('planVersions', {
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
  await prunePlanVersions(ctx, {
    ownerId: args.ownerId,
    planId: args.planId,
    latestVersion: args.version,
  });
  return id;
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
    source: 'backfill',
    createdAt: args.createdAt,
  });
  return true;
}
