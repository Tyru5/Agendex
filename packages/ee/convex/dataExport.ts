import { paginationOptsValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
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
  redactShareLink,
  type ShareLinkForExport,
} from './dataExportRedaction';

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

    const active = await findActiveExport(ctx, ownerId);
    if (active) {
      throw new ConvexError('A data export is already in progress');
    }

    const now = Date.now();
    const exportId = await ctx.db.insert('dataExports', {
      ownerId,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      expiresAt: now + DATA_EXPORT_TTL_MS,
    });

    await ctx.scheduler.runAfter(0, internal.dataExportActions.buildDataExport, {
      exportId,
    });

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
    if (latest.status === 'ready' && latest.storageId) {
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

export const markExportBuilding = internalMutation({
  args: { exportId: v.id('dataExports') },
  returns: v.null(),
  handler: async (ctx, { exportId }) => {
    const job = await ctx.db.get(exportId);
    if (!job) return null;
    if (job.status !== 'pending' && job.status !== 'building') return null;
    await ctx.db.patch(exportId, { status: 'building', updatedAt: Date.now() });
    return null;
  },
});

export const markExportReady = internalMutation({
  args: {
    exportId: v.id('dataExports'),
    storageId: v.id('_storage'),
    byteSize: v.number(),
    fileName: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.exportId);
    if (!job) return null;
    if (job.storageId && job.storageId !== args.storageId) {
      try {
        await ctx.storage.delete(job.storageId);
      } catch {
        // Previous blob may already be gone.
      }
    }
    await ctx.db.patch(args.exportId, {
      status: 'ready',
      storageId: args.storageId,
      byteSize: args.byteSize,
      fileName: args.fileName,
      error: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const markExportFailed = internalMutation({
  args: {
    exportId: v.id('dataExports'),
    error: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { exportId, error }) => {
    const job = await ctx.db.get(exportId);
    if (!job) return null;
    await ctx.db.patch(exportId, {
      status: 'failed',
      error,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const collectAccountBundle = internalQuery({
  args: { ownerId: v.string() },
  handler: async (ctx, { ownerId }) => {
    const preferences = await ctx.db
      .query('accountPreferences')
      .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
      .collect();

    const subscriptions = await ctx.db
      .query('subscriptions')
      .withIndex('by_user', (q) => q.eq('userId', ownerId))
      .collect();

    const workspaceMembersAsOwner = await ctx.db
      .query('workspaceMembers')
      .withIndex('by_workspace', (q) => q.eq('workspaceOwnerId', ownerId))
      .collect();

    const workspaceMembersAsMember = await ctx.db
      .query('workspaceMembers')
      .withIndex('by_member', (q) => q.eq('memberId', ownerId))
      .collect();

    const workspaceInvites = await ctx.db
      .query('workspaceInvites')
      .withIndex('by_workspace', (q) => q.eq('workspaceOwnerId', ownerId))
      .collect();

    const heartbeats = await ctx.db
      .query('daemonHeartbeats')
      .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
      .collect();

    const tags = await ctx.db
      .query('tags')
      .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
      .collect();

    const collections = await ctx.db
      .query('collections')
      .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
      .collect();

    const collectionsWithPlans = [];
    for (const collection of collections) {
      const plans = await ctx.db
        .query('collectionPlans')
        .withIndex('by_collection', (q) => q.eq('collectionId', collection._id))
        .collect();
      collectionsWithPlans.push({ ...collection, plans });
    }

    const planPreferences = await ctx.db
      .query('planPreferences')
      .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
      .collect();

    const agentAvatars = await ctx.db
      .query('agentAvatars')
      .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
      .collect();

    const pendingUploads = await ctx.db
      .query('pendingUploads')
      .withIndex('by_uploadedBy', (q) => q.eq('uploadedBy', ownerId))
      .collect();

    const uploadReservations = await ctx.db
      .query('commentUploadReservations')
      .withIndex('by_uploadedBy', (q) => q.eq('uploadedBy', ownerId))
      .collect();

    const attachmentBlobs: Array<{
      storageId: Id<'_storage'>;
      fileName: string | null;
      contentType: string;
      size: number;
      planId: Id<'plans'> | null;
      commentId: Id<'comments'> | null;
      kind: 'comment' | 'avatar' | 'pending';
      agent: string | null;
    }> = [];

    for (const avatar of agentAvatars) {
      attachmentBlobs.push({
        storageId: avatar.storageId,
        fileName: avatar.agent,
        contentType: 'application/octet-stream',
        size: 0,
        planId: null,
        commentId: null,
        kind: 'avatar',
        agent: avatar.agent,
      });
    }

    for (const pending of pendingUploads) {
      attachmentBlobs.push({
        storageId: pending.storageId,
        fileName: null,
        contentType: 'application/octet-stream',
        size: 0,
        planId: pending.planId,
        commentId: null,
        kind: 'pending',
        agent: null,
      });
    }

    return {
      preferences,
      subscriptions,
      workspaceMembers: {
        asOwner: workspaceMembersAsOwner,
        asMember: workspaceMembersAsMember,
      },
      workspaceInvites,
      heartbeats,
      tags,
      collections: collectionsWithPlans,
      planPreferences,
      agentAvatars,
      pendingUploads,
      uploadReservations,
      attachmentBlobs,
    };
  },
});

export const listOwnedPlansPage = internalQuery({
  args: {
    ownerId: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { ownerId, paginationOpts }) => {
    return await ctx.db
      .query('plans')
      .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
      .order('asc')
      .paginate(paginationOpts);
  },
});

export const collectPlanBundle = internalQuery({
  args: {
    ownerId: v.string(),
    planId: v.id('plans'),
  },
  handler: async (ctx, { ownerId, planId }) => {
    const plan = await ctx.db.get(planId);
    if (!plan || plan.ownerId !== ownerId) return null;

    const versions = await ctx.db
      .query('planVersions')
      .withIndex('by_plan', (q) => q.eq('planId', planId))
      .collect();

    const annotations = await ctx.db
      .query('planAnnotations')
      .withIndex('by_plan', (q) => q.eq('planId', planId))
      .collect();

    const comments = await ctx.db
      .query('comments')
      .withIndex('by_plan', (q) => q.eq('planId', planId))
      .collect();

    const shareLinksRaw = await ctx.db
      .query('shareLinks')
      .withIndex('by_plan', (q) => q.eq('planId', planId))
      .collect();

    const shareLinks = shareLinksRaw.map((link) =>
      redactShareLink({
        _id: link._id,
        planId: link.planId,
        token: link.token,
        createdBy: link.createdBy,
        createdAt: link.createdAt,
        passwordHash: link.passwordHash,
      } satisfies ShareLinkForExport),
    );

    const planLinks = await ctx.db
      .query('planLinks')
      .withIndex('by_plan', (q) => q.eq('planId', planId))
      .collect();

    const writebacks = await ctx.db
      .query('plannotatorWritebacks')
      .withIndex('by_plan', (q) => q.eq('planId', planId))
      .collect();

    const planTags = await ctx.db
      .query('planTags')
      .withIndex('by_plan', (q) => q.eq('planId', planId))
      .collect();

    const attachmentBlobs: Array<{
      storageId: Id<'_storage'>;
      fileName: string | null;
      contentType: string;
      size: number;
      planId: Id<'plans'>;
      commentId: Id<'comments'>;
      kind: 'comment';
      agent: null;
    }> = [];

    for (const comment of comments) {
      for (const attachment of comment.attachments ?? []) {
        attachmentBlobs.push({
          storageId: attachment.storageId,
          fileName: attachment.fileName ?? null,
          contentType: attachment.contentType,
          size: attachment.size,
          planId,
          commentId: comment._id,
          kind: 'comment',
          agent: null,
        });
      }
    }

    return {
      plan,
      versions,
      annotations,
      comments,
      shareLinks,
      planLinks,
      writebacks,
      planTags,
      attachmentBlobs,
    };
  },
});

export const collectAuthoredElsewhereComments = internalQuery({
  args: {
    ownerId: v.string(),
  },
  handler: async (ctx, { ownerId }) => {
    // Comments have no by_author index; same approach as purgeUserData.
    const authored = await ctx.db
      .query('comments')
      .filter((q) => q.eq(q.field('authorId'), ownerId))
      .collect();

    const elsewhere = [];
    for (const comment of authored) {
      const plan = await ctx.db.get(comment.planId);
      if (!plan || plan.ownerId === ownerId) continue;
      elsewhere.push(comment);
    }

    const attachmentBlobs: Array<{
      storageId: Id<'_storage'>;
      fileName: string | null;
      contentType: string;
      size: number;
      planId: Id<'plans'>;
      commentId: Id<'comments'>;
      kind: 'comment';
      agent: null;
    }> = [];

    for (const comment of elsewhere) {
      for (const attachment of comment.attachments ?? []) {
        attachmentBlobs.push({
          storageId: attachment.storageId,
          fileName: attachment.fileName ?? null,
          contentType: attachment.contentType,
          size: attachment.size,
          planId: comment.planId,
          commentId: comment._id,
          kind: 'comment',
          agent: null,
        });
      }
    }

    return { comments: elsewhere, attachmentBlobs };
  },
});

export const deleteExpiredDataExports = internalMutation({
  args: {},
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query('dataExports')
      .withIndex('by_expiresAt', (q) => q.lt('expiresAt', now))
      .take(100);

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
    return { deleted };
  },
});
