import { expect, test } from 'bun:test';
import {
  base64UrlToBytes,
  bytesToBase64Url,
  createInviteEnrollmentProof,
  inviteSecretCommitment,
  verifyInviteEnrollmentProof,
} from './index.ts';

test('invite values use canonical URL-safe encoding and bind enrollment identity', () => {
  const inviteSecret = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);
  const publicKey = Uint8Array.from({ length: 32 }, (_, index) => index);
  const encodedSecret = bytesToBase64Url(inviteSecret);
  const proof = createInviteEnrollmentProof({
    inviteSecret,
    token: 'invite-token',
    userId: 'member-a',
    publicKey,
  });

  expect(encodedSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(base64UrlToBytes(encodedSecret)).toEqual(inviteSecret);
  expect(inviteSecretCommitment(inviteSecret)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(proof).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(
    verifyInviteEnrollmentProof({
      inviteSecret,
      token: 'invite-token',
      userId: 'member-a',
      publicKey,
      proof,
    }),
  ).toBe(true);
  expect(
    verifyInviteEnrollmentProof({
      inviteSecret,
      token: 'replayed-token',
      userId: 'member-a',
      publicKey,
      proof,
    }),
  ).toBe(false);
  expect(
    verifyInviteEnrollmentProof({
      inviteSecret,
      token: 'invite-token',
      userId: 'member-b',
      publicKey,
      proof,
    }),
  ).toBe(false);
});
