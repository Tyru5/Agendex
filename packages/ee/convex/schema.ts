import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

const plannotatorPlanAnnotation = v.object({
  id: v.optional(v.string()),
  source: v.optional(v.string()),
  author: v.optional(v.string()),
  type: v.union(
    v.literal('DELETION'),
    v.literal('REPLACEMENT'),
    v.literal('INSERTION'),
    v.literal('COMMENT'),
    v.literal('GLOBAL_COMMENT'),
  ),
  text: v.optional(v.string()),
  originalText: v.optional(v.string()),
  replacementText: v.optional(v.string()),
  insertionText: v.optional(v.string()),
  blockId: v.optional(v.string()),
  startOffset: v.optional(v.number()),
  endOffset: v.optional(v.number()),
  createdAt: v.optional(v.number()),
});

const plannotatorReviewAnnotation = v.object({
  id: v.optional(v.string()),
  source: v.optional(v.string()),
  author: v.optional(v.string()),
  type: v.union(v.literal('comment'), v.literal('suggestion'), v.literal('concern')),
  scope: v.optional(v.union(v.literal('line'), v.literal('file'))),
  filePath: v.string(),
  lineStart: v.number(),
  lineEnd: v.number(),
  side: v.optional(v.union(v.literal('old'), v.literal('new'))),
  text: v.optional(v.string()),
  suggestedCode: v.optional(v.string()),
  originalCode: v.optional(v.string()),
  severity: v.optional(v.string()),
  reasoning: v.optional(v.string()),
  createdAt: v.optional(v.number()),
});

export const plannotatorFeedbackAnnotation = v.union(
  plannotatorPlanAnnotation,
  plannotatorReviewAnnotation,
);

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
    passwordHash: v.optional(v.string()),
  })
    .index('by_token', ['token'])
    .index('by_plan', ['planId']),

  comments: defineTable({
    planId: v.id('plans'),
    authorId: v.string(),
    authorName: v.string(),
    authorAvatar: v.optional(v.string()),
    body: v.string(),
    attachments: v.optional(
      v.array(
        v.object({
          storageId: v.id('_storage'),
          fileName: v.optional(v.string()),
          contentType: v.string(),
          size: v.number(),
        }),
      ),
    ),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  }).index('by_plan', ['planId']),

  commentAttachmentClaims: defineTable({
    storageId: v.id('_storage'),
    commentId: v.id('comments'),
  })
    .index('by_storage', ['storageId'])
    .index('by_comment', ['commentId']),

  commentUploadReservations: defineTable({
    clientUploadId: v.optional(v.string()),
    uploadedBy: v.string(),
    planId: v.id('plans'),
    createdAt: v.number(),
  })
    .index('by_createdAt', ['createdAt'])
    .index('by_user_plan_createdAt', ['uploadedBy', 'planId', 'createdAt'])
    .index('by_user_plan_clientUploadId', ['uploadedBy', 'planId', 'clientUploadId'])
    .index('by_plan', ['planId'])
    .index('by_uploadedBy', ['uploadedBy']),

  pendingUploads: defineTable({
    storageId: v.id('_storage'),
    uploadedBy: v.string(),
    planId: v.id('plans'),
    createdAt: v.number(),
  })
    .index('by_storage', ['storageId'])
    .index('by_user_storage', ['uploadedBy', 'storageId'])
    .index('by_createdAt', ['createdAt'])
    .index('by_plan', ['planId'])
    .index('by_uploadedBy', ['uploadedBy']),

  subscriptions: defineTable({
    userId: v.string(),
    stripeCustomerId: v.string(),
    stripeSubscriptionId: v.string(),
    status: v.union(
      v.literal('active'),
      v.literal('canceled'),
      v.literal('past_due'),
      v.literal('incomplete'),
      v.literal('incomplete_expired'),
      v.literal('trialing'),
      v.literal('paused'),
      v.literal('unpaid'),
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
    emailLc: v.string(),
    role: v.union(v.literal('owner'), v.literal('member')),
    addedAt: v.number(),
  })
    .index('by_workspace', ['workspaceOwnerId'])
    .index('by_member', ['memberId'])
    .index('by_workspace_member', ['workspaceOwnerId', 'memberId'])
    .index('by_workspace_emailLc', ['workspaceOwnerId', 'emailLc']),

  workspaceInvites: defineTable({
    workspaceOwnerId: v.string(),
    email: v.string(),
    emailLc: v.string(),
    token: v.string(),
    createdAt: v.number(),
    acceptedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index('by_workspace', ['workspaceOwnerId'])
    .index('by_emailLc', ['emailLc'])
    .index('by_token', ['token'])
    .index('by_workspace_emailLc', ['workspaceOwnerId', 'emailLc']),

  planVersions: defineTable({
    ownerId: v.string(),
    planId: v.id('plans'),
    version: v.number(),
    title: v.string(),
    content: v.string(),
    format: v.string(),
    filePath: v.optional(v.string()),
    workspace: v.optional(v.string()),
    metadata: v.optional(v.any()),
    source: v.optional(v.union(v.literal('cli_sync'), v.literal('editor'), v.literal('restore'))),
    createdAt: v.number(),
  })
    .index('by_plan', ['planId'])
    .index('by_plan_version', ['planId', 'version'])
    .index('by_owner_createdAt', ['ownerId', 'createdAt']),

  tags: defineTable({
    ownerId: v.string(),
    name: v.string(),
    nameLc: v.string(),
    color: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_owner', ['ownerId'])
    .index('by_owner_nameLc', ['ownerId', 'nameLc']),

  planTags: defineTable({
    ownerId: v.string(),
    planId: v.id('plans'),
    tagId: v.id('tags'),
    createdAt: v.number(),
  })
    .index('by_plan', ['planId'])
    .index('by_tag', ['tagId'])
    .index('by_plan_tag', ['planId', 'tagId'])
    .index('by_owner_plan', ['ownerId', 'planId']),

  collections: defineTable({
    ownerId: v.string(),
    name: v.string(),
    nameLc: v.string(),
    description: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_owner', ['ownerId'])
    .index('by_owner_nameLc', ['ownerId', 'nameLc']),

  collectionPlans: defineTable({
    ownerId: v.string(),
    collectionId: v.id('collections'),
    planId: v.id('plans'),
    position: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_collection', ['collectionId'])
    .index('by_plan', ['planId'])
    .index('by_collection_plan', ['collectionId', 'planId']),

  planPreferences: defineTable({
    ownerId: v.string(),
    planId: v.id('plans'),
    pinned: v.boolean(),
    lastSeenUpdatedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_owner', ['ownerId'])
    .index('by_owner_plan', ['ownerId', 'planId'])
    .index('by_owner_pinned', ['ownerId', 'pinned']),

  agentAvatars: defineTable({
    ownerId: v.string(),
    agent: v.string(),
    storageId: v.id('_storage'),
    updatedAt: v.number(),
  })
    .index('by_owner', ['ownerId'])
    .index('by_owner_agent', ['ownerId', 'agent'])
    .index('by_storage', ['storageId']),

  daemonHeartbeats: defineTable({
    ownerId: v.string(),
    lastSeenAt: v.number(),
    lastCleanedAt: v.optional(v.number()),
    deviceId: v.optional(v.string()),
    hostname: v.optional(v.string()),
    startedAtMs: v.optional(v.number()),
    pid: v.optional(v.number()),
  })
    .index('by_owner', ['ownerId'])
    .index('by_owner_device', ['ownerId', 'deviceId']),

  plannotatorWritebacks: defineTable({
    ownerId: v.string(),
    planId: v.id('plans'),
    localPlanId: v.string(),
    deviceId: v.optional(v.string()),
    feedback: v.string(),
    revisedContent: v.optional(v.string()),
    annotations: v.optional(v.array(plannotatorFeedbackAnnotation)),
    source: v.string(),
    status: v.union(
      v.literal('pending'),
      v.literal('sent'),
      v.literal('failed'),
      v.literal('expired'),
    ),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    expiresAt: v.number(),
    sentAt: v.optional(v.number()),
  })
    .index('by_owner_status', ['ownerId', 'status'])
    .index('by_owner_localPlanId', ['ownerId', 'localPlanId'])
    .index('by_owner_device_status', ['ownerId', 'deviceId', 'status'])
    .index('by_plan', ['planId']),
});
