import { MAX_READ_SNAPSHOT_BYTES } from '@agendex/shared/plan-read';
import { ConvexError, v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import { type MutationCtx, mutation } from './_generated/server';
import { authComponent } from './auth';
import { recordPlanVersion } from './planVersioning';

const readResult = v.object({
  baseline: v.union(
    v.null(),
    v.object({ title: v.string(), content: v.string(), updatedAt: v.string() }),
  ),
  reason: v.union(
    v.literal('available'),
    v.literal('first-read'),
    v.literal('unavailable'),
    v.literal('too-large'),
  ),
});

async function clearRememberedRead(
  ctx: Pick<MutationCtx, 'db'>,
  preference: Doc<'planPreferences'> | null,
  now: number,
) {
  if (!preference) return;
  if (!preference.pinned && preference.lastSeenUpdatedAt === undefined) {
    await ctx.db.delete(preference._id);
    return;
  }
  await ctx.db.patch(preference._id, {
    lastReadVersion: undefined,
    lastReadAt: undefined,
    lastReadUpdatedAt: undefined,
    updatedAt: now,
  });
}
/** A transactional read captures the previous version before advancing the boundary. */
export const open = mutation({
  args: { planId: v.id('plans'), updatedAt: v.number(), title: v.string(), content: v.string() },
  returns: readResult,
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');
    const plan = await ctx.db.get(args.planId);
    if (!plan || plan.ownerId !== user._id) throw new ConvexError('Plan not found');
    // Never record an unloaded list stub or a revision replaced during hydration.
    if (
      plan.updatedAt !== args.updatedAt ||
      plan.title !== args.title ||
      plan.content !== args.content
    )
      throw new ConvexError(
        'The displayed revision is stale. Reload the plan to record it as read.',
      );
    const previous = await ctx.db
      .query('planPreferences')
      .withIndex('by_owner_plan', (q) => q.eq('ownerId', user._id).eq('planId', args.planId))
      .first();
    const readVersion = previous?.lastReadVersion;
    const snapshot =
      readVersion === undefined
        ? null
        : await ctx.db
            .query('planVersions')
            .withIndex('by_plan_version', (q) =>
              q.eq('planId', args.planId).eq('version', readVersion),
            )
            .first();
    const oversized =
      new TextEncoder().encode(
        JSON.stringify({
          title: plan.title,
          content: plan.content,
          updatedAt: new Date(plan.updatedAt).toISOString(),
        }),
      ).byteLength > MAX_READ_SNAPSHOT_BYTES;
    let versionToRemember = plan.version;
    if (!oversized) {
      const currentSnapshot = await ctx.db
        .query('planVersions')
        .withIndex('by_plan_version', (q) =>
          q.eq('planId', args.planId).eq('version', plan.version),
        )
        .first();
      // Legacy title-only renames did not advance plan.version. Preserve the
      // immutable old snapshot and repair the counter before remembering content.
      if (
        currentSnapshot &&
        (currentSnapshot.title !== plan.title || currentSnapshot.content !== plan.content)
      ) {
        const latest = await ctx.db
          .query('planVersions')
          .withIndex('by_plan_version', (q) => q.eq('planId', args.planId))
          .order('desc')
          .first();
        versionToRemember = Math.max(plan.version, latest?.version ?? plan.version) + 1;
        await ctx.db.patch(args.planId, { version: versionToRemember });
      }
      if (!currentSnapshot || versionToRemember !== plan.version)
        await recordPlanVersion(ctx, {
          ownerId: user._id,
          planId: args.planId,
          version: versionToRemember,
          snapshot: plan,
          source: 'backfill',
          createdAt: plan.updatedAt,
        });
    }
    const now = Date.now();
    if (oversized) {
      await clearRememberedRead(ctx, previous, now);
      return { baseline: null, reason: 'too-large' as const };
    }
    const fields = {
      lastReadVersion: versionToRemember,
      lastReadAt: now,
      lastReadUpdatedAt: plan.updatedAt,
      updatedAt: now,
    };
    if (previous) await ctx.db.patch(previous._id, fields);
    else
      await ctx.db.insert('planPreferences', {
        ownerId: user._id,
        planId: args.planId,
        pinned: false,
        createdAt: now,
        ...fields,
      });
    if (!previous || previous.lastReadVersion === undefined)
      return { baseline: null, reason: 'first-read' as const };
    if (!snapshot || snapshot.ownerId !== user._id)
      return { baseline: null, reason: 'unavailable' as const };
    return {
      baseline: {
        title: snapshot.title,
        content: snapshot.content,
        updatedAt: new Date(previous.lastReadUpdatedAt ?? snapshot.createdAt).toISOString(),
      },
      reason: 'available' as const,
    };
  },
});
export const clear = mutation({
  args: { planId: v.id('plans') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');
    const plan = await ctx.db.get(args.planId);
    if (!plan || plan.ownerId !== user._id) throw new ConvexError('Plan not found');
    const previous = await ctx.db
      .query('planPreferences')
      .withIndex('by_owner_plan', (q) => q.eq('ownerId', user._id).eq('planId', args.planId))
      .first();
    await clearRememberedRead(ctx, previous, Date.now());
    return null;
  },
});
