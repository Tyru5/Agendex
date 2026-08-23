import { randomBytes } from '@noble/ciphers/utils.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToBase64Url, canonicalJson, equalBytes, utf8 } from './encoding.ts';

export function generateInviteSecret(): Uint8Array {
  return randomBytes(32);
}

export function inviteSecretCommitment(secret: Uint8Array): string {
  return bytesToBase64Url(sha256(secret));
}

function inviteProofPayload(token: string, userId: string, publicKey: Uint8Array): Uint8Array {
  return utf8(
    canonicalJson(['agendex', 'invite-proof', token, userId, bytesToBase64Url(publicKey)]),
  );
}

export function createInviteEnrollmentProof(args: {
  inviteSecret: Uint8Array;
  token: string;
  userId: string;
  publicKey: Uint8Array;
}): string {
  return bytesToBase64Url(
    hmac(sha256, args.inviteSecret, inviteProofPayload(args.token, args.userId, args.publicKey)),
  );
}

export function verifyInviteEnrollmentProof(args: {
  inviteSecret: Uint8Array;
  token: string;
  userId: string;
  publicKey: Uint8Array;
  proof: string;
}): boolean {
  return equalBytes(utf8(createInviteEnrollmentProof(args)), utf8(args.proof));
}
