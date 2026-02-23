import { type ProFeature } from '@agendex/shared/types';
import { ConvexError } from 'convex/values';
import { hasActiveSubscription } from './subscriptions';

export async function requirePro(ctx: any): Promise<void> {
  const active = await hasActiveSubscription(ctx);
  if (!active) {
    throw new ConvexError('Cloud Pro subscription required');
  }
}

export async function requireFeature(ctx: any, feature: ProFeature): Promise<void> {
  const active = await hasActiveSubscription(ctx);
  if (!active) {
    throw new ConvexError(`Cloud Pro subscription required for feature: ${feature}`);
  }
}
