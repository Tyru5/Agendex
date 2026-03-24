import type { GenericId } from 'convex/values';
import { ConvexError, v } from 'convex/values';
import Stripe from 'stripe';
import { api, components, internal } from './_generated/api';
import type { TableNames } from './_generated/dataModel';
import { action, internalMutation } from './_generated/server';

export const deleteAccount = action({
  handler: async (ctx) => {
    const user = await ctx.runQuery(api.auth.getCurrentUser);
    if (!user) throw new ConvexError('Not authenticated');

    const sub = await ctx.runQuery(api.subscriptions.getMySubscriptionQuery);
    if (sub?.stripeSubscriptionId) {
      const stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY!);
      await stripeClient.subscriptions.cancel(sub.stripeSubscriptionId);
    }

    await ctx.runMutation(internal.account.purgeUserData, { userId: user._id });
    await ctx.runMutation(internal.account.deleteAuthRecords, { userId: user._id });
  },
});

export const deleteAuthRecords = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
      input: {
        model: 'session',
        where: [{ field: 'userId', value: userId }],
      },
      paginationOpts: { cursor: null, numItems: 1000 },
    });

    await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
      input: {
        model: 'account',
        where: [{ field: 'userId', value: userId }],
      },
      paginationOpts: { cursor: null, numItems: 1000 },
    });

    await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
      input: {
        model: 'user',
        where: [{ field: '_id', value: userId }],
      },
    });
  },
});

export const purgeUserData = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    async function deleteRows<T extends TableNames>(rows: Array<{ _id: GenericId<T> }>) {
      for (const row of rows) await ctx.db.delete(row._id);
    }

    const plans = await ctx.db
      .query('plans')
      .withIndex('by_owner', (q) => q.eq('ownerId', userId))
      .collect();

    for (const plan of plans) {
      await deleteRows(
        await ctx.db
          .query('shareLinks')
          .withIndex('by_plan', (q) => q.eq('planId', plan._id))
          .collect(),
      );
      const planComments = await ctx.db
        .query('comments')
        .withIndex('by_plan', (q) => q.eq('planId', plan._id))
        .collect();
      for (const comment of planComments) {
        await deleteRows(
          await ctx.db
            .query('commentAttachmentClaims')
            .withIndex('by_comment', (q) => q.eq('commentId', comment._id))
            .collect(),
        );
        await ctx.db.delete(comment._id);
      }
      await deleteRows(
        await ctx.db
          .query('planVersions')
          .withIndex('by_plan', (q) => q.eq('planId', plan._id))
          .collect(),
      );
      await deleteRows(
        await ctx.db
          .query('planTags')
          .withIndex('by_plan', (q) => q.eq('planId', plan._id))
          .collect(),
      );
      await deleteRows(
        await ctx.db
          .query('collectionPlans')
          .withIndex('by_plan', (q) => q.eq('planId', plan._id))
          .collect(),
      );
      await deleteRows(
        await ctx.db
          .query('planPreferences')
          .withIndex('by_owner_plan', (q) => q.eq('ownerId', userId).eq('planId', plan._id))
          .collect(),
      );
      await ctx.db.delete(plan._id);
    }

    await deleteRows(
      await ctx.db
        .query('tags')
        .withIndex('by_owner', (q) => q.eq('ownerId', userId))
        .collect(),
    );

    const collections = await ctx.db
      .query('collections')
      .withIndex('by_owner', (q) => q.eq('ownerId', userId))
      .collect();
    for (const col of collections) {
      await deleteRows(
        await ctx.db
          .query('collectionPlans')
          .withIndex('by_collection', (q) => q.eq('collectionId', col._id))
          .collect(),
      );
      await ctx.db.delete(col._id);
    }

    await deleteRows(
      await ctx.db
        .query('planPreferences')
        .withIndex('by_owner', (q) => q.eq('ownerId', userId))
        .collect(),
    );
    await deleteRows(
      await ctx.db
        .query('subscriptions')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .collect(),
    );
    await deleteRows(
      await ctx.db
        .query('workspaceMembers')
        .withIndex('by_workspace', (q) => q.eq('workspaceOwnerId', userId))
        .collect(),
    );
    await deleteRows(
      await ctx.db
        .query('workspaceMembers')
        .withIndex('by_member', (q) => q.eq('memberId', userId))
        .collect(),
    );
    await deleteRows(
      await ctx.db
        .query('daemonHeartbeats')
        .withIndex('by_owner', (q) => q.eq('ownerId', userId))
        .collect(),
    );
    const authoredComments = await ctx.db
      .query('comments')
      .filter((q) => q.eq(q.field('authorId'), userId))
      .collect();
    for (const comment of authoredComments) {
      await deleteRows(
        await ctx.db
          .query('commentAttachmentClaims')
          .withIndex('by_comment', (q) => q.eq('commentId', comment._id))
          .collect(),
      );
      await ctx.db.delete(comment._id);
    }
  },
});
