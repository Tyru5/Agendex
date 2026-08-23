import { canonicalJson } from './encoding.ts';
import { openText, sealText } from './envelope.ts';
import { deriveWorkspaceKeys, generateStableCryptoId } from './keys.ts';
import {
  CryptoFormatError,
  type CryptoEnvelopeV1,
  type CryptoSlot,
  type WorkspaceCryptoTable,
} from './types.ts';

export interface EncryptedWorkspaceValue {
  stableCryptoId: string;
  keyEpoch: number;
  envelope: CryptoEnvelopeV1;
}

/** Encrypt a structured workspace value under the content sub-key. */
export function encryptWorkspaceValue(args: {
  workspaceKey: Uint8Array;
  workspaceOwnerId: string;
  keyEpoch: number;
  table: WorkspaceCryptoTable;
  slot: CryptoSlot;
  value: unknown;
  stableCryptoId?: string;
}): EncryptedWorkspaceValue {
  const stableCryptoId = args.stableCryptoId ?? generateStableCryptoId();
  const { contentKey } = deriveWorkspaceKeys(args.workspaceKey);
  try {
    return {
      stableCryptoId,
      keyEpoch: args.keyEpoch,
      envelope: sealText(contentKey, canonicalJson(args.value), {
        workspaceOwnerId: args.workspaceOwnerId,
        table: args.table,
        stableCryptoId,
        slot: args.slot,
        keyEpoch: args.keyEpoch,
      }),
    };
  } finally {
    contentKey.fill(0);
  }
}

/** Authenticate, decrypt, and parse a structured workspace value. */
export function decryptWorkspaceValue<T = unknown>(args: {
  workspaceKey: Uint8Array;
  workspaceOwnerId: string;
  keyEpoch: number;
  table: WorkspaceCryptoTable;
  slot: CryptoSlot;
  stableCryptoId: string;
  envelope: unknown;
}): T {
  const { contentKey } = deriveWorkspaceKeys(args.workspaceKey);
  let plaintext: string;
  try {
    plaintext = openText(contentKey, args.envelope, {
      workspaceOwnerId: args.workspaceOwnerId,
      table: args.table,
      stableCryptoId: args.stableCryptoId,
      slot: args.slot,
      keyEpoch: args.keyEpoch,
    });
  } finally {
    contentKey.fill(0);
  }
  try {
    return JSON.parse(plaintext) as T;
  } catch {
    throw new CryptoFormatError('Encrypted workspace value is not valid JSON');
  }
}
