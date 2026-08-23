import { Chacha20Poly1305 } from '@hpke/chacha20poly1305';
import { CipherSuite, HkdfSha256 } from '@hpke/core';
import { DhkemX25519HkdfSha256 } from '@hpke/dhkem-x25519';
import { canonicalJson, toArrayBuffer, utf8 } from './encoding.ts';
import { CryptoCorruptionError, CryptoFormatError, WORKSPACE_KEY_BYTES } from './types.ts';

const suite = new CipherSuite({
  kem: new DhkemX25519HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Chacha20Poly1305(),
});

export const HPKE_KEM = 'DHKEM(X25519, HKDF-SHA256)' as const;
export const HPKE_KDF = 'HKDF-SHA256' as const;
export const HPKE_AEAD = 'ChaCha20Poly1305' as const;

export interface MemberIdentityKeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export interface WorkspaceKeyGrantCiphertext {
  kem: typeof HPKE_KEM;
  kdf: typeof HPKE_KDF;
  aead: typeof HPKE_AEAD;
  encapsulatedKey: Uint8Array;
  ciphertext: Uint8Array;
}

function grantInfo(workspaceOwnerId: string, memberId: string, keyEpoch: number): Uint8Array {
  return utf8(
    canonicalJson(['agendex', 'workspace-key-grant', workspaceOwnerId, memberId, keyEpoch]),
  );
}

export async function generateMemberIdentityKeyPair(): Promise<MemberIdentityKeyPair> {
  const keyPair = await suite.kem.generateKeyPair();
  return {
    publicKey: new Uint8Array(await suite.kem.serializePublicKey(keyPair.publicKey)),
    privateKey: new Uint8Array(await suite.kem.serializePrivateKey(keyPair.privateKey)),
  };
}

export async function sealWorkspaceKeyGrant(args: {
  workspaceKey: Uint8Array;
  recipientPublicKey: Uint8Array;
  workspaceOwnerId: string;
  memberId: string;
  keyEpoch: number;
}): Promise<WorkspaceKeyGrantCiphertext> {
  if (args.workspaceKey.length !== WORKSPACE_KEY_BYTES) {
    throw new CryptoFormatError('workspace key must be 32 bytes');
  }
  const recipientPublicKey = await suite.kem.deserializePublicKey(args.recipientPublicKey);
  const info = grantInfo(args.workspaceOwnerId, args.memberId, args.keyEpoch);
  const result = await suite.seal({ recipientPublicKey, info }, args.workspaceKey, info);
  return {
    kem: HPKE_KEM,
    kdf: HPKE_KDF,
    aead: HPKE_AEAD,
    encapsulatedKey: new Uint8Array(result.enc),
    ciphertext: new Uint8Array(result.ct),
  };
}

export async function openWorkspaceKeyGrant(args: {
  grant: WorkspaceKeyGrantCiphertext;
  recipientPrivateKey: Uint8Array;
  workspaceOwnerId: string;
  memberId: string;
  keyEpoch: number;
}): Promise<Uint8Array> {
  if (args.grant.kem !== HPKE_KEM || args.grant.kdf !== HPKE_KDF || args.grant.aead !== HPKE_AEAD) {
    throw new CryptoFormatError('unsupported workspace key grant');
  }
  const recipientKey = await suite.kem.deserializePrivateKey(args.recipientPrivateKey);
  const info = grantInfo(args.workspaceOwnerId, args.memberId, args.keyEpoch);
  try {
    const plaintext = new Uint8Array(
      await suite.open(
        { recipientKey, enc: toArrayBuffer(args.grant.encapsulatedKey), info },
        args.grant.ciphertext,
        info,
      ),
    );
    if (plaintext.length !== WORKSPACE_KEY_BYTES) {
      plaintext.fill(0);
      throw new CryptoFormatError('workspace key grant has the wrong size');
    }
    return plaintext;
  } catch (error) {
    if (error instanceof CryptoFormatError) throw error;
    throw new CryptoCorruptionError('Workspace key grant failed authentication');
  }
}
