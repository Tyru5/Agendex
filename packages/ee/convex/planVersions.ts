import { ProFeature } from '@agendex/shared/types';
import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { authComponent } from './auth';
import { requireFeature } from './entitlements';
import { assessPlanForVisibility, metadataWithPlanValueAssessment } from './planVisibility';
import { recordPlanVersion } from './planVersioning';
import { cryptoEnvelopeV1 } from './schema';
import { resolveWorkspaceCryptoPolicy, validateEncryptedWrite } from './workspaceCrypto';

export const listForPlan = query({
  args: { planId: v.id('plans') },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new ConvexError('Unauthenticated');
    }

    await requireFeature(ctx, ProFeature.PLAN_HISTORY);

    const plan = await ctx.db.get(args.planId);
    if (!plan) {
      throw new ConvexError('Plan not found');
    }

    if (plan.ownerId !== user._id) {
      throw new ConvexError('Access denied');
    }

    // Intentionally does not gate on `isVisiblePlan(plan)`: the owner needs to
    // see version history for a plan hidden by the low-value classifier in
    // order to find a good snapshot to restore.
    const versions = await ctx.db
      .query('planVersions')
      .withIndex('by_plan', (q) => q.eq('planId', args.planId))
      .order('desc')
      .collect();

    return versions.map((ver) => ({
      _id: ver._id,
      version: ver.version,
      title: ver.title,
      source: ver.source,
      createdAt: ver.createdAt,
      stableCryptoId: ver.stableCryptoId,
      keyEpoch: ver.keyEpoch,
      encryptedSummary: ver.encryptedSummary,
    }));
  },
});

export const getVersion = query({
  args: { planId: v.id('plans'), version: v.number() },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new ConvexError('Unauthenticated');
    }

    await requireFeature(ctx, ProFeature.PLAN_HISTORY);

    const plan = await ctx.db.get(args.planId);
    if (!plan) {
      throw new ConvexError('Plan not found');
    }

    if (plan.ownerId !== user._id) {
      throw new ConvexError('Access denied');
    }

    // Intentionally does not gate on `isVisiblePlan(plan)`: see listForPlan.
    const snapshot = await ctx.db
      .query('planVersions')
      .withIndex('by_plan_version', (q) => q.eq('planId', args.planId).eq('version', args.version))
      .first();

    if (!snapshot) {
      throw new ConvexError('Version not found');
    }

    return snapshot;
  },
});

export const restore = mutation({
  args: {
    planId: v.id('plans'),
    version: v.number(),
    clientCryptoProtocol: v.optional(v.number()),
    keyEpoch: v.optional(v.number()),
    encryptedSummary: v.optional(cryptoEnvelopeV1),
    encryptedBody: v.optional(cryptoEnvelopeV1),
    versionStableCryptoId: v.optional(v.string()),
    encryptedVersionSummary: v.optional(cryptoEnvelopeV1),
    encryptedVersionBody: v.optional(cryptoEnvelopeV1),
    contentToken: v.optional(v.string()),
    lowValue: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new ConvexError('Unauthenticated');
    }

    await requireFeature(ctx, ProFeature.PLAN_HISTORY);

    const plan = await ctx.db.get(args.planId);
    if (!plan) {
      throw new ConvexError('Plan not found');
    }

    if (plan.ownerId !== user._id) {
      throw new ConvexError('Access denied');
    }
    const policy = await resolveWorkspaceCryptoPolicy(ctx, user._id);

    // Intentionally does not gate on `isVisiblePlan(plan)` here: restoring is how
    // an owner recovers a plan that was previously (and possibly incorrectly)
    // marked low-value, so the current plan's visibility must not block this
    // path. The snapshot being restored is validated below instead.
    const snapshot = await ctx.db
      .query('planVersions')
      .withIndex('by_plan_version', (q) => q.eq('planId', args.planId).eq('version', args.version))
      .first();

    if (!snapshot) {
      throw new ConvexError('Version not found');
    }

    if (policy.requiresEncryption) {
      validateEncryptedWrite({
        policy,
        clientProtocol: args.clientCryptoProtocol,
        envelopes: [
          args.encryptedSummary,
          args.encryptedBody,
          args.encryptedVersionSummary,
          args.encryptedVersionBody,
        ].filter(Boolean),
        plaintext: {},
      });
      if (
        !plan.stableCryptoId ||
        args.keyEpoch === undefined ||
        !args.encryptedSummary ||
        !args.encryptedBody ||
        !args.versionStableCryptoId ||
        !args.encryptedVersionSummary ||
        !args.encryptedVersionBody ||
        !args.contentToken ||
        args.lowValue === undefined
      ) {
        throw new ConvexError('Encrypted restore metadata is required');
      }
      const newVersion = plan.version + 1;
      const now = Date.now();
      await ctx.db.patch(args.planId, {
        title: '',
        content: '',
        filePath: undefined,
        workspace: undefined,
        metadata: undefined,
        version: newVersion,
        updatedAt: now,
        keyEpoch: args.keyEpoch,
        encryptedSummary: args.encryptedSummary,
        encryptedBody: args.encryptedBody,
        contentToken: args.contentToken,
        lowValue: args.lowValue,
      });
      await ctx.db.insert('planVersions', {
        ownerId: user._id,
        planId: args.planId,
        version: newVersion,
        title: '',
        content: '',
        format: snapshot.format,
        source: 'restore',
        createdAt: now,
        stableCryptoId: args.versionStableCryptoId,
        keyEpoch: args.keyEpoch,
        encryptedSummary: args.encryptedVersionSummary,
        encryptedBody: args.encryptedVersionBody,
      });
      return;
    }

    const restoredAssessment = assessPlanForVisibility({
      title: snapshot.title,
      content: snapshot.content,
      metadata: snapshot.metadata,
    });
    if (restoredAssessment.lowValue) {
      throw new ConvexError('This version cannot be restored because it has no plan content');
    }

    const newVersion = plan.version + 1;
    const now = Date.now();
    const metadata = metadataWithPlanValueAssessment(snapshot.metadata, {
      title: snapshot.title,
      content: snapshot.content,
    });

    const restoredSnapshot = {
      title: snapshot.title,
      content: snapshot.content,
      format: snapshot.format,
      filePath: snapshot.filePath,
      workspace: snapshot.workspace,
      metadata,
    };

    await ctx.db.patch(args.planId, {
      ...restoredSnapshot,
      version: newVersion,
      updatedAt: now,
    });

    await recordPlanVersion(ctx, {
      ownerId: user._id,
      planId: args.planId,
      version: newVersion,
      snapshot: restoredSnapshot,
      source: 'restore',
      createdAt: now,
    });
  },
});
