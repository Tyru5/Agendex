import type { GenericId } from 'convex/values';
import { ConvexError, v } from 'convex/values';
import Stripe from 'stripe';
import { api, components, internal } from './_generated/api';
import type { Doc, TableNames } from './_generated/dataModel';
import { action, internalMutation, internalQuery, mutation, query } from './_generated/server';
import type { DatabaseReader, DatabaseWriter, MutationCtx } from './_generated/server';
import { deleteAllAgentAvatarsForOwner } from './agentAvatars';
import { authComponent } from './auth';
import { deleteCommentWithAttachments, deletePendingUploadRecord } from './comments';
import { deletePlanRelatedData } from './planDeletion';
import { stripLocalIpFromMetadata } from './privacy';

const DEFAULT_COLLECT_LOCAL_IP_ADDRESS = true;

async function findAccountPreferences(
  ctx: { db: DatabaseReader | DatabaseWriter },
  ownerId: string,
) {
  return await ctx.db
    .query('accountPreferences')
    .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
    .first();
}

async function scrubLocalIpAddressForOwner(ctx: MutationCtx, ownerId: string) {
  const plans = await ctx.db
    .query('plans')
    .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
    .collect();
  for (const plan of plans) {
    const result = stripLocalIpFromMetadata(plan.metadata);
    if (result.changed) await ctx.db.patch(plan._id, { metadata: result.metadata });
  }

  const versions = await ctx.db
    .query('planVersions')
    .withIndex('by_owner_createdAt', (q) => q.eq('ownerId', ownerId))
    .collect();
  for (const version of versions) {
    const result = stripLocalIpFromMetadata(version.metadata);
    if (result.changed) await ctx.db.patch(version._id, { metadata: result.metadata });
  }
}

export const getPrivacyPreferencesForOwner = internalQuery({
  args: { ownerId: v.string() },
  handler: async (ctx, { ownerId }) => {
    const prefs = await findAccountPreferences(ctx, ownerId);
    return {
      collectLocalIpAddress: prefs?.collectLocalIpAddress ?? DEFAULT_COLLECT_LOCAL_IP_ADDRESS,
      localIpDisclosureAcknowledgedAt: prefs?.localIpDisclosureAcknowledgedAt ?? null,
    };
  },
});

export const getMyPrivacyPreferences = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return null;

    const ownerId = String(user._id);
    const prefs = await findAccountPreferences(ctx, ownerId);
    return {
      collectLocalIpAddress: prefs?.collectLocalIpAddress ?? DEFAULT_COLLECT_LOCAL_IP_ADDRESS,
      localIpDisclosureAcknowledgedAt: prefs?.localIpDisclosureAcknowledgedAt ?? null,
    };
  },
});

export const updatePrivacyPreferences = mutation({
  args: {
    collectLocalIpAddress: v.optional(v.boolean()),
    acknowledgeLocalIpDisclosure: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) throw new ConvexError('Not authenticated');

    const ownerId = String(user._id);
    const existing = await findAccountPreferences(ctx, ownerId);
    const now = Date.now();
    const nextCollectLocalIpAddress =
      args.collectLocalIpAddress ??
      existing?.collectLocalIpAddress ??
      DEFAULT_COLLECT_LOCAL_IP_ADDRESS;
    const patch = {
      collectLocalIpAddress: nextCollectLocalIpAddress,
      ...(args.acknowledgeLocalIpDisclosure ? { localIpDisclosureAcknowledgedAt: now } : {}),
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert('accountPreferences', {
        ownerId,
        createdAt: now,
        ...patch,
      });
    }

    if (args.collectLocalIpAddress === false) {
      await scrubLocalIpAddressForOwner(ctx, ownerId);
    }

    return {
      collectLocalIpAddress: nextCollectLocalIpAddress,
      localIpDisclosureAcknowledgedAt:
        patch.localIpDisclosureAcknowledgedAt ?? existing?.localIpDisclosureAcknowledgedAt ?? null,
    };
  },
});

export const deleteAccount = action({
  handler: async (ctx) => {
    const user = await ctx.runQuery(api.auth.getCurrentUser);
    if (!user) throw new ConvexError('Not authenticated');

    const sub = await ctx.runQuery(api.subscriptions.getMySubscriptionQuery);
    if (sub?.stripeSubscriptionId) {
      const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
      if (!stripeSecretKey) throw new ConvexError('STRIPE_SECRET_KEY not configured');

      const stripeClient = new Stripe(stripeSecretKey);
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

    async function deletePendingUploads(
      rows: Array<Pick<Doc<'pendingUploads'>, '_id' | 'storageId'>>,
    ) {
      for (const row of rows) {
        await deletePendingUploadRecord(ctx, row);
      }
    }

    const plans = await ctx.db
      .query('plans')
      .withIndex('by_owner', (q) => q.eq('ownerId', userId))
      .collect();

    for (const plan of plans) {
      await deletePlanRelatedData(ctx, { planId: plan._id, ownerId: userId });
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
        .query('accountPreferences')
        .withIndex('by_owner', (q) => q.eq('ownerId', userId))
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
      await deleteCommentWithAttachments(ctx, comment);
    }
    await deletePendingUploads(
      await ctx.db
        .query('pendingUploads')
        .withIndex('by_uploadedBy', (q) => q.eq('uploadedBy', userId))
        .collect(),
    );
    await deleteRows(
      await ctx.db
        .query('workspaceInvites')
        .withIndex('by_workspace', (q) => q.eq('workspaceOwnerId', userId))
        .collect(),
    );
    await deleteRows(
      await ctx.db
        .query('commentUploadReservations')
        .withIndex('by_uploadedBy', (q) => q.eq('uploadedBy', userId))
        .collect(),
    );
    await deleteAllAgentAvatarsForOwner(ctx, userId);
  },
});
