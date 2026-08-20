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

const planAnnotationKind = v.union(
  v.literal('comment'),
  v.literal('replacement'),
  v.literal('deletion'),
  v.literal('insertion'),
  v.literal('global_comment'),
);

const planAnnotationStatus = v.union(
  v.literal('draft'),
  v.literal('open'),
  v.literal('submitted'),
  v.literal('resolved'),
);

const planTextAnchor = v.object({
  quote: v.optional(v.string()),
  startOffset: v.optional(v.number()),
  endOffset: v.optional(v.number()),
  occurrenceIndex: v.optional(v.number()),
  prefix: v.optional(v.string()),
  suffix: v.optional(v.string()),
  contentHash: v.optional(v.string()),
});

export const cryptoEnvelopeV1 = v.object({
  v: v.literal(1),
  alg: v.literal('xchacha20poly1305'),
  keyEpoch: v.number(),
  nonce: v.bytes(),
  ciphertext: v.bytes(),
});

const scryptKdfParamsV1 = v.object({
  v: v.literal(1),
  alg: v.literal('scrypt'),
  salt: v.bytes(),
  N: v.number(),
  r: v.number(),
  p: v.number(),
  dkLen: v.literal(32),
  maxmem: v.number(),
});

const argon2idKdfParamsV1 = v.object({
  v: v.literal(1),
  alg: v.literal('argon2id'),
  salt: v.bytes(),
  memorySize: v.number(),
  iterations: v.number(),
  parallelism: v.number(),
  dkLen: v.literal(32),
});

export const passphraseKdfParamsV1 = v.union(scryptKdfParamsV1, argon2idKdfParamsV1);

const workspaceCryptoState = v.union(
  v.literal('disabled'),
  v.literal('preparing'),
  v.literal('sealing'),
  v.literal('sealed'),
  v.literal('rotating'),
  v.literal('failed'),
);

const workspaceCryptoOperation = v.object({
  id: v.string(),
  kind: v.union(v.literal('seal'), v.literal('rotate')),
  phase: v.string(),
  cursor: v.optional(v.string()),
  processed: v.number(),
  total: v.optional(v.number()),
  lastStableCryptoId: v.optional(v.string()),
  auditTable: v.optional(v.string()),
  lastError: v.optional(v.string()),
  leaseId: v.optional(v.string()),
  leaseExpiresAt: v.optional(v.number()),
  heartbeatAt: v.optional(v.number()),
  startedAt: v.number(),
  updatedAt: v.number(),
  fromEpoch: v.optional(v.number()),
  targetEpoch: v.number(),
});

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
    plannotatorContinuityKey: v.optional(v.string()),
    syncIdentityKey: v.optional(v.string()),
    contentHash: v.optional(v.string()),
    stableCryptoId: v.optional(v.string()),
    keyEpoch: v.optional(v.number()),
    encryptedSummary: v.optional(cryptoEnvelopeV1),
    encryptedBody: v.optional(cryptoEnvelopeV1),
    contentToken: v.optional(v.string()),
    localPlanToken: v.optional(v.string()),
    syncIdentityToken: v.optional(v.string()),
    continuityToken: v.optional(v.string()),
    identityVersion: v.optional(v.number()),
    identityStrength: v.optional(v.string()),
    lowValue: v.optional(v.boolean()),
    version: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_owner', ['ownerId'])
    .index('by_owner_and_agent', ['ownerId', 'agent'])
    .index('by_owner_localPlanId', ['ownerId', 'localPlanId'])
    .index('by_owner_localPlanToken', ['ownerId', 'localPlanToken'])
    .index('by_owner_plannotatorContinuityKey', ['ownerId', 'plannotatorContinuityKey'])
    .index('by_owner_syncIdentityKey', ['ownerId', 'syncIdentityKey'])
    .index('by_owner_contentHash', ['ownerId', 'contentHash'])
    .index('by_owner_contentToken', ['ownerId', 'contentToken'])
    .index('by_owner_syncIdentityToken', ['ownerId', 'syncIdentityToken'])
    .index('by_owner_continuityToken', ['ownerId', 'continuityToken'])
    // Server-side content search for the plan list. The list query no longer
    // ships `content` to clients, so full-text matching has to happen here.
    .searchIndex('search_content', {
      searchField: 'content',
      filterFields: ['ownerId', 'agent'],
    })
    // Title search for CLI download lookup (id / name / name+agent).
    .searchIndex('search_title', {
      searchField: 'title',
      filterFields: ['ownerId', 'agent'],
    }),

  shareLinks: defineTable({
    ownerId: v.optional(v.string()),
    planId: v.id('plans'),
    token: v.string(),
    createdBy: v.string(),
    createdAt: v.number(),
    passwordHash: v.optional(v.string()),
  })
    .index('by_token', ['token'])
    .index('by_plan', ['planId'])
    .index('by_owner', ['ownerId']),

  planAnnotations: defineTable({
    ownerId: v.optional(v.string()),
    planId: v.id('plans'),
    authorId: v.string(),
    authorName: v.string(),
    source: v.optional(v.string()),
    type: planAnnotationKind,
    status: planAnnotationStatus,
    body: v.optional(v.string()),
    replacementText: v.optional(v.string()),
    anchor: planTextAnchor,
    createdAt: v.number(),
    updatedAt: v.number(),
    submittedAt: v.optional(v.number()),
    resolvedAt: v.optional(v.number()),
    writebackId: v.optional(v.id('plannotatorWritebacks')),
    stableCryptoId: v.optional(v.string()),
    keyEpoch: v.optional(v.number()),
    encryptedAnnotation: v.optional(cryptoEnvelopeV1),
  })
    .index('by_plan', ['planId'])
    .index('by_owner', ['ownerId'])
    .index('by_plan_status', ['planId', 'status'])
    .index('by_author_plan', ['authorId', 'planId']),

  comments: defineTable({
    ownerId: v.optional(v.string()),
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
          encrypted: v.optional(v.boolean()),
          keyEpoch: v.optional(v.number()),
          stableCryptoId: v.optional(v.string()),
        }),
      ),
    ),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
    stableCryptoId: v.optional(v.string()),
    keyEpoch: v.optional(v.number()),
    encryptedComment: v.optional(cryptoEnvelopeV1),
    encryptedAttachments: v.optional(cryptoEnvelopeV1),
  })
    .index('by_plan', ['planId'])
    .index('by_owner', ['ownerId']),

  planLinks: defineTable({
    ownerId: v.string(),
    planId: v.id('plans'),
    type: v.union(v.literal('branch'), v.literal('commit'), v.literal('pr')),
    value: v.string(),
    url: v.optional(v.string()),
    createdAt: v.number(),
    stableCryptoId: v.optional(v.string()),
    keyEpoch: v.optional(v.number()),
    encryptedLink: v.optional(cryptoEnvelopeV1),
  })
    .index('by_plan', ['planId'])
    .index('by_owner_plan', ['ownerId', 'planId']),

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
    inviteSecretCommitment: v.optional(v.string()),
    encryptedInviteSecret: v.optional(cryptoEnvelopeV1),
    cryptoProtocol: v.optional(v.number()),
    pendingMemberId: v.optional(v.string()),
    memberPublicKey: v.optional(v.bytes()),
    enrollmentProof: v.optional(v.string()),
    approvalRequestedAt: v.optional(v.number()),
    approvedAt: v.optional(v.number()),
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
    source: v.optional(
      v.union(
        v.literal('cli_sync'),
        v.literal('editor'),
        v.literal('restore'),
        v.literal('backfill'),
      ),
    ),
    createdAt: v.number(),
    stableCryptoId: v.optional(v.string()),
    keyEpoch: v.optional(v.number()),
    encryptedSummary: v.optional(cryptoEnvelopeV1),
    encryptedBody: v.optional(cryptoEnvelopeV1),
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
    stableCryptoId: v.optional(v.string()),
    keyEpoch: v.optional(v.number()),
    encryptedName: v.optional(cryptoEnvelopeV1),
    nameToken: v.optional(v.string()),
  })
    .index('by_owner', ['ownerId'])
    .index('by_owner_nameLc', ['ownerId', 'nameLc'])
    .index('by_owner_nameToken', ['ownerId', 'nameToken']),

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
    stableCryptoId: v.optional(v.string()),
    keyEpoch: v.optional(v.number()),
    encryptedName: v.optional(cryptoEnvelopeV1),
    encryptedDescription: v.optional(cryptoEnvelopeV1),
    nameToken: v.optional(v.string()),
  })
    .index('by_owner', ['ownerId'])
    .index('by_owner_nameLc', ['ownerId', 'nameLc'])
    .index('by_owner_nameToken', ['ownerId', 'nameToken']),

  collectionPlans: defineTable({
    ownerId: v.string(),
    collectionId: v.id('collections'),
    planId: v.id('plans'),
    position: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_owner', ['ownerId'])
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
    stableCryptoId: v.optional(v.string()),
    keyEpoch: v.optional(v.number()),
    encrypted: v.optional(v.boolean()),
  })
    .index('by_owner', ['ownerId'])
    .index('by_owner_agent', ['ownerId', 'agent'])
    .index('by_storage', ['storageId']),

  accountPreferences: defineTable({
    ownerId: v.string(),
    collectLocalIpAddress: v.boolean(),
    emptyStatePlanView: v.optional(v.union(v.literal('list'), v.literal('card'))),
    localIpDisclosureAcknowledgedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_owner', ['ownerId']),

  daemonHeartbeats: defineTable({
    ownerId: v.string(),
    lastSeenAt: v.number(),
    lastCleanedAt: v.optional(v.number()),
    deviceId: v.optional(v.string()),
    hostname: v.optional(v.string()),
    ipAddress: v.optional(v.string()),
    startedAtMs: v.optional(v.number()),
    pid: v.optional(v.number()),
    cryptoUnlocked: v.optional(v.boolean()),
    stableCryptoId: v.optional(v.string()),
    keyEpoch: v.optional(v.number()),
    encryptedHostname: v.optional(cryptoEnvelopeV1),
    encryptedIpAddress: v.optional(cryptoEnvelopeV1),
  })
    .index('by_owner', ['ownerId'])
    .index('by_owner_device', ['ownerId', 'deviceId']),

  plannotatorWritebacks: defineTable({
    ownerId: v.string(),
    planId: v.id('plans'),
    localPlanId: v.string(),
    deviceId: v.optional(v.string()),
    action: v.optional(v.union(v.literal('request_changes'), v.literal('approve'))),
    feedback: v.string(),
    revisedContent: v.optional(v.string()),
    annotations: v.optional(v.array(plannotatorFeedbackAnnotation)),
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
    stableCryptoId: v.optional(v.string()),
    keyEpoch: v.optional(v.number()),
    encryptedWriteback: v.optional(cryptoEnvelopeV1),
    localPlanToken: v.optional(v.string()),
  })
    .index('by_owner_status', ['ownerId', 'status'])
    .index('by_owner_localPlanId', ['ownerId', 'localPlanId'])
    .index('by_owner_localPlanToken', ['ownerId', 'localPlanToken'])
    .index('by_owner_device_status', ['ownerId', 'deviceId', 'status'])
    .index('by_plan', ['planId']),

  dataExports: defineTable({
    ownerId: v.string(),
    status: v.union(
      v.literal('pending'),
      v.literal('building'),
      v.literal('ready'),
      v.literal('failed'),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
    expiresAt: v.number(),
    storageId: v.optional(v.id('_storage')),
    error: v.optional(v.string()),
    byteSize: v.optional(v.number()),
    fileName: v.optional(v.string()),
    encryptedBackup: v.optional(v.boolean()),
    keyEpoch: v.optional(v.number()),
  })
    .index('by_owner', ['ownerId'])
    .index('by_owner_status', ['ownerId', 'status'])
    .index('by_expiresAt', ['expiresAt']),

  workspaceCryptoSettings: defineTable({
    ownerId: v.string(),
    state: workspaceCryptoState,
    requestedAt: v.optional(v.number()),
    enabledAt: v.optional(v.number()),
    recoveryVerifiedAt: v.optional(v.number()),
    recoveryProofCommitment: v.string(),
    activeKeyEpoch: v.number(),
    cryptoFormat: v.literal(1),
    ownerKdf: passphraseKdfParamsV1,
    ownerPassphraseWrappedKey: cryptoEnvelopeV1,
    ownerRecoveryWrappedKey: cryptoEnvelopeV1,
    previousKeyEpoch: v.optional(v.number()),
    previousOwnerKdf: v.optional(passphraseKdfParamsV1),
    previousOwnerPassphraseWrappedKey: v.optional(cryptoEnvelopeV1),
    previousOwnerRecoveryWrappedKey: v.optional(cryptoEnvelopeV1),
    minimumClientProtocol: v.number(),
    operation: v.optional(workspaceCryptoOperation),
    lastAuditAt: v.optional(v.number()),
    lastAuditClean: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_owner', ['ownerId'])
    .index('by_state', ['state']),

  memberCryptoIdentities: defineTable({
    userId: v.string(),
    publicKey: v.bytes(),
    encryptedPrivateKey: cryptoEnvelopeV1,
    recoveryWrappedPrivateKey: cryptoEnvelopeV1,
    kdf: passphraseKdfParamsV1,
    keyVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    revokedAt: v.optional(v.number()),
    inviteId: v.optional(v.id('workspaceInvites')),
  }).index('by_user', ['userId']),

  workspaceKeyGrants: defineTable({
    workspaceOwnerId: v.string(),
    memberId: v.string(),
    inviteId: v.optional(v.id('workspaceInvites')),
    keyEpoch: v.number(),
    kem: v.literal('DHKEM(X25519, HKDF-SHA256)'),
    kdf: v.literal('HKDF-SHA256'),
    aead: v.literal('ChaCha20Poly1305'),
    encapsulatedKey: v.bytes(),
    ciphertext: v.bytes(),
    createdAt: v.number(),
    revokedAt: v.optional(v.number()),
  })
    .index('by_workspace', ['workspaceOwnerId'])
    .index('by_member', ['memberId'])
    .index('by_workspace_member', ['workspaceOwnerId', 'memberId'])
    .index('by_workspace_member_epoch', ['workspaceOwnerId', 'memberId', 'keyEpoch']),
});
