import { Migrations } from '@convex-dev/migrations';
import { components, internal } from './_generated/api';
import type { DataModel } from './_generated/dataModel';

export const migrations = new Migrations<DataModel>(components.migrations);

const stableCryptoId = () => crypto.randomUUID();

export const backfillPlansCryptoIdentity = migrations.define({
  table: 'plans',
  migrateOne: (_ctx, plan) =>
    plan.stableCryptoId === undefined ? { stableCryptoId: stableCryptoId() } : undefined,
});

export const backfillPlanVersionsCryptoIdentity = migrations.define({
  table: 'planVersions',
  migrateOne: (_ctx, version) =>
    version.stableCryptoId === undefined ? { stableCryptoId: stableCryptoId() } : undefined,
});

export const backfillPlanAnnotationOwnership = migrations.define({
  table: 'planAnnotations',
  migrateOne: async (ctx, annotation) => {
    if (annotation.ownerId !== undefined && annotation.stableCryptoId !== undefined) return;
    const plan = await ctx.db.get(annotation.planId);
    if (!plan) return;
    return {
      ownerId: annotation.ownerId ?? plan.ownerId,
      stableCryptoId: annotation.stableCryptoId ?? stableCryptoId(),
    };
  },
});

export const backfillCommentOwnership = migrations.define({
  table: 'comments',
  migrateOne: async (ctx, comment) => {
    if (comment.ownerId !== undefined && comment.stableCryptoId !== undefined) return;
    const plan = await ctx.db.get(comment.planId);
    if (!plan) return;
    return {
      ownerId: comment.ownerId ?? plan.ownerId,
      stableCryptoId: comment.stableCryptoId ?? stableCryptoId(),
    };
  },
});

export const backfillShareOwnership = migrations.define({
  table: 'shareLinks',
  migrateOne: async (ctx, share) => {
    if (share.ownerId !== undefined) return;
    const plan = await ctx.db.get(share.planId);
    if (!plan) return;
    return { ownerId: plan.ownerId };
  },
});

export const backfillPlanLinksCryptoIdentity = migrations.define({
  table: 'planLinks',
  migrateOne: (_ctx, link) =>
    link.stableCryptoId === undefined ? { stableCryptoId: stableCryptoId() } : undefined,
});

export const backfillTagsCryptoIdentity = migrations.define({
  table: 'tags',
  migrateOne: (_ctx, tag) =>
    tag.stableCryptoId === undefined ? { stableCryptoId: stableCryptoId() } : undefined,
});

export const backfillCollectionsCryptoIdentity = migrations.define({
  table: 'collections',
  migrateOne: (_ctx, collection) =>
    collection.stableCryptoId === undefined ? { stableCryptoId: stableCryptoId() } : undefined,
});

export const backfillWritebacksCryptoIdentity = migrations.define({
  table: 'plannotatorWritebacks',
  migrateOne: (_ctx, writeback) =>
    writeback.stableCryptoId === undefined ? { stableCryptoId: stableCryptoId() } : undefined,
});

export const backfillAgentAvatarsCryptoIdentity = migrations.define({
  table: 'agentAvatars',
  migrateOne: (_ctx, avatar) =>
    avatar.stableCryptoId === undefined ? { stableCryptoId: stableCryptoId() } : undefined,
});

export const backfillDaemonHeartbeatsCryptoIdentity = migrations.define({
  table: 'daemonHeartbeats',
  migrateOne: (_ctx, heartbeat) =>
    heartbeat.stableCryptoId === undefined ? { stableCryptoId: stableCryptoId() } : undefined,
});

export const run = migrations.runner();
export const runCryptoIdentityBackfills = migrations.runner([
  internal.migrations.backfillPlansCryptoIdentity,
  internal.migrations.backfillPlanVersionsCryptoIdentity,
  internal.migrations.backfillPlanAnnotationOwnership,
  internal.migrations.backfillCommentOwnership,
  internal.migrations.backfillShareOwnership,
  internal.migrations.backfillPlanLinksCryptoIdentity,
  internal.migrations.backfillTagsCryptoIdentity,
  internal.migrations.backfillCollectionsCryptoIdentity,
  internal.migrations.backfillWritebacksCryptoIdentity,
  internal.migrations.backfillAgentAvatarsCryptoIdentity,
  internal.migrations.backfillDaemonHeartbeatsCryptoIdentity,
]);
