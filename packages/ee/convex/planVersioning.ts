import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';

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
 * Version rows hold a full content snapshot (up to ~900 KB each), while a Convex
 * transaction may read only ~16 MiB. Readers of many versions therefore stop at a
 * byte budget instead of a fixed row count. Each budget can overshoot by one row.
 */
export const PLAN_VERSION_LIST_BUDGET_BYTES = 8 * 1024 * 1024;
export const PLAN_VERSION_DELETE_BUDGET_BYTES = 4 * 1024 * 1024;
export const PLAN_VERSION_PRUNE_BUDGET_BYTES = 2 * 1024 * 1024;

const versionByteEncoder = new TextEncoder();

/** Approximate stored size of a version row, dominated by its snapshot. */
export function approxPlanVersionBytes(row: Doc<'planVersions'>): number {
  return (
    versionByteEncoder.encode(row.content).byteLength +
    versionByteEncoder.encode(row.title).byteLength +
    (row.metadata === undefined ? 0 : JSON.stringify(row.metadata).length) +
    512
  );
}

/**
 * Read a plan's versions in `order`, one indexed row at a time, until `maxRows`
 * or `budgetBytes` is reached. `mayHaveMore` is true when either limit stopped
 * the read early.
 */
export async function readPlanVersionsWithinBudget(
  ctx: Pick<QueryCtx, 'db'>,
  args: {
    planId: Id<'plans'>;
    order: 'asc' | 'desc';
    maxRows: number;
    budgetBytes: number;
    /** Only versions at or below this number. */
    maxVersion?: number;
  },
): Promise<{ rows: Doc<'planVersions'>[]; mayHaveMore: boolean }> {
  const rows: Doc<'planVersions'>[] = [];
  let bytes = 0;
  let cursor: number | undefined;
  while (rows.length < args.maxRows && bytes < args.budgetBytes) {
    const row = await ctx.db
      .query('planVersions')
      .withIndex('by_plan_version', (q) => {
        const plan = q.eq('planId', args.planId);
        if (args.order === 'asc') {
          const lower = cursor === undefined ? plan : plan.gt('version', cursor);
          return args.maxVersion === undefined ? lower : lower.lte('version', args.maxVersion);
        }
        // Below the cursor is already at or below maxVersion.
        if (cursor !== undefined) return plan.lt('version', cursor);
        return args.maxVersion === undefined ? plan : plan.lte('version', args.maxVersion);
      })
      .order(args.order)
      .first();
    if (!row) return { rows, mayHaveMore: false };
    rows.push(row);
    bytes += approxPlanVersionBytes(row);
    cursor = row.version;
  }
  return { rows, mayHaveMore: true };
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

  const { rows: candidates } = await readPlanVersionsWithinBudget(ctx, {
    planId: args.planId,
    order: 'asc',
    maxRows: PLAN_VERSION_PRUNE_BATCH + 1,
    budgetBytes: PLAN_VERSION_PRUNE_BUDGET_BYTES,
    maxVersion: cutoff,
  });

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
