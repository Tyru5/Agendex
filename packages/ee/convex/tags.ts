import { ProFeature } from '@agendex/shared/types';
import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import { internalMutation, mutation, query } from './_generated/server';
import { authComponent } from './auth';
import { requireFeature } from './entitlements';
import { cryptoEnvelopeV1 } from './schema';
import { resolveWorkspaceCryptoPolicy, validateEncryptedWrite } from './workspaceCrypto';

export const listMyTags = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    await requireFeature(ctx, ProFeature.TAGS_COLLECTIONS);

    return await ctx.db
      .query('tags')
      .withIndex('by_owner', (q) => q.eq('ownerId', user._id))
      .collect();
  },
});

export const createTag = mutation({
  args: {
    name: v.string(),
    color: v.optional(v.string()),
    clientCryptoProtocol: v.optional(v.number()),
    stableCryptoId: v.optional(v.string()),
    keyEpoch: v.optional(v.number()),
    encryptedName: v.optional(cryptoEnvelopeV1),
    nameToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    await requireFeature(ctx, ProFeature.TAGS_COLLECTIONS);

    const policy = await resolveWorkspaceCryptoPolicy(ctx, user._id);
    const encrypted = policy.requiresEncryption;
    validateEncryptedWrite({
      policy,
      clientProtocol: args.clientCryptoProtocol,
      envelopes: args.encryptedName ? [args.encryptedName] : [],
      plaintext: { name: args.name },
    });
    if (encrypted && (!args.stableCryptoId || !args.nameToken || args.keyEpoch === undefined)) {
      throw new ConvexError('Encrypted tag metadata is required');
    }

    const nameLc = encrypted ? '' : args.name.trim().toLowerCase();
    if (!encrypted && !nameLc) throw new ConvexError('Tag name cannot be empty');

    const existing = await ctx.db
      .query('tags')
      .withIndex(encrypted ? 'by_owner_nameToken' : 'by_owner_nameLc', (q) =>
        encrypted
          ? q.eq('ownerId', user._id).eq('nameToken', args.nameToken)
          : q.eq('ownerId', user._id).eq('nameLc', nameLc),
      )
      .first();

    if (existing) throw new ConvexError('A tag with this name already exists');

    return await ctx.db.insert('tags', {
      ownerId: user._id,
      name: encrypted ? '' : args.name.trim(),
      nameLc,
      color: args.color,
      createdAt: Date.now(),
      ...(encrypted
        ? {
            stableCryptoId: args.stableCryptoId,
            keyEpoch: args.keyEpoch,
            encryptedName: args.encryptedName,
            nameToken: args.nameToken,
          }
        : {}),
    });
  },
});

export const renameTag = mutation({
  args: {
    tagId: v.id('tags'),
    name: v.string(),
    clientCryptoProtocol: v.optional(v.number()),
    keyEpoch: v.optional(v.number()),
    encryptedName: v.optional(cryptoEnvelopeV1),
    nameToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    await requireFeature(ctx, ProFeature.TAGS_COLLECTIONS);

    const tag = await ctx.db.get(args.tagId);
    if (!tag || tag.ownerId !== user._id) throw new ConvexError('Tag not found');

    const policy = await resolveWorkspaceCryptoPolicy(ctx, user._id);
    const encrypted = policy.requiresEncryption;
    validateEncryptedWrite({
      policy,
      clientProtocol: args.clientCryptoProtocol,
      envelopes: args.encryptedName ? [args.encryptedName] : [],
      plaintext: { name: args.name },
    });
    if (encrypted && (!tag.stableCryptoId || !args.nameToken || args.keyEpoch === undefined)) {
      throw new ConvexError('Encrypted tag metadata is required');
    }

    const nameLc = encrypted ? '' : args.name.trim().toLowerCase();
    if (!encrypted && !nameLc) throw new ConvexError('Tag name cannot be empty');

    const existing = await ctx.db
      .query('tags')
      .withIndex(encrypted ? 'by_owner_nameToken' : 'by_owner_nameLc', (q) =>
        encrypted
          ? q.eq('ownerId', user._id).eq('nameToken', args.nameToken)
          : q.eq('ownerId', user._id).eq('nameLc', nameLc),
      )
      .first();

    if (existing && existing._id !== args.tagId) {
      throw new ConvexError('A tag with this name already exists');
    }

    await ctx.db.patch(args.tagId, {
      name: encrypted ? '' : args.name.trim(),
      nameLc,
      ...(encrypted
        ? {
            keyEpoch: args.keyEpoch,
            encryptedName: args.encryptedName,
            nameToken: args.nameToken,
          }
        : {}),
    });
  },
});

export const deleteTag = mutation({
  args: { tagId: v.id('tags') },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    await requireFeature(ctx, ProFeature.TAGS_COLLECTIONS);

    const tag = await ctx.db.get(args.tagId);
    if (!tag || tag.ownerId !== user._id) throw new ConvexError('Tag not found');

    await ctx.db.delete(args.tagId);
    await ctx.scheduler.runAfter(0, internal.tags.cleanupPlanTags, { tagId: args.tagId });
  },
});

export const cleanupPlanTags = internalMutation({
  args: { tagId: v.id('tags') },
  handler: async (ctx, args) => {
    const batch = await ctx.db
      .query('planTags')
      .withIndex('by_tag', (q) => q.eq('tagId', args.tagId))
      .take(500);

    for (const pt of batch) {
      await ctx.db.delete(pt._id);
    }

    if (batch.length === 500) {
      await ctx.scheduler.runAfter(0, internal.tags.cleanupPlanTags, { tagId: args.tagId });
    }
  },
});
