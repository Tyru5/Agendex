import { v, type Infer } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import {
  planMetadataValidator,
  toPlanMetadataDto,
} from './planMetadata';
export { planMetadataValidator, toPlanMetadataDto, type PlanMetadataDto } from './planMetadata';

const planFields = {
  ownerId: v.string(),
  localPlanId: v.optional(v.string()),
  agent: v.string(),
  title: v.string(),
  content: v.string(),
  format: v.string(),
  filePath: v.optional(v.string()),
  workspace: v.optional(v.string()),
  metadata: v.optional(planMetadataValidator),
  plannotatorContinuityKey: v.optional(v.string()),
  syncIdentityKey: v.optional(v.string()),
  contentHash: v.optional(v.string()),
  identityVersion: v.optional(v.number()),
  identityStrength: v.optional(v.string()),
  version: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
};

export const planValidator = v.object({
  _id: v.id('plans'),
  _creationTime: v.number(),
  ...planFields,
});

export const planListItemValidator = v.object({
  _id: v.id('plans'),
  _creationTime: v.number(),
  ownerId: planFields.ownerId,
  localPlanId: planFields.localPlanId,
  agent: planFields.agent,
  title: planFields.title,
  format: planFields.format,
  filePath: planFields.filePath,
  workspace: planFields.workspace,
  metadata: planFields.metadata,
  plannotatorContinuityKey: planFields.plannotatorContinuityKey,
  syncIdentityKey: planFields.syncIdentityKey,
  contentHash: planFields.contentHash,
  identityVersion: planFields.identityVersion,
  identityStrength: planFields.identityStrength,
  version: planFields.version,
  createdAt: planFields.createdAt,
  updatedAt: planFields.updatedAt,
});

export type PlanDto = Infer<typeof planValidator>;
export type PlanListItemDto = Infer<typeof planListItemValidator>;

export function toPlanDto(plan: Doc<'plans'>): PlanDto {
  const metadata = toPlanMetadataDto(plan.metadata);
  return {
    _id: plan._id,
    _creationTime: plan._creationTime,
    ownerId: plan.ownerId,
    ...(plan.localPlanId !== undefined && { localPlanId: plan.localPlanId }),
    agent: plan.agent,
    title: plan.title,
    content: plan.content,
    format: plan.format,
    ...(plan.filePath !== undefined && { filePath: plan.filePath }),
    ...(plan.workspace !== undefined && { workspace: plan.workspace }),
    ...(metadata !== undefined && { metadata }),
    ...(plan.plannotatorContinuityKey !== undefined && {
      plannotatorContinuityKey: plan.plannotatorContinuityKey,
    }),
    ...(plan.syncIdentityKey !== undefined && { syncIdentityKey: plan.syncIdentityKey }),
    ...(plan.contentHash !== undefined && { contentHash: plan.contentHash }),
    ...(plan.identityVersion !== undefined && { identityVersion: plan.identityVersion }),
    ...(plan.identityStrength !== undefined && { identityStrength: plan.identityStrength }),
    version: plan.version,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

export function toPlanListItemDto(plan: Doc<'plans'>): PlanListItemDto {
  const { content: _content, ...dto } = toPlanDto(plan);
  return dto;
}

export const planPreferenceValidator = v.object({
  _id: v.id('planPreferences'),
  _creationTime: v.number(),
  ownerId: v.string(),
  planId: v.id('plans'),
  pinned: v.boolean(),
  lastSeenUpdatedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const planAnnotationValidator = v.object({
  _id: v.id('planAnnotations'),
  _creationTime: v.number(),
  planId: v.id('plans'),
  authorId: v.string(),
  authorName: v.string(),
  source: v.optional(v.string()),
  type: v.union(
    v.literal('comment'),
    v.literal('replacement'),
    v.literal('deletion'),
    v.literal('insertion'),
    v.literal('global_comment'),
  ),
  status: v.union(
    v.literal('draft'),
    v.literal('open'),
    v.literal('submitted'),
    v.literal('resolved'),
  ),
  body: v.optional(v.string()),
  replacementText: v.optional(v.string()),
  anchor: v.object({
    quote: v.optional(v.string()),
    startOffset: v.optional(v.number()),
    endOffset: v.optional(v.number()),
    occurrenceIndex: v.optional(v.number()),
    prefix: v.optional(v.string()),
    suffix: v.optional(v.string()),
    contentHash: v.optional(v.string()),
  }),
  createdAt: v.number(),
  updatedAt: v.number(),
  submittedAt: v.optional(v.number()),
  resolvedAt: v.optional(v.number()),
  writebackId: v.optional(v.id('plannotatorWritebacks')),
});

export const plannotatorWritebackValidator = v.object({
  _id: v.id('plannotatorWritebacks'),
  _creationTime: v.number(),
  ownerId: v.string(),
  planId: v.id('plans'),
  localPlanId: v.string(),
  deviceId: v.optional(v.string()),
  action: v.optional(v.union(v.literal('request_changes'), v.literal('approve'))),
  feedback: v.string(),
  revisedContent: v.optional(v.string()),
  annotations: v.optional(
    v.array(
      v.union(
        v.object({
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
        }),
        v.object({
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
        }),
      ),
    ),
  ),
  annotationIds: v.optional(v.array(v.id('planAnnotations'))),
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
});

export const subscriptionValidator = v.object({
  _id: v.id('subscriptions'),
  _creationTime: v.number(),
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
});

export const collectionValidator = v.object({
  _id: v.id('collections'),
  _creationTime: v.number(),
  ownerId: v.string(),
  name: v.string(),
  nameLc: v.string(),
  description: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const tagValidator = v.object({
  _id: v.id('tags'),
  _creationTime: v.number(),
  ownerId: v.string(),
  name: v.string(),
  nameLc: v.string(),
  color: v.optional(v.string()),
  createdAt: v.number(),
});

export const planVersionValidator = v.object({
  _id: v.id('planVersions'),
  _creationTime: v.number(),
  ownerId: v.string(),
  planId: v.id('plans'),
  version: v.number(),
  title: v.string(),
  content: v.string(),
  format: v.string(),
  filePath: v.optional(v.string()),
  workspace: v.optional(v.string()),
  metadata: v.optional(planMetadataValidator),
  source: v.optional(
    v.union(
      v.literal('cli_sync'),
      v.literal('editor'),
      v.literal('restore'),
      v.literal('backfill'),
    ),
  ),
  createdAt: v.number(),
});

export type PlanVersionDto = Infer<typeof planVersionValidator>;

export function toPlanVersionDto(version: Doc<'planVersions'>): PlanVersionDto {
  const metadata = toPlanMetadataDto(version.metadata);
  return {
    _id: version._id,
    _creationTime: version._creationTime,
    ownerId: version.ownerId,
    planId: version.planId,
    version: version.version,
    title: version.title,
    content: version.content,
    format: version.format,
    ...(version.filePath !== undefined && { filePath: version.filePath }),
    ...(version.workspace !== undefined && { workspace: version.workspace }),
    ...(metadata !== undefined && { metadata }),
    ...(version.source !== undefined && { source: version.source }),
    createdAt: version.createdAt,
  };
}

export const workspaceMemberValidator = v.object({
  _id: v.id('workspaceMembers'),
  _creationTime: v.number(),
  workspaceOwnerId: v.string(),
  memberId: v.string(),
  email: v.string(),
  emailLc: v.string(),
  role: v.union(v.literal('owner'), v.literal('member')),
  addedAt: v.number(),
});

export const workspaceInviteValidator = v.object({
  _id: v.id('workspaceInvites'),
  _creationTime: v.number(),
  workspaceOwnerId: v.string(),
  email: v.string(),
  emailLc: v.string(),
  token: v.string(),
  createdAt: v.number(),
  acceptedAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
});

export const authUserValidator = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  name: v.string(),
  email: v.string(),
  emailVerified: v.boolean(),
  image: v.optional(v.union(v.null(), v.string())),
  createdAt: v.number(),
  updatedAt: v.number(),
  twoFactorEnabled: v.optional(v.union(v.null(), v.boolean())),
  isAnonymous: v.optional(v.union(v.null(), v.boolean())),
  username: v.optional(v.union(v.null(), v.string())),
  displayUsername: v.optional(v.union(v.null(), v.string())),
  phoneNumber: v.optional(v.union(v.null(), v.string())),
  phoneNumberVerified: v.optional(v.union(v.null(), v.boolean())),
  userId: v.optional(v.union(v.null(), v.string())),
});
