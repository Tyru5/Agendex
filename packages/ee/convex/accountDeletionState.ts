import { v } from 'convex/values';

export const ACCOUNT_DELETION_BATCH_SIZE = 50;
export const AUTH_DELETION_BATCH_SIZE = 100;

export const ACCOUNT_DELETION_PHASES = [
  'cancelStripe',
  'plans',
  'comments',
  'planAnnotations',
  'shareLinks',
  'planVersions',
  'planLinks',
  'plannotatorWritebacks',
  'planTags',
  'planPreferences',
  'collectionPlans',
  'tags',
  'collections',
  'pendingUploads',
  'commentUploadReservations',
  'agentAvatars',
  'agentAvatarUploadReservations',
  'dataExports',
  'workspaceMembersOwned',
  'workspaceMembersMemberships',
  'workspaceInvites',
  'daemonHeartbeats',
  'subscriptions',
  'accountPreferences',
  'authSessions',
  'authAccounts',
  'authUser',
] as const;

export type AccountDeletionPhase = (typeof ACCOUNT_DELETION_PHASES)[number];

export const accountDeletionPhaseValidator = v.union(
  v.literal('cancelStripe'),
  v.literal('plans'),
  v.literal('comments'),
  v.literal('planAnnotations'),
  v.literal('shareLinks'),
  v.literal('planVersions'),
  v.literal('planLinks'),
  v.literal('plannotatorWritebacks'),
  v.literal('planTags'),
  v.literal('planPreferences'),
  v.literal('collectionPlans'),
  v.literal('tags'),
  v.literal('collections'),
  v.literal('pendingUploads'),
  v.literal('commentUploadReservations'),
  v.literal('agentAvatars'),
  v.literal('agentAvatarUploadReservations'),
  v.literal('dataExports'),
  v.literal('workspaceMembersOwned'),
  v.literal('workspaceMembersMemberships'),
  v.literal('workspaceInvites'),
  v.literal('daemonHeartbeats'),
  v.literal('subscriptions'),
  v.literal('accountPreferences'),
  v.literal('authSessions'),
  v.literal('authAccounts'),
  v.literal('authUser'),
);

export function nextAccountDeletionPhase(phase: AccountDeletionPhase): AccountDeletionPhase | null {
  const index = ACCOUNT_DELETION_PHASES.indexOf(phase);
  return ACCOUNT_DELETION_PHASES[index + 1] ?? null;
}

export function accountDeletionPhaseAfterBatch(
  phase: AccountDeletionPhase,
  deletedCount: number,
): AccountDeletionPhase | null {
  return deletedCount > 0 ? phase : nextAccountDeletionPhase(phase);
}

export function accountDeletionRetryDelayMs(attempt: number): number {
  const boundedAttempt = Math.max(0, Math.min(Math.floor(attempt), 8));
  return Math.min(5_000 * 2 ** boundedAttempt, 15 * 60 * 1_000);
}

type StripeErrorLike = {
  code?: unknown;
  statusCode?: unknown;
  message?: unknown;
  raw?: { code?: unknown; statusCode?: unknown; message?: unknown };
};

export function isStripeSubscriptionAlreadyCanceled(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as StripeErrorLike;
  const code = candidate.code ?? candidate.raw?.code;
  const statusCode = candidate.statusCode ?? candidate.raw?.statusCode;
  const message = String(candidate.message ?? candidate.raw?.message ?? '').toLowerCase();

  return (
    code === 'resource_missing' ||
    statusCode === 404 ||
    message.includes('no such subscription') ||
    message.includes('already canceled') ||
    message.includes('already cancelled')
  );
}
