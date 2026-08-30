import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from './_generated/server';
import { authComponent } from './auth';
import {
  DATA_EXPORT_TTL_MS,
  decideExportBuildClaim,
  isExportDownloadAvailable,
  redactShareLink,
  type ShareLinkForExport,
} from './dataExportRedaction';

const EXPORT_PAGE_SIZE = 50;
const EXPORT_BUILD_LEASE_MS = 10 * 60 * 1000;

const dataExportStatusValidator = v.union(
  v.literal('pending'),
  v.literal('building'),
  v.literal('ready'),
  v.literal('failed'),
);

const dataExportSummaryValidator = v.object({
  exportId: v.id('dataExports'),
  status: dataExportStatusValidator,
  createdAt: v.number(),
  updatedAt: v.number(),
  expiresAt: v.number(),
  error: v.union(v.string(), v.null()),
  byteSize: v.union(v.number(), v.null()),
  fileName: v.union(v.string(), v.null()),
  downloadUrl: v.union(v.string(), v.null()),
});

const serializedPageValidator = v.object({
  rowsJson: v.string(),
  isDone: v.boolean(),
  continueCursor: v.string(),
});

const accountSectionValidator = v.union(
  v.literal('preferences'),
  v.literal('subscriptions'),
  v.literal('workspaceMembersAsOwner'),
  v.literal('workspaceMembersAsMember'),
  v.literal('workspaceInvites'),
  v.literal('heartbeats'),
  v.literal('tags'),
  v.literal('collections'),
  v.literal('collectionPlans'),
  v.literal('planPreferences'),
  v.literal('agentAvatars'),
  v.literal('pendingUploads'),
  v.literal('uploadReservations'),
  v.literal('avatarUploadReservations'),
);

const planSectionValidator = v.union(
  v.literal('versions'),
  v.literal('annotations'),
  v.literal('comments'),
  v.literal('shareLinks'),
  v.literal('planLinks'),
  v.literal('writebacks'),
  v.literal('planTags'),
);

function serializePage(result: { page: unknown[]; isDone: boolean; continueCursor: string }) {
  return {
    rowsJson: JSON.stringify(result.page),
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  };
}

async function requireAuthUser(ctx: QueryCtx) {
  const user = await authComponent.safeGetAuthUser(ctx);
  if (!user) throw new ConvexError('Not authenticated');
  return user;
}

async function findActiveExport(ctx: QueryCtx, ownerId: string) {
  for (const status of ['pending', 'building'] as const) {
    const existing = await ctx.db
      .query('dataExports')
      .withIndex('by_owner_status', (q) => q.eq('ownerId', ownerId).eq('status', status))
      .first();
    if (existing) return existing;
  }
  return null;
}

export const requestDataExport = mutation({
  args: {},
  returns: v.object({ exportId: v.id('dataExports') }),
  handler: async (ctx) => {
    const user = await requireAuthUser(ctx);
    const ownerId = String(user._id);
    const deletionJob = await ctx.db
      .query('accountDeletionJobs')
      .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
      .first();
    if (deletionJob) {
      throw new ConvexError('Account deletion is already in progress');
    }

    const active = await findActiveExport(ctx, ownerId);
    if (active) return { exportId: active._id };

    const now = Date.now();
    const exportId = await ctx.db.insert('dataExports', {
      ownerId,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      expiresAt: now + DATA_EXPORT_TTL_MS,
    });

    await ctx.scheduler.runAfter(0, internal.dataExportActions.buildDataExport, { exportId });
    return { exportId };
  },
});

export const getMyDataExport = query({
  args: {},
  returns: v.union(dataExportSummaryValidator, v.null()),
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return null;

    const ownerId = String(user._id);
    const latest = await ctx.db
      .query('dataExports')
      .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
      .order('desc')
      .first();
    if (!latest) return null;

    let downloadUrl: string | null = null;
    if (
      isExportDownloadAvailable({
        status: latest.status,
        storageId: latest.storageId,
        expiresAt: latest.expiresAt,
      }) &&
      latest.storageId
    ) {
      downloadUrl = (await ctx.storage.getUrl(latest.storageId)) ?? null;
    }

    return {
      exportId: latest._id,
      status: latest.status,
      createdAt: latest.createdAt,
      updatedAt: latest.updatedAt,
      expiresAt: latest.expiresAt,
      error: latest.error ?? null,
      byteSize: latest.byteSize ?? null,
      fileName: latest.fileName ?? null,
      downloadUrl,
    };
  },
});

export const getExportJob = internalQuery({
  args: { exportId: v.id('dataExports') },
  returns: v.union(
    v.object({
      _id: v.id('dataExports'),
      ownerId: v.string(),
      status: dataExportStatusValidator,
      createdAt: v.number(),
      expiresAt: v.number(),
      storageId: v.union(v.id('_storage'), v.null()),
    }),
    v.null(),
  ),
  handler: async (ctx, { exportId }) => {
    const job = await ctx.db.get(exportId);
    if (!job) return null;
    return {
      _id: job._id,
      ownerId: job.ownerId,
      status: job.status,
      createdAt: job.createdAt,
      expiresAt: job.expiresAt,
      storageId: job.storageId ?? null,
    };
  },
});

export const claimExportBuild = internalMutation({
  args: {
    exportId: v.id('dataExports'),
    buildToken: v.string(),
  },
  returns: v.object({
    acquired: v.boolean(),
    retryAfterMs: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, { exportId, buildToken }) => {
    const job = await ctx.db.get(exportId);
    if (!job) return { acquired: false, retryAfterMs: null };

    const now = Date.now();
    const decision = decideExportBuildClaim({
      status: job.status,
      currentToken: job.buildToken,
      leaseExpiresAt: job.buildLeaseExpiresAt,
      proposedToken: buildToken,
      now,
    });
    if (decision === 'terminal') return { acquired: false, retryAfterMs: null };
    if (decision === 'retry') {
      return {
        acquired: false,
        retryAfterMs: Math.max(1_000, (job.buildLeaseExpiresAt ?? now) - now + 1_000),
      };
    }

    await ctx.db.patch(exportId, {
      status: 'building',
      buildToken,
      buildLeaseExpiresAt: now + EXPORT_BUILD_LEASE_MS,
      error: undefined,
      updatedAt: now,
    });
    return { acquired: true, retryAfterMs: null };
  },
});

export const markExportReady = internalMutation({
  args: {
    exportId: v.id('dataExports'),
    buildToken: v.string(),
    storageId: v.id('_storage'),
    byteSize: v.number(),
    fileName: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.exportId);
    if (!job || job.status !== 'building' || job.buildToken !== args.buildToken) {
      const metadata = await ctx.db.system.get(args.storageId);
      if (metadata) await ctx.storage.delete(args.storageId);
      return false;
    }

    if (job.storageId && job.storageId !== args.storageId) {
      const metadata = await ctx.db.system.get(job.storageId);
      if (metadata) await ctx.storage.delete(job.storageId);
    }
    await ctx.db.patch(args.exportId, {
      status: 'ready',
      storageId: args.storageId,
      byteSize: args.byteSize,
      fileName: args.fileName,
      error: undefined,
      buildToken: undefined,
      buildLeaseExpiresAt: undefined,
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const markExportFailed = internalMutation({
  args: {
    exportId: v.id('dataExports'),
    buildToken: v.string(),
    error: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { exportId, buildToken, error }) => {
    const job = await ctx.db.get(exportId);
    if (!job || job.status !== 'building' || job.buildToken !== buildToken) return null;
    await ctx.db.patch(exportId, {
      status: 'failed',
      error,
      buildToken: undefined,
      buildLeaseExpiresAt: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const listAccountSectionPage = internalQuery({
  args: {
    ownerId: v.string(),
    section: accountSectionValidator,
    cursor: v.union(v.string(), v.null()),
  },
  returns: serializedPageValidator,
  handler: async (ctx, { ownerId, section, cursor }) => {
    const paginationOpts = { cursor, numItems: EXPORT_PAGE_SIZE };
    switch (section) {
      case 'preferences':
        return serializePage(
          await ctx.db
            .query('accountPreferences')
            .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
            .paginate(paginationOpts),
        );
      case 'subscriptions':
        return serializePage(
          await ctx.db
            .query('subscriptions')
            .withIndex('by_user', (q) => q.eq('userId', ownerId))
            .paginate(paginationOpts),
        );
      case 'workspaceMembersAsOwner':
        return serializePage(
          await ctx.db
            .query('workspaceMembers')
            .withIndex('by_workspace', (q) => q.eq('workspaceOwnerId', ownerId))
            .paginate(paginationOpts),
        );
      case 'workspaceMembersAsMember':
        return serializePage(
          await ctx.db
            .query('workspaceMembers')
            .withIndex('by_member', (q) => q.eq('memberId', ownerId))
            .paginate(paginationOpts),
        );
      case 'workspaceInvites':
        return serializePage(
          await ctx.db
            .query('workspaceInvites')
            .withIndex('by_workspace', (q) => q.eq('workspaceOwnerId', ownerId))
            .paginate(paginationOpts),
        );
      case 'heartbeats':
        return serializePage(
          await ctx.db
            .query('daemonHeartbeats')
            .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
            .paginate(paginationOpts),
        );
      case 'tags':
        return serializePage(
          await ctx.db
            .query('tags')
            .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
            .paginate(paginationOpts),
        );
      case 'collections':
        return serializePage(
          await ctx.db
            .query('collections')
            .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
            .paginate(paginationOpts),
        );
      case 'collectionPlans':
        return serializePage(
          await ctx.db
            .query('collectionPlans')
            .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
            .paginate(paginationOpts),
        );
      case 'planPreferences':
        return serializePage(
          await ctx.db
            .query('planPreferences')
            .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
            .paginate(paginationOpts),
        );
      case 'agentAvatars':
        return serializePage(
          await ctx.db
            .query('agentAvatars')
            .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
            .paginate(paginationOpts),
        );
      case 'pendingUploads':
        return serializePage(
          await ctx.db
            .query('pendingUploads')
            .withIndex('by_uploadedBy', (q) => q.eq('uploadedBy', ownerId))
            .paginate(paginationOpts),
        );
      case 'uploadReservations':
        return serializePage(
          await ctx.db
            .query('commentUploadReservations')
            .withIndex('by_uploadedBy', (q) => q.eq('uploadedBy', ownerId))
            .paginate(paginationOpts),
        );
      case 'avatarUploadReservations':
        return serializePage(
          await ctx.db
            .query('agentAvatarUploadReservations')
            .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
            .paginate(paginationOpts),
        );
    }
  },
});

export const listOwnedPlansPage = internalQuery({
  args: {
    ownerId: v.string(),
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.object({
    planIds: v.array(v.id('plans')),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, { ownerId, cursor }) => {
    const result = await ctx.db
      .query('plans')
      .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
      .order('asc')
      .paginate({ cursor, numItems: EXPORT_PAGE_SIZE });
    return {
      planIds: result.page.map((plan) => plan._id),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const getOwnedPlanJson = internalQuery({
  args: {
    ownerId: v.string(),
    planId: v.id('plans'),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { ownerId, planId }) => {
    const plan = await ctx.db.get(planId);
    if (!plan || plan.ownerId !== ownerId) return null;
    return JSON.stringify(plan);
  },
});

export const listPlanSectionPage = internalQuery({
  args: {
    ownerId: v.string(),
    planId: v.id('plans'),
    section: planSectionValidator,
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.union(serializedPageValidator, v.null()),
  handler: async (ctx, { ownerId, planId, section, cursor }) => {
    const plan = await ctx.db.get(planId);
    if (!plan || plan.ownerId !== ownerId) return null;
    const paginationOpts = { cursor, numItems: EXPORT_PAGE_SIZE };

    switch (section) {
      case 'versions':
        return serializePage(
          await ctx.db
            .query('planVersions')
            .withIndex('by_plan', (q) => q.eq('planId', planId))
            .paginate(paginationOpts),
        );
      case 'annotations':
        return serializePage(
          await ctx.db
            .query('planAnnotations')
            .withIndex('by_plan', (q) => q.eq('planId', planId))
            .paginate(paginationOpts),
        );
      case 'comments':
        return serializePage(
          await ctx.db
            .query('comments')
            .withIndex('by_plan', (q) => q.eq('planId', planId))
            .paginate(paginationOpts),
        );
      case 'shareLinks': {
        const result = await ctx.db
          .query('shareLinks')
          .withIndex('by_plan', (q) => q.eq('planId', planId))
          .paginate(paginationOpts);
        const page = result.page.map((link) =>
          redactShareLink({
            _id: link._id,
            planId: link.planId,
            token: link.token,
            createdBy: link.createdBy,
            createdAt: link.createdAt,
            passwordHash: link.passwordHash,
          } satisfies ShareLinkForExport),
        );
        return serializePage({ ...result, page });
      }
      case 'planLinks':
        return serializePage(
          await ctx.db
            .query('planLinks')
            .withIndex('by_plan', (q) => q.eq('planId', planId))
            .paginate(paginationOpts),
        );
      case 'writebacks':
        return serializePage(
          await ctx.db
            .query('plannotatorWritebacks')
            .withIndex('by_plan', (q) => q.eq('planId', planId))
            .paginate(paginationOpts),
        );
      case 'planTags':
        return serializePage(
          await ctx.db
            .query('planTags')
            .withIndex('by_plan', (q) => q.eq('planId', planId))
            .paginate(paginationOpts),
        );
    }
  },
});

export const listAuthoredElsewhereCommentsPage = internalQuery({
  args: {
    ownerId: v.string(),
    cursor: v.union(v.string(), v.null()),
  },
  returns: serializedPageValidator,
  handler: async (ctx, { ownerId, cursor }) => {
    const result = await ctx.db
      .query('comments')
      .withIndex('by_author', (q) => q.eq('authorId', ownerId))
      .paginate({ cursor, numItems: EXPORT_PAGE_SIZE });

    const page = [];
    for (const comment of result.page) {
      const plan = await ctx.db.get(comment.planId);
      if (plan && plan.ownerId !== ownerId) page.push(comment);
    }
    return serializePage({ ...result, page });
  },
});

export const listCommentClaimsPage = internalQuery({
  args: {
    ownerId: v.string(),
    commentId: v.id('comments'),
    cursor: v.union(v.string(), v.null()),
  },
  returns: serializedPageValidator,
  handler: async (ctx, { ownerId, commentId, cursor }) => {
    const comment = await ctx.db.get(commentId);
    if (!comment) return { rowsJson: '[]', isDone: true, continueCursor: cursor ?? '' };
    const plan = await ctx.db.get(comment.planId);
    if (comment.authorId !== ownerId && plan?.ownerId !== ownerId) {
      return { rowsJson: '[]', isDone: true, continueCursor: cursor ?? '' };
    }

    return serializePage(
      await ctx.db
        .query('commentAttachmentClaims')
        .withIndex('by_comment', (q) => q.eq('commentId', commentId))
        .paginate({ cursor, numItems: EXPORT_PAGE_SIZE }),
    );
  },
});

const EXPIRED_EXPORT_DELETE_BATCH = 100;

export const deleteExpiredDataExports = internalMutation({
  args: {},
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query('dataExports')
      .withIndex('by_expiresAt', (q) => q.lt('expiresAt', now))
      .take(EXPIRED_EXPORT_DELETE_BATCH);

    let deleted = 0;
    for (const job of expired) {
      if (job.storageId) {
        try {
          await ctx.storage.delete(job.storageId);
        } catch {
          // Blob may already be gone.
        }
      }
      await ctx.db.delete(job._id);
      deleted += 1;
    }

    if (deleted === EXPIRED_EXPORT_DELETE_BATCH) {
      await ctx.scheduler.runAfter(0, internal.dataExport.deleteExpiredDataExports, {});
    }
    return { deleted };
  },
});
