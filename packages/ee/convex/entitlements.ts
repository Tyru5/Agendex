import type { ProFeature } from '@agendex/shared/types';
import { ConvexError } from 'convex/values';
import type { DbCtx } from './subscriptions';
import { hasProEntitlement } from './workspaceAccess';

export async function requirePro(ctx: DbCtx): Promise<void> {
  const active = await hasProEntitlement(ctx);
  if (!active) {
    throw new ConvexError('Cloud Pro subscription required');
  }
}

export async function requireFeature(ctx: DbCtx, feature: ProFeature): Promise<void> {
  const active = await hasProEntitlement(ctx);
  if (!active) {
    throw new ConvexError(`Cloud Pro subscription required for feature: ${feature}`);
  }
}
