import { ConvexError, v } from 'convex/values';
import Stripe from 'stripe';
import { api, components, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server';
import type { DatabaseReader, DatabaseWriter, MutationCtx } from './_generated/server';
import {
  ACCOUNT_DELETION_BATCH_SIZE,
  AUTH_DELETION_BATCH_SIZE,
  accountDeletionPhaseAfterBatch,
  accountDeletionPhaseValidator,
  accountDeletionRetryDelayMs,
  isStripeSubscriptionAlreadyCanceled,
  nextAccountDeletionPhase,
} from './accountDeletionState';
import { authComponent } from './auth';
import { deleteCommentWithAttachments, deletePendingUploadRecord } from './comments';
import {
  deletePlanRelatedDataBatch,
  PLAN_DELETION_PHASES,
  type PlanDeletionPhase,
} from './planDeletion';
import { stripLocalIpFromMetadata } from './privacy';

const DEFAULT_COLLECT_LOCAL_IP_ADDRESS = true;
const DEFAULT_EMPTY_STATE_PLAN_VIEW = 'list' as const;
const LOCAL_IP_SCRUB_BATCH_SIZE = 250;

type LocalIpScrubPhase = 'plans' | 'planVersions' | 'daemonHeartbeats';

async function findAccountPreferences(
  ctx: { db: DatabaseReader | DatabaseWriter },
  ownerId: string,
) {
  return await ctx.db
    .query('accountPreferences')
    .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
    .first();
}

async function scheduleLocalIpScrubBatch(
  ctx: MutationCtx,
  ownerId: string,
  phase: LocalIpScrubPhase,
  cursor: string | null,
) {
  await ctx.scheduler.runAfter(0, internal.account.scrubLocalIpAddressBatch, {
    ownerId,
    phase,
    cursor,
  });
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
  returns: v.union(
    v.object({
      collectLocalIpAddress: v.boolean(),
      localIpDisclosureAcknowledgedAt: v.union(v.number(), v.null()),
    }),
    v.null(),
  ),
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

export const getMyPlanViewPreference = query({
  args: {},
  returns: v.union(v.literal('list'), v.literal('card'), v.null()),
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return null;

    const prefs = await findAccountPreferences(ctx, String(user._id));
    return prefs?.emptyStatePlanView ?? DEFAULT_EMPTY_STATE_PLAN_VIEW;
  },
});

export const updatePlanViewPreference = mutation({
  args: {
    emptyStatePlanView: v.union(v.literal('list'), v.literal('card')),
  },
  returns: v.union(v.literal('list'), v.literal('card')),
  handler: async (ctx, { emptyStatePlanView }) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) throw new ConvexError('Not authenticated');

    const ownerId = String(user._id);
    const existing = await findAccountPreferences(ctx, ownerId);
    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, { emptyStatePlanView, updatedAt: now });
    } else {
      await ctx.db.insert('accountPreferences', {
        ownerId,
        collectLocalIpAddress: DEFAULT_COLLECT_LOCAL_IP_ADDRESS,
        emptyStatePlanView,
        createdAt: now,
        updatedAt: now,
      });
    }

    return emptyStatePlanView;
  },
});

export const updatePrivacyPreferences = mutation({
  args: {
    collectLocalIpAddress: v.optional(v.boolean()),
    acknowledgeLocalIpDisclosure: v.optional(v.boolean()),
  },
  returns: v.object({
    collectLocalIpAddress: v.boolean(),
    localIpDisclosureAcknowledgedAt: v.union(v.number(), v.null()),
  }),
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
      await scheduleLocalIpScrubBatch(ctx, ownerId, 'plans', null);
    }

    return {
      collectLocalIpAddress: nextCollectLocalIpAddress,
      localIpDisclosureAcknowledgedAt:
        patch.localIpDisclosureAcknowledgedAt ?? existing?.localIpDisclosureAcknowledgedAt ?? null,
    };
  },
});

export const scrubLocalIpAddressBatch = internalMutation({
  args: {
    ownerId: v.string(),
    phase: v.union(v.literal('plans'), v.literal('planVersions'), v.literal('daemonHeartbeats')),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const prefs = await findAccountPreferences(ctx, args.ownerId);
    if ((prefs?.collectLocalIpAddress ?? DEFAULT_COLLECT_LOCAL_IP_ADDRESS) !== false) return;

    if (args.phase === 'plans') {
      const result = await ctx.db
        .query('plans')
        .withIndex('by_owner', (q) => q.eq('ownerId', args.ownerId))
        .paginate({ cursor: args.cursor, numItems: LOCAL_IP_SCRUB_BATCH_SIZE });

      for (const plan of result.page) {
        const scrubbed = stripLocalIpFromMetadata(plan.metadata);
        if (scrubbed.changed) await ctx.db.patch(plan._id, { metadata: scrubbed.metadata });
      }

      await scheduleLocalIpScrubBatch(
        ctx,
        args.ownerId,
        result.isDone ? 'planVersions' : 'plans',
        result.isDone ? null : result.continueCursor,
      );
      return;
    }

    if (args.phase === 'planVersions') {
      const result = await ctx.db
        .query('planVersions')
        .withIndex('by_owner_createdAt', (q) => q.eq('ownerId', args.ownerId))
        .paginate({ cursor: args.cursor, numItems: LOCAL_IP_SCRUB_BATCH_SIZE });

      for (const version of result.page) {
        const scrubbed = stripLocalIpFromMetadata(version.metadata);
        if (scrubbed.changed) await ctx.db.patch(version._id, { metadata: scrubbed.metadata });
      }

      await scheduleLocalIpScrubBatch(
        ctx,
        args.ownerId,
        result.isDone ? 'daemonHeartbeats' : 'planVersions',
        result.isDone ? null : result.continueCursor,
      );
      return;
    }

    const result = await ctx.db
      .query('daemonHeartbeats')
      .withIndex('by_owner', (q) => q.eq('ownerId', args.ownerId))
      .paginate({ cursor: args.cursor, numItems: LOCAL_IP_SCRUB_BATCH_SIZE });

    for (const heartbeat of result.page) {
      if (heartbeat.ipAddress !== undefined)
        await ctx.db.patch(heartbeat._id, { ipAddress: undefined });
    }

    if (!result.isDone) {
      await scheduleLocalIpScrubBatch(ctx, args.ownerId, args.phase, result.continueCursor);
    }
  },
});

const planDeletionPhaseValidator = v.union(
  v.literal('shareLinks'),
  v.literal('comments'),
  v.literal('pendingUploads'),
  v.literal('commentUploadReservations'),
  v.literal('planVersions'),
  v.literal('planAnnotations'),
  v.literal('plannotatorWritebacks'),
  v.literal('planTags'),
  v.literal('planLinks'),
  v.literal('collectionPlans'),
  v.literal('planPreferences'),
);

const accountDeletionJobValidator = v.object({
  _id: v.id('accountDeletionJobs'),
  _creationTime: v.number(),
  ownerId: v.string(),
  status: v.literal('deleting'),
  phase: accountDeletionPhaseValidator,
  activeSubscriptionId: v.optional(v.id('subscriptions')),
  stripeSubscriptionId: v.optional(v.string()),
  stripeCancellationRequired: v.optional(v.boolean()),
  stripeCanceledAt: v.optional(v.number()),
  activePlanId: v.optional(v.id('plans')),
  planPhase: v.optional(planDeletionPhaseValidator),
  attempt: v.number(),
  lastError: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

async function findAccountDeletionJob(
  ctx: { db: DatabaseReader | DatabaseWriter },
  ownerId: string,
) {
  return await ctx.db
    .query('accountDeletionJobs')
    .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
    .first();
}

async function scheduleAccountDeletionResume(ctx: MutationCtx, ownerId: string, delayMs = 0) {
  await ctx.scheduler.runAfter(delayMs, internal.account.resumeAccountDeletion, { ownerId });
}

async function deleteStorageObjectIfPresent(
  ctx: Pick<MutationCtx, 'db' | 'storage'>,
  storageId: Id<'_storage'>,
) {
  const metadata = await ctx.db.system.get(storageId);
  if (metadata) await ctx.storage.delete(storageId);
}

export const deleteAccount = action({
  args: {},
  returns: v.object({ status: v.literal('deleting') }),
  handler: async (ctx) => {
    const user: { _id: string } | null = await ctx.runQuery(api.auth.getCurrentUser);
    if (!user) throw new ConvexError('Not authenticated');

    await ctx.runMutation(internal.account.startAccountDeletion, { userId: user._id });
    return { status: 'deleting' as const };
  },
});

export const startAccountDeletion = internalMutation({
  args: { userId: v.string() },
  returns: v.object({ jobId: v.id('accountDeletionJobs') }),
  handler: async (ctx, { userId }) => {
    const existing = await findAccountDeletionJob(ctx, userId);
    if (existing) {
      await scheduleAccountDeletionResume(ctx, userId);
      return { jobId: existing._id };
    }

    const subscription = await ctx.db
      .query('subscriptions')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first();
    const now = Date.now();
    const jobId = await ctx.db.insert('accountDeletionJobs', {
      ownerId: userId,
      status: 'deleting',
      phase: 'cancelStripe',
      ...(subscription
        ? {
            activeSubscriptionId: subscription._id,
            stripeSubscriptionId: subscription.stripeSubscriptionId,
            stripeCancellationRequired: subscription.status !== 'canceled',
          }
        : {}),
      attempt: 0,
      createdAt: now,
      updatedAt: now,
    });

    await scheduleAccountDeletionResume(ctx, userId);
    return { jobId };
  },
});

export const getAccountDeletionJob = internalQuery({
  args: { ownerId: v.string() },
  returns: v.union(accountDeletionJobValidator, v.null()),
  handler: async (ctx, { ownerId }) => {
    return (await findAccountDeletionJob(ctx, ownerId)) ?? null;
  },
});

export const resumeAccountDeletion = internalAction({
  args: { ownerId: v.string() },
  returns: v.null(),
  handler: async (ctx, { ownerId }) => {
    try {
      const job: Doc<'accountDeletionJobs'> | null = await ctx.runQuery(
        internal.account.getAccountDeletionJob,
        { ownerId },
      );
      if (!job) return null;

      if (job.phase === 'cancelStripe') {
        if (job.stripeSubscriptionId && job.stripeCancellationRequired !== false) {
          const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
          if (!stripeSecretKey) throw new Error('STRIPE_SECRET_KEY not configured');

          const stripeClient = new Stripe(stripeSecretKey);
          try {
            await stripeClient.subscriptions.cancel(job.stripeSubscriptionId);
          } catch (error) {
            if (!isStripeSubscriptionAlreadyCanceled(error)) throw error;
          }
        }

        await ctx.runMutation(internal.account.completeStripeCancellation, { ownerId });
      } else {
        await ctx.runMutation(internal.account.runAccountDeletionBatch, { ownerId });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown account deletion error';
      await ctx.runMutation(internal.account.recordAccountDeletionFailure, {
        ownerId,
        error: message.slice(0, 1_000),
      });
    }

    return null;
  },
});

export const completeStripeCancellation = internalMutation({
  args: { ownerId: v.string() },
  returns: v.null(),
  handler: async (ctx, { ownerId }) => {
    const job = await findAccountDeletionJob(ctx, ownerId);
    if (!job || job.phase !== 'cancelStripe') return null;

    if (job.activeSubscriptionId) {
      const canceledSubscription = await ctx.db.get(job.activeSubscriptionId);
      if (
        canceledSubscription?.userId === ownerId &&
        canceledSubscription.stripeSubscriptionId === job.stripeSubscriptionId
      ) {
        await ctx.db.delete(canceledSubscription._id);
      }
    }

    const nextSubscription = await ctx.db
      .query('subscriptions')
      .withIndex('by_user', (q) => q.eq('userId', ownerId))
      .first();
    const now = Date.now();

    if (nextSubscription) {
      await ctx.db.patch(job._id, {
        activeSubscriptionId: nextSubscription._id,
        stripeSubscriptionId: nextSubscription.stripeSubscriptionId,
        attempt: 0,
        lastError: undefined,
        stripeCancellationRequired: nextSubscription.status !== 'canceled',
        updatedAt: now,
      });
    } else {
      const nextPhase = nextAccountDeletionPhase(job.phase);
      if (!nextPhase) throw new Error('Account deletion has no product-data phase');
      await ctx.db.patch(job._id, {
        phase: nextPhase,
        activeSubscriptionId: undefined,
        stripeSubscriptionId: undefined,
        stripeCancellationRequired: undefined,
        stripeCanceledAt: now,
        attempt: 0,
        lastError: undefined,
        updatedAt: now,
      });
    }
    await scheduleAccountDeletionResume(ctx, ownerId);
    return null;
  },
});

export const recordAccountDeletionFailure = internalMutation({
  args: {
    ownerId: v.string(),
    error: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { ownerId, error }) => {
    const job = await findAccountDeletionJob(ctx, ownerId);
    if (!job) return null;

    const attempt = job.attempt + 1;
    await ctx.db.patch(job._id, {
      attempt,
      lastError: error,
      updatedAt: Date.now(),
    });
    await scheduleAccountDeletionResume(ctx, ownerId, accountDeletionRetryDelayMs(attempt));
    return null;
  },
});

export const runAccountDeletionBatch = internalMutation({
  args: { ownerId: v.string() },
  returns: v.null(),
  handler: async (ctx, { ownerId }) => {
    const job = await findAccountDeletionJob(ctx, ownerId);
    if (!job || job.phase === 'cancelStripe') return null;

    if (job.phase === 'plans') {
      if (!job.activePlanId) {
        const plan = await ctx.db
          .query('plans')
          .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
          .first();

        if (!plan) {
          const nextPhase = nextAccountDeletionPhase(job.phase);
          if (!nextPhase) throw new Error('Account deletion has no phase after plans');
          await ctx.db.patch(job._id, {
            phase: nextPhase,
            attempt: 0,
            lastError: undefined,
            updatedAt: Date.now(),
          });
        } else {
          await ctx.db.patch(job._id, {
            activePlanId: plan._id,
            planPhase: PLAN_DELETION_PHASES[0],
            attempt: 0,
            lastError: undefined,
            updatedAt: Date.now(),
          });
        }

        await scheduleAccountDeletionResume(ctx, ownerId);
        return null;
      }

      const plan = await ctx.db.get(job.activePlanId);
      if (!plan || plan.ownerId !== ownerId) {
        await ctx.db.patch(job._id, {
          activePlanId: undefined,
          planPhase: undefined,
          attempt: 0,
          lastError: undefined,
          updatedAt: Date.now(),
        });
        await scheduleAccountDeletionResume(ctx, ownerId);
        return null;
      }

      const planPhase: PlanDeletionPhase = job.planPhase ?? PLAN_DELETION_PHASES[0];
      const result = await deletePlanRelatedDataBatch(ctx, {
        planId: plan._id,
        phase: planPhase,
        batchSize: ACCOUNT_DELETION_BATCH_SIZE,
      });

      if (result.deleted > 0) {
        await ctx.db.patch(job._id, {
          attempt: 0,
          lastError: undefined,
          updatedAt: Date.now(),
        });
      } else if (result.nextPhase) {
        await ctx.db.patch(job._id, {
          planPhase: result.nextPhase,
          attempt: 0,
          lastError: undefined,
          updatedAt: Date.now(),
        });
      } else {
        await ctx.db.delete(plan._id);
        await ctx.db.patch(job._id, {
          activePlanId: undefined,
          planPhase: undefined,
          attempt: 0,
          lastError: undefined,
          updatedAt: Date.now(),
        });
      }

      await scheduleAccountDeletionResume(ctx, ownerId);
      return null;
    }

    let deleted = 0;

    if (job.phase === 'comments') {
      const rows = await ctx.db
        .query('comments')
        .withIndex('by_author', (q) => q.eq('authorId', ownerId))
        .take(ACCOUNT_DELETION_BATCH_SIZE);
      for (const comment of rows) await deleteCommentWithAttachments(ctx, comment);
      deleted = rows.length;
    } else if (job.phase === 'planAnnotations') {
      const rows = await ctx.db
        .query('planAnnotations')
        .withIndex('by_author_plan', (q) => q.eq('authorId', ownerId))
        .take(ACCOUNT_DELETION_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete(row._id);
      deleted = rows.length;
    } else if (job.phase === 'shareLinks') {
      const rows = await ctx.db
        .query('shareLinks')
        .withIndex('by_createdBy', (q) => q.eq('createdBy', ownerId))
        .take(ACCOUNT_DELETION_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete(row._id);
      deleted = rows.length;
    } else if (job.phase === 'planVersions') {
      const rows = await ctx.db
        .query('planVersions')
        .withIndex('by_owner_createdAt', (q) => q.eq('ownerId', ownerId))
        .take(ACCOUNT_DELETION_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete(row._id);
      deleted = rows.length;
    } else if (job.phase === 'planLinks') {
      const rows = await ctx.db
        .query('planLinks')
        .withIndex('by_owner_plan', (q) => q.eq('ownerId', ownerId))
        .take(ACCOUNT_DELETION_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete(row._id);
      deleted = rows.length;
    } else if (job.phase === 'plannotatorWritebacks') {
      const rows = await ctx.db
        .query('plannotatorWritebacks')
        .withIndex('by_owner_status', (q) => q.eq('ownerId', ownerId))
        .take(ACCOUNT_DELETION_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete(row._id);
      deleted = rows.length;
    } else if (job.phase === 'planTags') {
      const rows = await ctx.db
        .query('planTags')
        .withIndex('by_owner_plan', (q) => q.eq('ownerId', ownerId))
        .take(ACCOUNT_DELETION_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete(row._id);
      deleted = rows.length;
    } else if (job.phase === 'planPreferences') {
      const rows = await ctx.db
        .query('planPreferences')
        .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
        .take(ACCOUNT_DELETION_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete(row._id);
      deleted = rows.length;
    } else if (job.phase === 'collectionPlans') {
      const rows = await ctx.db
        .query('collectionPlans')
        .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
        .take(ACCOUNT_DELETION_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete(row._id);
      deleted = rows.length;
    } else if (job.phase === 'tags') {
      const rows = await ctx.db
        .query('tags')
        .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
        .take(ACCOUNT_DELETION_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete(row._id);
      deleted = rows.length;
    } else if (job.phase === 'collections') {
      const rows = await ctx.db
        .query('collections')
        .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
        .take(ACCOUNT_DELETION_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete(row._id);
      deleted = rows.length;
    } else if (job.phase === 'pendingUploads') {
      const rows = await ctx.db
        .query('pendingUploads')
        .withIndex('by_uploadedBy', (q) => q.eq('uploadedBy', ownerId))
        .take(ACCOUNT_DELETION_BATCH_SIZE);
      for (const row of rows) await deletePendingUploadRecord(ctx, row);
      deleted = rows.length;
    } else if (job.phase === 'commentUploadReservations') {
      const rows = await ctx.db
        .query('commentUploadReservations')
        .withIndex('by_uploadedBy', (q) => q.eq('uploadedBy', ownerId))
        .take(ACCOUNT_DELETION_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete(row._id);
      deleted = rows.length;
    } else if (job.phase === 'agentAvatars') {
      const rows = await ctx.db
        .query('agentAvatars')
        .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
        .take(ACCOUNT_DELETION_BATCH_SIZE);
      for (const row of rows) {
        await deleteStorageObjectIfPresent(ctx, row.storageId);
        await ctx.db.delete(row._id);
      }
      deleted = rows.length;
    } else if (job.phase === 'agentAvatarUploadReservations') {
      const rows = await ctx.db
        .query('agentAvatarUploadReservations')
        .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
        .take(ACCOUNT_DELETION_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete(row._id);
      deleted = rows.length;
    } else if (job.phase === 'dataExports') {
      const rows = await ctx.db
        .query('dataExports')
        .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
        .take(ACCOUNT_DELETION_BATCH_SIZE);
      for (const row of rows) {
        if (row.storageId) await deleteStorageObjectIfPresent(ctx, row.storageId);
        await ctx.db.delete(row._id);
      }
      deleted = rows.length;
    } else if (job.phase === 'workspaceMembersOwned') {
      const rows = await ctx.db
        .query('workspaceMembers')
        .withIndex('by_workspace', (q) => q.eq('workspaceOwnerId', ownerId))
        .take(ACCOUNT_DELETION_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete(row._id);
      deleted = rows.length;
    } else if (job.phase === 'workspaceMembersMemberships') {
      const rows = await ctx.db
        .query('workspaceMembers')
        .withIndex('by_member', (q) => q.eq('memberId', ownerId))
        .take(ACCOUNT_DELETION_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete(row._id);
      deleted = rows.length;
    } else if (job.phase === 'workspaceInvites') {
      const rows = await ctx.db
        .query('workspaceInvites')
        .withIndex('by_workspace', (q) => q.eq('workspaceOwnerId', ownerId))
        .take(ACCOUNT_DELETION_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete(row._id);
      deleted = rows.length;
    } else if (job.phase === 'daemonHeartbeats') {
      const rows = await ctx.db
        .query('daemonHeartbeats')
        .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
        .take(ACCOUNT_DELETION_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete(row._id);
      deleted = rows.length;
    } else if (job.phase === 'subscriptions') {
      const subscription = await ctx.db
        .query('subscriptions')
        .withIndex('by_user', (q) => q.eq('userId', ownerId))
        .first();
      if (subscription) {
        await ctx.db.patch(job._id, {
          phase: 'cancelStripe',
          activeSubscriptionId: subscription._id,
          stripeSubscriptionId: subscription.stripeSubscriptionId,
          stripeCancellationRequired: subscription.status !== 'canceled',
          attempt: 0,
          lastError: undefined,
          updatedAt: Date.now(),
        });
        await scheduleAccountDeletionResume(ctx, ownerId);
        return null;
      }
      deleted = 0;
    } else if (job.phase === 'accountPreferences') {
      const rows = await ctx.db
        .query('accountPreferences')
        .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
        .take(ACCOUNT_DELETION_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete(row._id);
      deleted = rows.length;
    } else if (job.phase === 'authSessions') {
      const result: { count: number } = await ctx.runMutation(
        components.betterAuth.adapter.deleteMany,
        {
          input: {
            model: 'session',
            where: [{ field: 'userId', value: ownerId }],
          },
          paginationOpts: { cursor: null, numItems: AUTH_DELETION_BATCH_SIZE },
        },
      );
      deleted = result.count;
    } else if (job.phase === 'authAccounts') {
      const result: { count: number } = await ctx.runMutation(
        components.betterAuth.adapter.deleteMany,
        {
          input: {
            model: 'account',
            where: [{ field: 'userId', value: ownerId }],
          },
          paginationOpts: { cursor: null, numItems: AUTH_DELETION_BATCH_SIZE },
        },
      );
      deleted = result.count;
    } else if (job.phase === 'authUser') {
      await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
        input: {
          model: 'user',
          where: [{ field: '_id', value: ownerId }],
        },
      });
      await ctx.db.delete(job._id);
      return null;
    } else {
      const unhandledPhase: never = job.phase;
      throw new Error(`Unhandled account deletion phase: ${unhandledPhase}`);
    }

    const nextPhase = accountDeletionPhaseAfterBatch(job.phase, deleted);
    if (!nextPhase) throw new Error('Account deletion ended before auth user deletion');

    await ctx.db.patch(job._id, {
      phase: nextPhase,
      attempt: 0,
      lastError: undefined,
      updatedAt: Date.now(),
    });
    await scheduleAccountDeletionResume(ctx, ownerId);
    return null;
  },
});
