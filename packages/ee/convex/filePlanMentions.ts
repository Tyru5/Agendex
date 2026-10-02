import { paginationOptsValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { internalMutation, mutation, query } from './_generated/server';
import { authComponent } from './auth';
import {
  FILE_MENTION_INDEX_VERSION,
  normalizeFileMentionPath,
  normalizeMentionWorkspace,
  refreshFilePlanMentions,
} from './filePlanMentionIndex';
import { resolvePublishedPlansOwnerId } from './plans';

const MAX_QUERY_FILES = 8;
const MAX_COUNT_PATHS = 20;
const COUNT_LIMIT = 100;
const BACKFILL_BATCH_SIZE = 3;

function validatePaths(paths: string[], limit: number): void {
  if (
    paths.length < 1 ||
    paths.length > limit ||
    paths.some((path) => !path.trim() || path.length > 1024 || path.includes('\0'))
  ) {
    throw new ConvexError(
      `Provide between 1 and ${limit} file paths, each at most 1024 characters`,
    );
  }
}

async function readOwner(ctx: QueryCtx): Promise<string | null> {
  const user = await authComponent.safeGetAuthUser(ctx);
  return user ? resolvePublishedPlansOwnerId(ctx, user._id) : null;
}

async function indexComplete(ctx: QueryCtx, ownerId: string): Promise<boolean> {
  const pending = await ctx.db
    .query('plans')
    .withIndex('by_owner_and_fileMentionIndexVersion', (q) =>
      q.eq('ownerId', ownerId).lt('fileMentionIndexVersion', FILE_MENTION_INDEX_VERSION),
    )
    .first();
  if (pending) return false;
  const truncated = await ctx.db
    .query('plans')
    .withIndex('by_owner_and_fileMentionIndexTruncated', (q) =>
      q.eq('ownerId', ownerId).eq('fileMentionIndexTruncated', true),
    )
    .first();
  return truncated === null;
}

function mentionsForPath(ctx: QueryCtx, ownerId: string, path: string, workspace?: string) {
  return ctx.db
    .query('filePlanMentions')
    .withIndex('by_owner_and_path_and_visible_and_workspace', (q) => {
      const base = q.eq('ownerId', ownerId).eq('path', path).eq('visible', true);
      return workspace === undefined ? base : base.eq('workspace', workspace);
    });
}

async function indexOwnerBatch(ctx: MutationCtx, ownerId: string) {
  const plans = await ctx.db
    .query('plans')
    .withIndex('by_owner_and_fileMentionIndexVersion', (q) =>
      q.eq('ownerId', ownerId).lt('fileMentionIndexVersion', FILE_MENTION_INDEX_VERSION),
    )
    .take(BACKFILL_BATCH_SIZE);
  for (const plan of plans) await refreshFilePlanMentions(ctx, plan._id);
  const done = plans.length < BACKFILL_BATCH_SIZE;
  if (!done) await ctx.scheduler.runAfter(0, internal.filePlanMentions.backfillOwner, { ownerId });
  return { indexed: plans.length, done };
}

/** Start legacy indexing immediately when an authorized dashboard opens it. */
export const ensureIndex = mutation({
  args: {},
  returns: v.object({ scheduled: v.boolean() }),
  handler: async (ctx) => {
    const ownerId = await readOwner(ctx);
    if (!ownerId) return { scheduled: false };
    const result = await indexOwnerBatch(ctx, ownerId);
    return { scheduled: !result.done };
  },
});

export const backfillOwner = internalMutation({
  args: { ownerId: v.string() },
  returns: v.object({ indexed: v.number(), done: v.boolean() }),
  handler: async (ctx, args) => indexOwnerBatch(ctx, args.ownerId),
});

export const indexingStatus = query({
  args: {},
  returns: v.object({ complete: v.boolean() }),
  handler: async (ctx) => {
    const ownerId = await readOwner(ctx);
    return { complete: ownerId ? await indexComplete(ctx, ownerId) : true };
  },
});

export const lookup = query({
  args: {
    files: v.array(v.string()),
    workspace: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(v.string()),
    isDone: v.boolean(),
    continueCursor: v.string(),
    indexingComplete: v.boolean(),
  }),
  handler: async (ctx, args) => {
    validatePaths(args.files, MAX_QUERY_FILES);
    if (
      !Number.isInteger(args.paginationOpts.numItems) ||
      args.paginationOpts.numItems < 1 ||
      args.paginationOpts.numItems > 100
    ) {
      throw new ConvexError('Page size must be between 1 and 100');
    }
    const ownerId = await readOwner(ctx);
    if (!ownerId) return { page: [], isDone: true, continueCursor: '', indexingComplete: true };
    const indexingComplete = await indexComplete(ctx, ownerId);
    const workspace =
      args.workspace === undefined ? undefined : normalizeMentionWorkspace(args.workspace);
    const paths = [...new Set(args.files.map((path) => normalizeFileMentionPath(path, workspace)))];
    const first = paths[0];
    if (!first || paths.some((path) => path === null))
      return { page: [], isDone: true, continueCursor: '', indexingComplete };
    // Exactly one paginated range per invocation. Additional filters are indexed
    // point reads per candidate, so intersections never scan the owner corpus.
    const result = await mentionsForPath(ctx, ownerId, first, workspace)
      .order('desc')
      .paginate(args.paginationOpts);
    const page: string[] = [];
    for (const candidate of result.page) {
      let matches = true;
      for (const path of paths.slice(1)) {
        if (!path) continue;
        const row = await ctx.db
          .query('filePlanMentions')
          .withIndex('by_plan_and_path', (q) => q.eq('planId', candidate.planId).eq('path', path))
          .first();
        if (
          !row ||
          !row.visible ||
          row.ownerId !== ownerId ||
          (workspace !== undefined && row.workspace !== workspace)
        ) {
          matches = false;
          break;
        }
      }
      if (matches) page.push(String(candidate.planId));
    }
    return { page, isDone: result.isDone, continueCursor: result.continueCursor, indexingComplete };
  },
});

export const counts = query({
  args: { paths: v.array(v.string()), workspace: v.optional(v.string()) },
  returns: v.array(v.object({ path: v.string(), count: v.number(), exact: v.boolean() })),
  handler: async (ctx, args) => {
    validatePaths(args.paths, MAX_COUNT_PATHS);
    const ownerId = await readOwner(ctx);
    if (!ownerId) return args.paths.map((path) => ({ path, count: 0, exact: true }));
    const complete = await indexComplete(ctx, ownerId);
    const workspace =
      args.workspace === undefined ? undefined : normalizeMentionWorkspace(args.workspace);
    const results: { path: string; count: number; exact: boolean }[] = [];
    for (const path of args.paths) {
      const normalized = normalizeFileMentionPath(path, workspace);
      const rows = normalized
        ? await mentionsForPath(ctx, ownerId, normalized, workspace).take(COUNT_LIMIT + 1)
        : [];
      results.push({
        path,
        count: Math.min(rows.length, COUNT_LIMIT),
        exact: complete && rows.length <= COUNT_LIMIT,
      });
    }
    return results;
  },
});

/** Three plans bound reads/writes even at 512 maximum-length path rows per plan. */
export const backfill = internalMutation({
  args: {},
  returns: v.object({ indexed: v.number(), done: v.boolean() }),
  handler: async (ctx) => {
    const plans = await ctx.db
      .query('plans')
      .withIndex('by_fileMentionIndexVersion', (q) =>
        q.lt('fileMentionIndexVersion', FILE_MENTION_INDEX_VERSION),
      )
      .take(BACKFILL_BATCH_SIZE);
    for (const plan of plans) await refreshFilePlanMentions(ctx, plan._id);
    const done = plans.length < BACKFILL_BATCH_SIZE;
    if (!done) await ctx.scheduler.runAfter(0, internal.filePlanMentions.backfill, {});
    return { indexed: plans.length, done };
  },
});
