import {
  resolveUsageSession,
  sessionCostFromSnapshots,
  unavailableSessionCost,
  type PlanSessionCost,
  type SessionUsageSnapshot,
} from '@agendex/shared/session-cost';
import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { query, type QueryCtx } from './_generated/server';
import { authComponent } from './auth';
import { normalizeUsageSnapshots } from './cli';
import { isVisiblePlan } from './planVisibility';

const reasonValidator = v.union(
  v.literal('unsupported-agent'),
  v.literal('missing-session'),
  v.literal('ambiguous-session'),
  v.literal('unverified-session'),
  v.literal('usage-unavailable'),
  v.literal('incomplete-snapshot'),
  v.literal('no-records'),
);
export const sessionCostValidator = v.object({
  status: v.union(v.literal('available'), v.literal('unavailable')),
  reason: v.union(reasonValidator, v.null()),
  agent: v.union(v.literal('claude-code'), v.literal('codex-cli'), v.literal('grok'), v.null()),
  sessionId: v.union(v.string(), v.null()),
  windowDays: v.number(),
  generatedAt: v.union(v.string(), v.null()),
  currency: v.literal('USD'),
  costUsd: v.union(v.number(), v.null()),
  pricing: v.union(v.literal('estimated'), v.literal('partial'), v.literal('unpriced'), v.null()),
  totalTokens: v.union(v.number(), v.null()),
  records: v.number(),
  unpricedRecords: v.number(),
  sharedPlanCount: v.union(v.number(), v.null()),
  models: v.array(
    v.object({
      model: v.string(),
      totalTokens: v.number(),
      costUsd: v.union(v.number(), v.null()),
      unpricedRecords: v.number(),
    }),
  ),
});

/** Usage is private to the owner: workspace/shared-plan access is insufficient. */
export async function readOwnedPlanSessionCost(
  ctx: QueryCtx,
  userId: string | null,
  planId: Id<'plans'>,
): Promise<PlanSessionCost | null> {
  if (!userId) return null;
  const plan = await ctx.db.get(planId);
  if (!plan || plan.ownerId !== userId || !isVisiblePlan(plan)) return null;
  const identity = resolveUsageSession(plan);
  if (typeof identity === 'string') return unavailableSessionCost(identity);
  // Bound device reads (snapshots are up to 512 KB each); refuse oversized accounts.
  const devices = await ctx.db
    .query('daemonHeartbeats')
    .withIndex('by_owner', (q) => q.eq('ownerId', userId))
    .take(9);
  if (devices.length > 8) return unavailableSessionCost('incomplete-snapshot', identity);
  const snapshots: SessionUsageSnapshot[] = [];
  for (const device of devices) {
    const snapshot = normalizeUsageSnapshots(device.usageSnapshots)?.['90'];
    if (snapshot) snapshots.push(snapshot as SessionUsageSnapshot);
  }
  // We cannot count all peer plans without an unbounded document read. The UI
  // always explains that this whole-session amount can be shared by other plans.
  return sessionCostFromSnapshots(identity, snapshots);
}

export const get = query({
  args: { planId: v.id('plans') },
  returns: v.union(sessionCostValidator, v.null()),
  handler: async (ctx, args) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    return readOwnedPlanSessionCost(ctx, user ? String(user._id) : null, args.planId);
  },
});
