import type { StorageReferences } from './storageReferences';

export const AVATAR_UPLOAD_RESERVATION_TTL_MS = 5 * 60 * 1000;
export const MAX_AGENT_NAME_LENGTH = 64;

export type AvatarClaimRejection =
  | 'reservation_owner'
  | 'reservation_agent'
  | 'reservation_expired'
  | 'storage_predates_reservation'
  | 'storage_created_after_reservation'
  | 'storage_referenced';

export function validateAvatarStorageClaim({
  callerId,
  agent,
  now,
  reservation,
  storageCreatedAt,
  references,
}: {
  callerId: string;
  agent: string;
  now: number;
  reservation: {
    ownerId: string;
    agent: string;
    createdAt: number;
    expiresAt: number;
  };
  storageCreatedAt: number;
  references: StorageReferences;
}): AvatarClaimRejection | null {
  if (reservation.ownerId !== callerId) return 'reservation_owner';
  if (reservation.agent !== agent) return 'reservation_agent';
  if (now > reservation.expiresAt) return 'reservation_expired';
  if (storageCreatedAt < reservation.createdAt) return 'storage_predates_reservation';
  if (storageCreatedAt > reservation.expiresAt) return 'storage_created_after_reservation';
  if (
    references.commentAttachment ||
    references.pendingCommentUpload ||
    references.dataExport ||
    references.agentAvatar
  ) {
    return 'storage_referenced';
  }
  return null;
}
