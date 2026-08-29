import { describe, expect, test } from 'bun:test';
import { validateAvatarStorageClaim } from './avatarUploadPolicy';
import { hasAnyStorageReference, type StorageReferences } from './storageReferences';

const NO_REFERENCES: StorageReferences = {
  commentAttachment: false,
  pendingCommentUpload: false,
  dataExport: false,
  agentAvatar: false,
};

const RESERVATION = {
  ownerId: 'user-a',
  agent: 'claude',
  createdAt: 1_000,
  expiresAt: 301_000,
};

function claim(overrides: {
  callerId?: string;
  agent?: string;
  now?: number;
  storageCreatedAt?: number;
  references?: StorageReferences;
  reservation?: typeof RESERVATION;
} = {}) {
  return validateAvatarStorageClaim({
    callerId: overrides.callerId ?? 'user-a',
    agent: overrides.agent ?? 'claude',
    now: overrides.now ?? 2_000,
    storageCreatedAt: overrides.storageCreatedAt ?? 1_500,
    references: overrides.references ?? NO_REFERENCES,
    reservation: overrides.reservation ?? RESERVATION,
  });
}

describe('avatar upload ownership policy', () => {
  test('rejects another user reservation and storage created before the caller reservation', () => {
    expect(claim({ callerId: 'user-b' })).toBe('reservation_owner');
    expect(claim({ storageCreatedAt: 999 })).toBe('storage_predates_reservation');
  });

  test.each([
    ['comment attachment', { commentAttachment: true }],
    ['pending comment upload', { pendingCommentUpload: true }],
    ['data export', { dataExport: true }],
  ] as const)('rejects storage referenced by a %s', (_label, reference) => {
    expect(claim({ references: { ...NO_REFERENCES, ...reference } })).toBe('storage_referenced');
  });

  test('rejects replaying a storage ID already claimed by an avatar', () => {
    expect(claim({ references: { ...NO_REFERENCES, agentAvatar: true } })).toBe(
      'storage_referenced',
    );
  });

  test('rejects expired reservations and blobs uploaded after expiry', () => {
    expect(claim({ now: RESERVATION.expiresAt + 1 })).toBe('reservation_expired');
    expect(claim({ storageCreatedAt: RESERVATION.expiresAt + 1 })).toBe(
      'storage_created_after_reservation',
    );
  });

  test('accepts an unreferenced upload created during the caller reservation', () => {
    expect(claim()).toBeNull();
  });

  test('preserves an avatar blob that is also a shared comment attachment', () => {
    expect(
      hasAnyStorageReference({
        ...NO_REFERENCES,
        commentAttachment: true,
      }),
    ).toBe(true);
  });
});
