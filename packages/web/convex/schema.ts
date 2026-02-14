import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  plans: defineTable({
    ownerId: v.string(),
    localPlanId: v.optional(v.string()),
    agent: v.string(),
    title: v.string(),
    content: v.string(),
    format: v.string(),
    filePath: v.optional(v.string()),
    workspace: v.optional(v.string()),
    metadata: v.optional(v.any()),
    version: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_owner', ['ownerId'])
    .index('by_owner_localPlanId', ['ownerId', 'localPlanId']),

  shareLinks: defineTable({
    planId: v.id('plans'),
    token: v.string(),
    createdBy: v.string(),
    createdAt: v.number(),
    revokedAt: v.optional(v.number()),
  })
    .index('by_token', ['token'])
    .index('by_plan', ['planId']),

  comments: defineTable({
    planId: v.id('plans'),
    authorId: v.string(),
    authorName: v.string(),
    authorAvatar: v.optional(v.string()),
    body: v.string(),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  }).index('by_plan', ['planId']),

  subscriptions: defineTable({
    userId: v.string(),
    stripeCustomerId: v.string(),
    stripeSubscriptionId: v.string(),
    status: v.union(
      v.literal('active'),
      v.literal('canceled'),
      v.literal('past_due'),
      v.literal('incomplete'),
      v.literal('trialing'),
    ),
    plan: v.union(v.literal('monthly'), v.literal('yearly')),
    currentPeriodEnd: v.number(),
    cancelAtPeriodEnd: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_stripe_customer', ['stripeCustomerId'])
    .index('by_stripe_subscription', ['stripeSubscriptionId']),

  workspaceMembers: defineTable({
    workspaceOwnerId: v.string(),
    memberId: v.string(),
    email: v.string(),
    role: v.union(v.literal('owner'), v.literal('member')),
    addedAt: v.number(),
  })
    .index('by_workspace', ['workspaceOwnerId'])
    .index('by_member', ['memberId']),
});
