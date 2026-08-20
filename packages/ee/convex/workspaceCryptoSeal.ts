import { paginationOptsValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { authComponent } from './auth';
import { cryptoEnvelopeV1 } from './schema';
import { WORKSPACE_CRYPTO_LEASE_MS, validateEnvelopeStructure } from './workspaceCrypto';

export const WORKSPACE_SEAL_PHASES = [
  'plans',
  'planVersions',
  'planAnnotations',
  'comments',
  'attachments',
  'planLinks',
  'tags',
  'collections',
  'plannotatorWritebacks',
  'daemonHeartbeats',
  'avatars',
  'pendingUploads',
  'exports',
  'shares',
  'audit',
] as const;

export type WorkspaceSealPhase = (typeof WORKSPACE_SEAL_PHASES)[number];

const sealPhase = v.union(...WORKSPACE_SEAL_PHASES.map((phase) => v.literal(phase)));

async function requireOperation(
  ctx: QueryCtx | MutationCtx,
  args: { phase: WorkspaceSealPhase; leaseId?: string },
) {
  const user = await authComponent.getAuthUser(ctx);
  if (!user) throw new ConvexError('Unauthenticated');
  const settings = await ctx.db
    .query('workspaceCryptoSettings')
    .withIndex('by_owner', (lookup) => lookup.eq('ownerId', user._id))
    .unique();
  if (!settings?.operation || !['sealing', 'rotating', 'failed'].includes(settings.state)) {
    throw new ConvexError('Obfuscation operation not found');
  }
  if (settings.operation.phase !== args.phase) {
    throw new ConvexError('Obfuscation phase changed; refresh and resume');
  }
  if (args.leaseId !== undefined) {
    if (
      settings.operation.leaseId !== args.leaseId ||
      (settings.operation.leaseExpiresAt ?? 0) < Date.now()
    ) {
      throw new ConvexError('Obfuscation lease was lost');
    }
  }
  return { user, settings, operation: settings.operation };
}

export const getWorkspaceSealBatch = query({
  args: { phase: sealPhase, paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const { user } = await requireOperation(ctx, { phase: args.phase });
    if (args.paginationOpts.numItems > 20) throw new ConvexError('Seal batch is too large');
    const ownerId = user._id;
    switch (args.phase) {
      case 'plans':
        return ctx.db
          .query('plans')
          .withIndex('by_owner', (lookup) => lookup.eq('ownerId', ownerId))
          .paginate(args.paginationOpts);
      case 'planVersions':
        return ctx.db
          .query('planVersions')
          .withIndex('by_owner_createdAt', (lookup) => lookup.eq('ownerId', ownerId))
          .paginate(args.paginationOpts);
      case 'planAnnotations':
        return ctx.db
          .query('planAnnotations')
          .withIndex('by_owner', (lookup) => lookup.eq('ownerId', ownerId))
          .paginate(args.paginationOpts);
      case 'comments':
        return ctx.db
          .query('comments')
          .withIndex('by_owner', (lookup) => lookup.eq('ownerId', ownerId))
          .paginate(args.paginationOpts);
      case 'attachments': {
        const result = await ctx.db
          .query('comments')
          .withIndex('by_owner', (lookup) => lookup.eq('ownerId', ownerId))
          .paginate(args.paginationOpts);
        return {
          ...result,
          page: await Promise.all(
            result.page.map(async (comment) => ({
              ...comment,
              attachments: await Promise.all(
                (comment.attachments ?? []).map(async (attachment, index) => ({
                  ...attachment,
                  index,
                  url: await ctx.storage.getUrl(attachment.storageId),
                })),
              ),
            })),
          ),
        };
      }
      case 'planLinks':
        return ctx.db
          .query('planLinks')
          .withIndex('by_owner_plan', (lookup) => lookup.eq('ownerId', ownerId))
          .paginate(args.paginationOpts);
      case 'tags':
        return ctx.db
          .query('tags')
          .withIndex('by_owner', (lookup) => lookup.eq('ownerId', ownerId))
          .paginate(args.paginationOpts);
      case 'collections':
        return ctx.db
          .query('collections')
          .withIndex('by_owner', (lookup) => lookup.eq('ownerId', ownerId))
          .paginate(args.paginationOpts);
      case 'plannotatorWritebacks':
        return ctx.db
          .query('plannotatorWritebacks')
          .withIndex('by_owner_status', (lookup) => lookup.eq('ownerId', ownerId))
          .paginate(args.paginationOpts);
      case 'daemonHeartbeats':
        return ctx.db
          .query('daemonHeartbeats')
          .withIndex('by_owner', (lookup) => lookup.eq('ownerId', ownerId))
          .paginate(args.paginationOpts);
      case 'avatars': {
        const result = await ctx.db
          .query('agentAvatars')
          .withIndex('by_owner', (lookup) => lookup.eq('ownerId', ownerId))
          .paginate(args.paginationOpts);
        return {
          ...result,
          page: await Promise.all(
            result.page.map(async (avatar) => ({
              ...avatar,
              url: await ctx.storage.getUrl(avatar.storageId),
            })),
          ),
        };
      }
      case 'pendingUploads':
        return ctx.db
          .query('pendingUploads')
          .withIndex('by_uploadedBy', (lookup) => lookup.eq('uploadedBy', ownerId))
          .paginate(args.paginationOpts);
      case 'exports':
        return ctx.db
          .query('dataExports')
          .withIndex('by_owner', (lookup) => lookup.eq('ownerId', ownerId))
          .paginate(args.paginationOpts);
      case 'shares':
        return ctx.db
          .query('shareLinks')
          .withIndex('by_owner', (lookup) => lookup.eq('ownerId', ownerId))
          .paginate(args.paginationOpts);
      case 'audit':
        return { page: [], isDone: true, continueCursor: '' };
    }
  },
});

function nextPhase(phase: WorkspaceSealPhase): WorkspaceSealPhase {
  const index = WORKSPACE_SEAL_PHASES.indexOf(phase);
  return WORKSPACE_SEAL_PHASES[index + 1] ?? 'audit';
}

async function advanceOperation(
  ctx: MutationCtx,
  settings: Doc<'workspaceCryptoSettings'>,
  args: {
    phase: WorkspaceSealPhase;
    leaseId: string;
    processed: number;
    continueCursor: string;
    isDone: boolean;
    lastStableCryptoId?: string;
  },
): Promise<void> {
  const now = Date.now();
  const operation = settings.operation;
  if (!operation) throw new ConvexError('Obfuscation operation not found');
  await ctx.db.patch(settings._id, {
    ...(settings.state === 'failed'
      ? { state: operation.kind === 'seal' ? ('sealing' as const) : ('rotating' as const) }
      : {}),
    operation: {
      ...operation,
      phase: args.isDone ? nextPhase(args.phase) : args.phase,
      cursor: args.isDone ? undefined : args.continueCursor,
      processed: operation.processed + args.processed,
      lastStableCryptoId: args.lastStableCryptoId ?? operation.lastStableCryptoId,
      leaseExpiresAt: now + WORKSPACE_CRYPTO_LEASE_MS,
      heartbeatAt: now,
      updatedAt: now,
    },
    updatedAt: now,
  });
}

const progressArgs = {
  leaseId: v.string(),
  continueCursor: v.string(),
  isDone: v.boolean(),
};

function validateBatchLength(items: readonly unknown[]): void {
  if (items.length > 20) throw new ConvexError('Seal batch is too large');
}

function validateCurrentEnvelope(envelope: unknown, epoch: number): void {
  validateEnvelopeStructure(envelope, { expectedEpoch: epoch });
}

export const sealPlansBatch = mutation({
  args: {
    ...progressArgs,
    items: v.array(
      v.object({
        id: v.id('plans'),
        expectedUpdatedAt: v.number(),
        stableCryptoId: v.string(),
        keyEpoch: v.number(),
        encryptedSummary: cryptoEnvelopeV1,
        encryptedBody: cryptoEnvelopeV1,
        contentToken: v.string(),
        localPlanToken: v.string(),
        syncIdentityToken: v.optional(v.string()),
        continuityToken: v.optional(v.string()),
        lowValue: v.boolean(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    validateBatchLength(args.items);
    const { user, settings } = await requireOperation(ctx, {
      phase: 'plans',
      leaseId: args.leaseId,
    });
    for (const item of args.items) {
      const plan = await ctx.db.get(item.id);
      if (!plan || plan.ownerId !== user._id) throw new ConvexError('Plan not found');
      if (plan.updatedAt !== item.expectedUpdatedAt) {
        throw new ConvexError('Plan changed while it was being sealed');
      }
      validateCurrentEnvelope(item.encryptedSummary, settings.activeKeyEpoch);
      validateCurrentEnvelope(item.encryptedBody, settings.activeKeyEpoch);
      await ctx.db.patch(item.id, {
        localPlanId: undefined,
        title: '',
        content: '',
        filePath: undefined,
        workspace: undefined,
        metadata: undefined,
        plannotatorContinuityKey: undefined,
        syncIdentityKey: undefined,
        contentHash: undefined,
        stableCryptoId: item.stableCryptoId,
        keyEpoch: item.keyEpoch,
        encryptedSummary: item.encryptedSummary,
        encryptedBody: item.encryptedBody,
        contentToken: item.contentToken,
        localPlanToken: item.localPlanToken,
        syncIdentityToken: item.syncIdentityToken,
        continuityToken: item.continuityToken,
        lowValue: item.lowValue,
      });
    }
    await advanceOperation(ctx, settings, {
      phase: 'plans',
      leaseId: args.leaseId,
      processed: args.items.length,
      continueCursor: args.continueCursor,
      isDone: args.isDone,
      lastStableCryptoId: args.items.at(-1)?.stableCryptoId,
    });
  },
});

const basicEncryptedItem = {
  stableCryptoId: v.string(),
  keyEpoch: v.number(),
};

export const sealPlanVersionsBatch = mutation({
  args: {
    ...progressArgs,
    items: v.array(
      v.object({
        id: v.id('planVersions'),
        ...basicEncryptedItem,
        encryptedSummary: cryptoEnvelopeV1,
        encryptedBody: cryptoEnvelopeV1,
      }),
    ),
  },
  handler: async (ctx, args) => {
    validateBatchLength(args.items);
    const { user, settings } = await requireOperation(ctx, {
      phase: 'planVersions',
      leaseId: args.leaseId,
    });
    for (const item of args.items) {
      const version = await ctx.db.get(item.id);
      if (!version || version.ownerId !== user._id) throw new ConvexError('Version not found');
      validateCurrentEnvelope(item.encryptedSummary, settings.activeKeyEpoch);
      validateCurrentEnvelope(item.encryptedBody, settings.activeKeyEpoch);
      await ctx.db.patch(item.id, {
        title: '',
        content: '',
        filePath: undefined,
        workspace: undefined,
        metadata: undefined,
        stableCryptoId: item.stableCryptoId,
        keyEpoch: item.keyEpoch,
        encryptedSummary: item.encryptedSummary,
        encryptedBody: item.encryptedBody,
      });
    }
    await advanceOperation(ctx, settings, {
      phase: 'planVersions',
      leaseId: args.leaseId,
      processed: args.items.length,
      continueCursor: args.continueCursor,
      isDone: args.isDone,
      lastStableCryptoId: args.items.at(-1)?.stableCryptoId,
    });
  },
});

export const sealAnnotationsBatch = mutation({
  args: {
    ...progressArgs,
    items: v.array(
      v.object({
        id: v.id('planAnnotations'),
        ...basicEncryptedItem,
        encryptedAnnotation: cryptoEnvelopeV1,
      }),
    ),
  },
  handler: async (ctx, args) => {
    validateBatchLength(args.items);
    const { user, settings } = await requireOperation(ctx, {
      phase: 'planAnnotations',
      leaseId: args.leaseId,
    });
    for (const item of args.items) {
      const annotation = await ctx.db.get(item.id);
      if (!annotation || annotation.ownerId !== user._id)
        throw new ConvexError('Annotation not found');
      validateCurrentEnvelope(item.encryptedAnnotation, settings.activeKeyEpoch);
      await ctx.db.patch(item.id, {
        authorName: '',
        body: undefined,
        replacementText: undefined,
        anchor: {},
        stableCryptoId: item.stableCryptoId,
        keyEpoch: item.keyEpoch,
        encryptedAnnotation: item.encryptedAnnotation,
      });
    }
    await advanceOperation(ctx, settings, {
      phase: 'planAnnotations',
      leaseId: args.leaseId,
      processed: args.items.length,
      continueCursor: args.continueCursor,
      isDone: args.isDone,
      lastStableCryptoId: args.items.at(-1)?.stableCryptoId,
    });
  },
});

export const sealCommentsBatch = mutation({
  args: {
    ...progressArgs,
    items: v.array(
      v.object({
        id: v.id('comments'),
        ...basicEncryptedItem,
        encryptedComment: cryptoEnvelopeV1,
        encryptedAttachments: v.optional(cryptoEnvelopeV1),
      }),
    ),
  },
  handler: async (ctx, args) => {
    validateBatchLength(args.items);
    const { user, settings } = await requireOperation(ctx, {
      phase: 'comments',
      leaseId: args.leaseId,
    });
    for (const item of args.items) {
      const comment = await ctx.db.get(item.id);
      if (!comment || comment.ownerId !== user._id) throw new ConvexError('Comment not found');
      validateCurrentEnvelope(item.encryptedComment, settings.activeKeyEpoch);
      if (item.encryptedAttachments) {
        validateCurrentEnvelope(item.encryptedAttachments, settings.activeKeyEpoch);
      }
      await ctx.db.patch(item.id, {
        authorName: '',
        authorAvatar: undefined,
        body: '',
        attachments: comment.attachments?.map((attachment) => ({
          storageId: attachment.storageId,
          contentType: 'application/octet-stream',
          size: attachment.size,
        })),
        stableCryptoId: item.stableCryptoId,
        keyEpoch: item.keyEpoch,
        encryptedComment: item.encryptedComment,
        encryptedAttachments: item.encryptedAttachments,
      });
    }
    await advanceOperation(ctx, settings, {
      phase: 'comments',
      leaseId: args.leaseId,
      processed: args.items.length,
      continueCursor: args.continueCursor,
      isDone: args.isDone,
      lastStableCryptoId: args.items.at(-1)?.stableCryptoId,
    });
  },
});

export const sealLinksBatch = mutation({
  args: {
    ...progressArgs,
    items: v.array(
      v.object({ id: v.id('planLinks'), ...basicEncryptedItem, encryptedLink: cryptoEnvelopeV1 }),
    ),
  },
  handler: async (ctx, args) => {
    validateBatchLength(args.items);
    const { user, settings } = await requireOperation(ctx, {
      phase: 'planLinks',
      leaseId: args.leaseId,
    });
    for (const item of args.items) {
      const link = await ctx.db.get(item.id);
      if (!link || link.ownerId !== user._id) throw new ConvexError('Link not found');
      validateCurrentEnvelope(item.encryptedLink, settings.activeKeyEpoch);
      await ctx.db.patch(item.id, {
        value: '',
        url: undefined,
        stableCryptoId: item.stableCryptoId,
        keyEpoch: item.keyEpoch,
        encryptedLink: item.encryptedLink,
      });
    }
    await advanceOperation(ctx, settings, {
      phase: 'planLinks',
      leaseId: args.leaseId,
      processed: args.items.length,
      continueCursor: args.continueCursor,
      isDone: args.isDone,
      lastStableCryptoId: args.items.at(-1)?.stableCryptoId,
    });
  },
});

export const sealTagsBatch = mutation({
  args: {
    ...progressArgs,
    items: v.array(
      v.object({
        id: v.id('tags'),
        ...basicEncryptedItem,
        encryptedName: cryptoEnvelopeV1,
        nameToken: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    validateBatchLength(args.items);
    const { user, settings } = await requireOperation(ctx, {
      phase: 'tags',
      leaseId: args.leaseId,
    });
    for (const item of args.items) {
      const tag = await ctx.db.get(item.id);
      if (!tag || tag.ownerId !== user._id) throw new ConvexError('Tag not found');
      validateCurrentEnvelope(item.encryptedName, settings.activeKeyEpoch);
      await ctx.db.patch(item.id, {
        name: '',
        nameLc: '',
        stableCryptoId: item.stableCryptoId,
        keyEpoch: item.keyEpoch,
        encryptedName: item.encryptedName,
        nameToken: item.nameToken,
      });
    }
    await advanceOperation(ctx, settings, {
      phase: 'tags',
      leaseId: args.leaseId,
      processed: args.items.length,
      continueCursor: args.continueCursor,
      isDone: args.isDone,
      lastStableCryptoId: args.items.at(-1)?.stableCryptoId,
    });
  },
});

export const sealCollectionsBatch = mutation({
  args: {
    ...progressArgs,
    items: v.array(
      v.object({
        id: v.id('collections'),
        ...basicEncryptedItem,
        encryptedName: cryptoEnvelopeV1,
        encryptedDescription: v.optional(cryptoEnvelopeV1),
        nameToken: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    validateBatchLength(args.items);
    const { user, settings } = await requireOperation(ctx, {
      phase: 'collections',
      leaseId: args.leaseId,
    });
    for (const item of args.items) {
      const collection = await ctx.db.get(item.id);
      if (!collection || collection.ownerId !== user._id) {
        throw new ConvexError('Collection not found');
      }
      validateCurrentEnvelope(item.encryptedName, settings.activeKeyEpoch);
      if (item.encryptedDescription) {
        validateCurrentEnvelope(item.encryptedDescription, settings.activeKeyEpoch);
      }
      await ctx.db.patch(item.id, {
        name: '',
        nameLc: '',
        description: undefined,
        stableCryptoId: item.stableCryptoId,
        keyEpoch: item.keyEpoch,
        encryptedName: item.encryptedName,
        encryptedDescription: item.encryptedDescription,
        nameToken: item.nameToken,
      });
    }
    await advanceOperation(ctx, settings, {
      phase: 'collections',
      leaseId: args.leaseId,
      processed: args.items.length,
      continueCursor: args.continueCursor,
      isDone: args.isDone,
      lastStableCryptoId: args.items.at(-1)?.stableCryptoId,
    });
  },
});

export const sealWritebacksBatch = mutation({
  args: {
    ...progressArgs,
    items: v.array(
      v.object({
        id: v.id('plannotatorWritebacks'),
        ...basicEncryptedItem,
        encryptedWriteback: cryptoEnvelopeV1,
        localPlanToken: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    validateBatchLength(args.items);
    const { user, settings } = await requireOperation(ctx, {
      phase: 'plannotatorWritebacks',
      leaseId: args.leaseId,
    });
    for (const item of args.items) {
      const writeback = await ctx.db.get(item.id);
      if (!writeback || writeback.ownerId !== user._id)
        throw new ConvexError('Writeback not found');
      validateCurrentEnvelope(item.encryptedWriteback, settings.activeKeyEpoch);
      await ctx.db.patch(item.id, {
        localPlanId: '',
        feedback: '',
        revisedContent: undefined,
        annotations: undefined,
        error: undefined,
        stableCryptoId: item.stableCryptoId,
        keyEpoch: item.keyEpoch,
        encryptedWriteback: item.encryptedWriteback,
        localPlanToken: item.localPlanToken,
      });
    }
    await advanceOperation(ctx, settings, {
      phase: 'plannotatorWritebacks',
      leaseId: args.leaseId,
      processed: args.items.length,
      continueCursor: args.continueCursor,
      isDone: args.isDone,
      lastStableCryptoId: args.items.at(-1)?.stableCryptoId,
    });
  },
});

export const sealHeartbeatsBatch = mutation({
  args: {
    ...progressArgs,
    items: v.array(
      v.object({
        id: v.id('daemonHeartbeats'),
        ...basicEncryptedItem,
        encryptedHostname: v.optional(cryptoEnvelopeV1),
        encryptedIpAddress: v.optional(cryptoEnvelopeV1),
      }),
    ),
  },
  handler: async (ctx, args) => {
    validateBatchLength(args.items);
    const { user, settings } = await requireOperation(ctx, {
      phase: 'daemonHeartbeats',
      leaseId: args.leaseId,
    });
    for (const item of args.items) {
      const heartbeat = await ctx.db.get(item.id);
      if (!heartbeat || heartbeat.ownerId !== user._id)
        throw new ConvexError('Heartbeat not found');
      if (item.encryptedHostname) {
        validateCurrentEnvelope(item.encryptedHostname, settings.activeKeyEpoch);
      }
      if (item.encryptedIpAddress) {
        validateCurrentEnvelope(item.encryptedIpAddress, settings.activeKeyEpoch);
      }
      await ctx.db.patch(item.id, {
        hostname: undefined,
        ipAddress: undefined,
        stableCryptoId: item.stableCryptoId,
        keyEpoch: item.keyEpoch,
        encryptedHostname: item.encryptedHostname,
        encryptedIpAddress: item.encryptedIpAddress,
      });
    }
    await advanceOperation(ctx, settings, {
      phase: 'daemonHeartbeats',
      leaseId: args.leaseId,
      processed: args.items.length,
      continueCursor: args.continueCursor,
      isDone: args.isDone,
      lastStableCryptoId: args.items.at(-1)?.stableCryptoId,
    });
  },
});

export const deleteSharesBatch = mutation({
  args: { ...progressArgs, ids: v.array(v.id('shareLinks')) },
  handler: async (ctx, args) => {
    validateBatchLength(args.ids);
    const { user, settings } = await requireOperation(ctx, {
      phase: 'shares',
      leaseId: args.leaseId,
    });
    for (const id of args.ids) {
      const share = await ctx.db.get(id);
      if (share?.ownerId === user._id) await ctx.db.delete(id);
    }
    await advanceOperation(ctx, settings, {
      phase: 'shares',
      leaseId: args.leaseId,
      processed: args.ids.length,
      continueCursor: args.continueCursor,
      isDone: args.isDone,
    });
  },
});

export const generateSealUploadUrl = mutation({
  args: {
    phase: v.union(v.literal('attachments'), v.literal('avatars')),
    leaseId: v.string(),
    recordId: v.string(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireOperation(ctx, { phase: args.phase, leaseId: args.leaseId });
    if (args.phase === 'attachments') {
      const commentId = ctx.db.normalizeId('comments', args.recordId);
      const comment = commentId ? await ctx.db.get(commentId) : null;
      if (!comment || comment.ownerId !== user._id) throw new ConvexError('Comment not found');
    } else {
      const avatarId = ctx.db.normalizeId('agentAvatars', args.recordId);
      const avatar = avatarId ? await ctx.db.get(avatarId) : null;
      if (!avatar || avatar.ownerId !== user._id) throw new ConvexError('Avatar not found');
    }
    return ctx.storage.generateUploadUrl();
  },
});

export const commitEncryptedAttachment = mutation({
  args: {
    leaseId: v.string(),
    commentId: v.id('comments'),
    attachmentIndex: v.number(),
    oldStorageId: v.id('_storage'),
    newStorageId: v.id('_storage'),
    stableCryptoId: v.string(),
    keyEpoch: v.number(),
    encryptedSize: v.number(),
  },
  handler: async (ctx, args) => {
    const { user, settings } = await requireOperation(ctx, {
      phase: 'attachments',
      leaseId: args.leaseId,
    });
    const comment = await ctx.db.get(args.commentId);
    if (!comment || comment.ownerId !== user._id) throw new ConvexError('Comment not found');
    const attachments = [...(comment.attachments ?? [])];
    const current = attachments[args.attachmentIndex];
    if (!current || current.storageId !== args.oldStorageId) {
      throw new ConvexError('Attachment changed while it was being sealed');
    }
    if (args.keyEpoch !== settings.activeKeyEpoch || args.encryptedSize < 48) {
      throw new ConvexError('Invalid encrypted attachment');
    }
    attachments[args.attachmentIndex] = {
      storageId: args.newStorageId,
      contentType: 'application/octet-stream',
      size: args.encryptedSize,
      encrypted: true,
      keyEpoch: args.keyEpoch,
      stableCryptoId: args.stableCryptoId,
    };
    await ctx.db.patch(args.commentId, { attachments });
    const claim = await ctx.db
      .query('commentAttachmentClaims')
      .withIndex('by_storage', (lookup) => lookup.eq('storageId', args.oldStorageId))
      .first();
    if (claim) {
      await ctx.db.delete(claim._id);
      await ctx.db.insert('commentAttachmentClaims', {
        storageId: args.newStorageId,
        commentId: args.commentId,
      });
    }
    await ctx.storage.delete(args.oldStorageId);
  },
});

export const commitEncryptedAvatar = mutation({
  args: {
    leaseId: v.string(),
    avatarId: v.id('agentAvatars'),
    oldStorageId: v.id('_storage'),
    newStorageId: v.id('_storage'),
    stableCryptoId: v.string(),
    keyEpoch: v.number(),
  },
  handler: async (ctx, args) => {
    const { user, settings } = await requireOperation(ctx, {
      phase: 'avatars',
      leaseId: args.leaseId,
    });
    const avatar = await ctx.db.get(args.avatarId);
    if (!avatar || avatar.ownerId !== user._id || avatar.storageId !== args.oldStorageId) {
      throw new ConvexError('Avatar changed while it was being sealed');
    }
    if (args.keyEpoch !== settings.activeKeyEpoch) throw new ConvexError('Stale avatar key epoch');
    await ctx.db.patch(args.avatarId, {
      storageId: args.newStorageId,
      stableCryptoId: args.stableCryptoId,
      keyEpoch: args.keyEpoch,
      encrypted: true,
    });
    await ctx.storage.delete(args.oldStorageId);
  },
});

export const advanceBlobSealBatch = mutation({
  args: {
    phase: v.union(v.literal('attachments'), v.literal('avatars')),
    ...progressArgs,
    processed: v.number(),
  },
  handler: async (ctx, args) => {
    const { settings } = await requireOperation(ctx, {
      phase: args.phase,
      leaseId: args.leaseId,
    });
    await advanceOperation(ctx, settings, {
      phase: args.phase,
      leaseId: args.leaseId,
      processed: args.processed,
      continueCursor: args.continueCursor,
      isDone: args.isDone,
    });
  },
});

export const cleanupPendingUploadsBatch = mutation({
  args: { leaseId: v.string(), ids: v.array(v.id('pendingUploads')) },
  handler: async (ctx, args) => {
    validateBatchLength(args.ids);
    const { user, settings } = await requireOperation(ctx, {
      phase: 'pendingUploads',
      leaseId: args.leaseId,
    });
    for (const id of args.ids) {
      const upload = await ctx.db.get(id);
      if (upload?.uploadedBy !== user._id) continue;
      await ctx.storage.delete(upload.storageId);
      await ctx.db.delete(id);
    }
    const reservations = await ctx.db
      .query('commentUploadReservations')
      .withIndex('by_uploadedBy', (lookup) => lookup.eq('uploadedBy', user._id))
      .take(20);
    for (const reservation of reservations) await ctx.db.delete(reservation._id);
    const pending = await ctx.db
      .query('pendingUploads')
      .withIndex('by_uploadedBy', (lookup) => lookup.eq('uploadedBy', user._id))
      .first();
    const remainingReservation = await ctx.db
      .query('commentUploadReservations')
      .withIndex('by_uploadedBy', (lookup) => lookup.eq('uploadedBy', user._id))
      .first();
    await advanceOperation(ctx, settings, {
      phase: 'pendingUploads',
      leaseId: args.leaseId,
      processed: args.ids.length + reservations.length,
      continueCursor: '',
      isDone: pending === null && remainingReservation === null,
    });
  },
});

export const cleanupExportsBatch = mutation({
  args: { leaseId: v.string(), ids: v.array(v.id('dataExports')) },
  handler: async (ctx, args) => {
    validateBatchLength(args.ids);
    const { user, settings } = await requireOperation(ctx, {
      phase: 'exports',
      leaseId: args.leaseId,
    });
    for (const id of args.ids) {
      const dataExport = await ctx.db.get(id);
      if (dataExport?.ownerId !== user._id) continue;
      if (dataExport.storageId) await ctx.storage.delete(dataExport.storageId);
      await ctx.db.delete(id);
    }
    const remaining = await ctx.db
      .query('dataExports')
      .withIndex('by_owner', (lookup) => lookup.eq('ownerId', user._id))
      .first();
    await advanceOperation(ctx, settings, {
      phase: 'exports',
      leaseId: args.leaseId,
      processed: args.ids.length,
      continueCursor: '',
      isDone: remaining === null,
    });
  },
});

export function isLegacyPlaintextPresent(
  phase: WorkspaceSealPhase,
  row: Record<string, unknown>,
): boolean {
  switch (phase) {
    case 'plans':
      return Boolean(
        row.title ||
        row.content ||
        row.localPlanId ||
        row.filePath ||
        row.workspace ||
        row.metadata ||
        row.contentHash ||
        row.syncIdentityKey ||
        row.plannotatorContinuityKey,
      );
    case 'planVersions':
      return Boolean(row.title || row.content || row.filePath || row.workspace || row.metadata);
    case 'planAnnotations':
      return Boolean(
        row.authorName ||
        row.body ||
        row.replacementText ||
        Object.keys((row.anchor as object) ?? {}).length,
      );
    case 'comments':
      return Boolean(row.authorName || row.authorAvatar || row.body);
    case 'attachments':
      return Array.isArray(row.attachments)
        ? row.attachments.some(
            (attachment) => (attachment as Record<string, unknown>).encrypted !== true,
          )
        : false;
    case 'planLinks':
      return Boolean(row.value || row.url);
    case 'tags':
      return Boolean(row.name || row.nameLc);
    case 'collections':
      return Boolean(row.name || row.nameLc || row.description);
    case 'plannotatorWritebacks':
      return Boolean(row.localPlanId || row.feedback || row.revisedContent || row.annotations);
    case 'daemonHeartbeats':
      return Boolean(row.hostname || row.ipAddress);
    case 'avatars':
      return row.encrypted !== true;
    case 'pendingUploads':
    case 'exports':
      return true;
    case 'shares':
      return true;
    case 'audit':
      return false;
  }
}

const AUDIT_TABLES = [
  'plans',
  'planVersions',
  'planAnnotations',
  'comments',
  'planLinks',
  'tags',
  'collections',
  'plannotatorWritebacks',
  'daemonHeartbeats',
  'agentAvatars',
  'shareLinks',
] as const;

export type AuditTable = (typeof AUDIT_TABLES)[number];

function auditEnvelope(value: unknown, epoch: number): boolean {
  try {
    validateCurrentEnvelope(value, epoch);
    return true;
  } catch {
    return false;
  }
}

export function auditWorkspaceCryptoRow(
  table: AuditTable,
  row: Record<string, unknown>,
  epoch: number,
): string[] {
  const violations: string[] = [];
  const phase = table === 'agentAvatars' ? 'avatars' : table === 'shareLinks' ? 'shares' : table;
  if (isLegacyPlaintextPresent(phase as WorkspaceSealPhase, row)) violations.push('plaintext');
  if (table === 'shareLinks') return violations;
  if (row.keyEpoch !== epoch) violations.push('old_epoch');
  if (typeof row.stableCryptoId !== 'string' || row.stableCryptoId.length === 0) {
    violations.push('missing_stable_id');
  }
  const requiredEnvelopes: Partial<Record<AuditTable, readonly string[]>> = {
    plans: ['encryptedSummary', 'encryptedBody'],
    planVersions: ['encryptedSummary', 'encryptedBody'],
    planAnnotations: ['encryptedAnnotation'],
    comments: ['encryptedComment'],
    planLinks: ['encryptedLink'],
    tags: ['encryptedName'],
    collections: ['encryptedName'],
    plannotatorWritebacks: ['encryptedWriteback'],
  };
  for (const field of requiredEnvelopes[table] ?? []) {
    if (!auditEnvelope(row[field], epoch)) violations.push(`invalid_${field}`);
  }
  if (table === 'plans') {
    for (const token of ['contentToken', 'localPlanToken']) {
      if (typeof row[token] !== 'string' || row[token].length === 0)
        violations.push(`missing_${token}`);
    }
  }
  if (table === 'comments') {
    const attachments = Array.isArray(row.attachments) ? row.attachments : [];
    if (
      attachments.some((attachment) => {
        const value = attachment as Record<string, unknown>;
        return (
          value.encrypted !== true ||
          value.keyEpoch !== epoch ||
          value.contentType !== 'application/octet-stream'
        );
      })
    ) {
      violations.push('plaintext_attachment');
    }
    if (attachments.length > 0 && !auditEnvelope(row.encryptedAttachments, epoch)) {
      violations.push('invalid_encryptedAttachments');
    }
  }
  if (table === 'tags' || table === 'collections') {
    if (typeof row.nameToken !== 'string' || row.nameToken.length === 0) {
      violations.push('missing_name_token');
    }
  }
  return violations;
}

export const runWorkspaceAuditBatch = mutation({
  args: { leaseId: v.string() },
  handler: async (ctx, args) => {
    const { user, settings, operation } = await requireOperation(ctx, {
      phase: 'audit',
      leaseId: args.leaseId,
    });
    const table = (operation.auditTable as AuditTable | undefined) ?? AUDIT_TABLES[0];
    if (!AUDIT_TABLES.includes(table)) throw new ConvexError('Invalid audit table');
    const paginationOpts = { cursor: operation.cursor ?? null, numItems: 20 };
    const ownerId = user._id;
    let result: { page: unknown[]; isDone: boolean; continueCursor: string };
    switch (table) {
      case 'plans':
        result = await ctx.db
          .query('plans')
          .withIndex('by_owner', (lookup) => lookup.eq('ownerId', ownerId))
          .paginate(paginationOpts);
        break;
      case 'planVersions':
        result = await ctx.db
          .query('planVersions')
          .withIndex('by_owner_createdAt', (lookup) => lookup.eq('ownerId', ownerId))
          .paginate(paginationOpts);
        break;
      case 'planAnnotations':
        result = await ctx.db
          .query('planAnnotations')
          .withIndex('by_owner', (lookup) => lookup.eq('ownerId', ownerId))
          .paginate(paginationOpts);
        break;
      case 'comments':
        result = await ctx.db
          .query('comments')
          .withIndex('by_owner', (lookup) => lookup.eq('ownerId', ownerId))
          .paginate(paginationOpts);
        break;
      case 'planLinks':
        result = await ctx.db
          .query('planLinks')
          .withIndex('by_owner_plan', (lookup) => lookup.eq('ownerId', ownerId))
          .paginate(paginationOpts);
        break;
      case 'tags':
        result = await ctx.db
          .query('tags')
          .withIndex('by_owner', (lookup) => lookup.eq('ownerId', ownerId))
          .paginate(paginationOpts);
        break;
      case 'collections':
        result = await ctx.db
          .query('collections')
          .withIndex('by_owner', (lookup) => lookup.eq('ownerId', ownerId))
          .paginate(paginationOpts);
        break;
      case 'plannotatorWritebacks':
        result = await ctx.db
          .query('plannotatorWritebacks')
          .withIndex('by_owner_status', (lookup) => lookup.eq('ownerId', ownerId))
          .paginate(paginationOpts);
        break;
      case 'daemonHeartbeats':
        result = await ctx.db
          .query('daemonHeartbeats')
          .withIndex('by_owner', (lookup) => lookup.eq('ownerId', ownerId))
          .paginate(paginationOpts);
        break;
      case 'agentAvatars':
        result = await ctx.db
          .query('agentAvatars')
          .withIndex('by_owner', (lookup) => lookup.eq('ownerId', ownerId))
          .paginate(paginationOpts);
        break;
      case 'shareLinks':
        result = await ctx.db
          .query('shareLinks')
          .withIndex('by_owner', (lookup) => lookup.eq('ownerId', ownerId))
          .paginate(paginationOpts);
        break;
    }

    const violations = result.page.flatMap((value) => {
      const row = value as Record<string, unknown>;
      return auditWorkspaceCryptoRow(table, row, settings.activeKeyEpoch).map((category) => ({
        table,
        id: String(row._id ?? ''),
        category,
      }));
    });
    const now = Date.now();
    if (violations.length > 0) {
      await ctx.db.patch(settings._id, {
        state: 'failed',
        lastAuditAt: now,
        lastAuditClean: false,
        operation: {
          ...operation,
          lastError: `Audit found ${violations[0]?.category ?? 'residue'} in ${table}`,
          updatedAt: now,
        },
        updatedAt: now,
      });
      return { done: false, violations };
    }

    if (!result.isDone) {
      await ctx.db.patch(settings._id, {
        operation: {
          ...operation,
          cursor: result.continueCursor,
          auditTable: table,
          processed: operation.processed + result.page.length,
          leaseExpiresAt: now + WORKSPACE_CRYPTO_LEASE_MS,
          heartbeatAt: now,
          updatedAt: now,
        },
        updatedAt: now,
      });
      return { done: false, violations: [] };
    }

    const tableIndex = AUDIT_TABLES.indexOf(table);
    const nextAuditTable = AUDIT_TABLES[tableIndex + 1];
    if (nextAuditTable) {
      await ctx.db.patch(settings._id, {
        operation: {
          ...operation,
          cursor: undefined,
          auditTable: nextAuditTable,
          processed: operation.processed + result.page.length,
          leaseExpiresAt: now + WORKSPACE_CRYPTO_LEASE_MS,
          heartbeatAt: now,
          updatedAt: now,
        },
        updatedAt: now,
      });
      return { done: false, violations: [] };
    }

    if (operation.kind === 'rotate' && operation.fromEpoch !== undefined) {
      const oldGrants = await ctx.db
        .query('workspaceKeyGrants')
        .withIndex('by_workspace', (q) => q.eq('workspaceOwnerId', user._id))
        .collect();
      for (const grant of oldGrants) {
        if (grant.keyEpoch === operation.fromEpoch) await ctx.db.delete(grant._id);
      }
    }
    await ctx.db.patch(settings._id, {
      state: 'sealed',
      enabledAt: settings.enabledAt ?? now,
      operation: undefined,
      lastAuditAt: now,
      lastAuditClean: true,
      previousKeyEpoch: undefined,
      previousOwnerKdf: undefined,
      previousOwnerPassphraseWrappedKey: undefined,
      previousOwnerRecoveryWrappedKey: undefined,
      updatedAt: now,
    });
    return { done: true, violations: [] };
  },
});
