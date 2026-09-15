/// <reference lib="webworker" />

import {
  clearBytes,
  computeRecoveryVerificationProof,
  createRecoveryKit,
  deriveWorkspaceKeys,
  generateWorkspaceKey,
  prewarmPassphraseKdf,
  unwrapWorkspaceKeyWithPassphrase,
  wrapWorkspaceKeyWithPassphrase,
  type PassphraseWrappedKeyV1,
} from '@agendex/shared/crypto';

type UnlockRequest = {
  mode: 'unlock';
  id: string;
  passphrase: string;
  wrappedKey: PassphraseWrappedKeyV1;
  workspaceOwnerId: string;
  keyEpoch: number;
};

type SetupRequest = {
  mode: 'setup';
  id: string;
  passphrase: string;
  workspaceOwnerId: string;
  keyEpoch: number;
};

type WarmRequest = {
  mode: 'warm';
  id: string;
};

self.onmessage = async (event: MessageEvent<UnlockRequest | SetupRequest | WarmRequest>) => {
  const request = event.data;
  try {
    if (request.mode === 'warm') {
      await prewarmPassphraseKdf();
      self.postMessage({ id: request.id, ok: true });
      return;
    }
    if (request.mode === 'setup') {
      const workspaceKey = generateWorkspaceKey();
      const passphraseWrappedKey = await wrapWorkspaceKeyWithPassphrase({
        workspaceKey,
        passphrase: request.passphrase,
        workspaceOwnerId: request.workspaceOwnerId,
        keyEpoch: request.keyEpoch,
      });
      const { kit: recoveryKit, recoveryEnvelope } = createRecoveryKit({
        workspaceKey,
        workspaceOwnerId: request.workspaceOwnerId,
        keyEpoch: request.keyEpoch,
      });
      const { indexKey } = deriveWorkspaceKeys(workspaceKey);
      const recoveryProofCommitment = computeRecoveryVerificationProof(
        indexKey,
        request.workspaceOwnerId,
        request.keyEpoch,
      );
      const transferred = workspaceKey.slice().buffer;
      clearBytes(workspaceKey, indexKey);
      self.postMessage(
        {
          id: request.id,
          ok: true,
          workspaceKey: transferred,
          passphraseWrappedKey,
          recoveryKit,
          recoveryEnvelope,
          recoveryProofCommitment,
        },
        [transferred],
      );
      return;
    }

    const workspaceKey = await unwrapWorkspaceKeyWithPassphrase({
      wrappedKey: request.wrappedKey,
      passphrase: request.passphrase,
      workspaceOwnerId: request.workspaceOwnerId,
      keyEpoch: request.keyEpoch,
    });
    const transferred = workspaceKey.slice().buffer;
    clearBytes(workspaceKey);
    self.postMessage({ id: request.id, ok: true, workspaceKey: transferred }, [transferred]);
  } catch (error) {
    self.postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : 'Unable to unlock Obfuscation',
    });
  }
};

export {};
