import type { QueryCtx } from './_generated/server';
import { authComponent } from './auth';
import { hasActiveSubscription, hasActiveSubscriptionForUserId } from './subscriptions';

export interface WorkspaceContext {
  role: 'owner' | 'member' | 'none';
  workspaceOwnerId: string | null;
  canAccessCloud: boolean;
}

export async function getWorkspaceContext(ctx: QueryCtx): Promise<WorkspaceContext> {
  let user;
  try {
    user = await authComponent.getAuthUser(ctx);
  } catch {
    return { role: 'none', workspaceOwnerId: null, canAccessCloud: false };
  }
  if (!user) return { role: 'none', workspaceOwnerId: null, canAccessCloud: false };

  const ownActive = await hasActiveSubscription(ctx);
  if (ownActive) {
    return {
      role: 'owner',
      workspaceOwnerId: user._id,
      canAccessCloud: true,
    };
  }

  const membership = await ctx.db
    .query('workspaceMembers')
    .withIndex('by_member', (q) => q.eq('memberId', user._id))
    .first();

  if (membership) {
    const ownerActive = await hasActiveSubscriptionForUserId(ctx, membership.workspaceOwnerId);
    return {
      role: 'member',
      workspaceOwnerId: membership.workspaceOwnerId,
      canAccessCloud: ownerActive,
    };
  }

  return {
    role: 'none',
    workspaceOwnerId: null,
    canAccessCloud: false,
  };
}
