import type { ProFeature } from '@agendex/shared/types';
import { ConvexError } from 'convex/values';
import { type DbCtx, hasActiveSubscription, hasActiveSubscriptionForUserId } from './subscriptions';

/** Write / subscriber-only Pro checks. Use `hasActiveSubscription`, not `hasProEntitlement`: workspace members inherit read access to the owner's cloud data but must not use the owner's subscription for mutations. */
export async function requirePro(ctx: DbCtx): Promise<void> {
  const active = await hasActiveSubscription(ctx);
  if (!active) {
    throw new ConvexError('Cloud Pro subscription required');
  }
}

export async function requireFeature(ctx: DbCtx, feature: ProFeature): Promise<void> {
  const active = await hasActiveSubscription(ctx);
  if (!active) {
    throw new ConvexError(`Cloud Pro subscription required for feature: ${feature}`);
  }
}

export async function requireFeatureForUserId(
  ctx: DbCtx,
  userId: string,
  feature: ProFeature,
): Promise<void> {
  const active = await hasActiveSubscriptionForUserId(ctx, userId);
  if (!active) {
    throw new ConvexError(`Cloud Pro subscription required for feature: ${feature}`);
  }
}
