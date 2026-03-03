import { ConvexError } from 'convex/values';
import { v } from 'convex/values';
import Stripe from 'stripe';
import { api, internal } from './_generated/api';
import { action, internalMutation } from './_generated/server';
import { authComponent } from './auth';

export const deleteAccount = action({
  handler: async (ctx) => {
    const user = await ctx.runQuery(api.auth.getCurrentUser);
    if (!user) throw new ConvexError('Not authenticated');

    // Cancel Stripe subscription if exists
    // biome-ignore lint/suspicious/noExplicitAny: Convex component API not in generated types
    const sub = await ctx.runQuery((api as any).subscriptions.getMySubscriptionQuery);
    if (sub?.stripeSubscriptionId) {
      const stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY!);
      await stripeClient.subscriptions.cancel(sub.stripeSubscriptionId);
    }

    // biome-ignore lint/suspicious/noExplicitAny: account module not yet in generated types
    await ctx.runMutation((internal as any).account.purgeUserData, { userId: user._id });
  },
});

export const purgeUserData = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    async function deleteAll(table: string, indexName: string, indexField: string) {
      const rows = await (ctx.db as any)
        .query(table)
        .withIndex(indexName, (q: any) => q.eq(indexField, userId))
        .collect();
      for (const row of rows) {
        await ctx.db.delete(row._id);
      }
    }

    // Plans + related data
    const plans = await ctx.db
      .query('plans')
      .withIndex('by_owner', (q: any) => q.eq('ownerId', userId))
      .collect();

    for (const plan of plans) {
      // Delete share links for this plan
      const shareLinks = await ctx.db
        .query('shareLinks')
        .withIndex('by_plan', (q: any) => q.eq('planId', plan._id))
        .collect();
      for (const link of shareLinks) await ctx.db.delete(link._id);

      // Delete comments for this plan
      const comments = await ctx.db
        .query('comments')
        .withIndex('by_plan', (q: any) => q.eq('planId', plan._id))
        .collect();
      for (const comment of comments) await ctx.db.delete(comment._id);

      // Delete plan versions
      const versions = await ctx.db
        .query('planVersions')
        .withIndex('by_plan', (q: any) => q.eq('planId', plan._id))
        .collect();
      for (const version of versions) await ctx.db.delete(version._id);

      // Delete plan tags
      const planTags = await ctx.db
        .query('planTags')
        .withIndex('by_plan', (q: any) => q.eq('planId', plan._id))
        .collect();
      for (const pt of planTags) await ctx.db.delete(pt._id);

      // Delete collection associations
      const collectionPlans = await ctx.db
        .query('collectionPlans')
        .withIndex('by_plan', (q: any) => q.eq('planId', plan._id))
        .collect();
      for (const cp of collectionPlans) await ctx.db.delete(cp._id);

      await ctx.db.delete(plan._id);
    }

    // Tags
    await deleteAll('tags', 'by_owner', 'ownerId');

    // Collections
    const collections = await ctx.db
      .query('collections')
      .withIndex('by_owner', (q: any) => q.eq('ownerId', userId))
      .collect();
    for (const col of collections) {
      const colPlans = await ctx.db
        .query('collectionPlans')
        .withIndex('by_collection', (q: any) => q.eq('collectionId', col._id))
        .collect();
      for (const cp of colPlans) await ctx.db.delete(cp._id);
      await ctx.db.delete(col._id);
    }

    // Subscription
    await deleteAll('subscriptions', 'by_user', 'userId');

    // Workspace members (as owner and as member)
    await deleteAll('workspaceMembers', 'by_workspace', 'workspaceOwnerId');
    await deleteAll('workspaceMembers', 'by_member', 'memberId');

    // Daemon heartbeats
    await deleteAll('daemonHeartbeats', 'by_owner', 'ownerId');

    // Comments authored by this user on other users' plans
    const authoredComments = await ctx.db
      .query('comments')
      .filter((q: any) => q.eq(q.field('authorId'), userId))
      .collect();
    for (const c of authoredComments) await ctx.db.delete(c._id);
  },
});
