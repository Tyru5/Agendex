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
});
