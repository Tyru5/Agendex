import { query } from './_generated/server';
import { authComponent } from './auth';
import { type DbCtx, hasActiveSubscription, hasActiveSubscriptionForUserId } from './subscriptions';

export interface WorkspaceContext {
  role: 'owner' | 'member' | 'none';
  workspaceOwnerId: string | null;
  canAccessCloud: boolean;
}

export async function resolveWorkspaceContext(ctx: DbCtx): Promise<WorkspaceContext> {
  const user = await authComponent.safeGetAuthUser(ctx);
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

/**
 * True when the user can treat the product as Pro for read/UI (personal subscription, or
 * workspace member of an owner with an active subscription). Do not use this to gate write
 * mutations — those must use `hasActiveSubscription` (subscriber on the caller's account only).
 */
export async function hasProEntitlement(ctx: DbCtx): Promise<boolean> {
  const w = await resolveWorkspaceContext(ctx);
  return w.canAccessCloud;
}

/** Client hook should use this query so `canAccessCloud` matches server checks (incl. owner subscription for members). */
export const getWorkspaceContext = query({
  args: {},
  handler: async (ctx) => resolveWorkspaceContext(ctx),
});
