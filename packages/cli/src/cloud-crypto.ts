import {
  base64ToBytes,
  bytesToBase64,
  clearBytes,
  deserializeCryptoEnvelope,
  decryptWorkspaceValue,
  decryptPlanBody,
  decryptPlanSummary,
  toArrayBuffer,
  openWorkspaceKeyGrant,
  parseRecoveryKit,
  recoverMemberPrivateKey,
  recoverWorkspaceKey,
  unwrapMemberPrivateKeyWithPassphrase,
  unwrapWorkspaceKeyWithPassphrase,
  type PassphraseWrappedKeyV1,
} from '@agendex/shared/crypto';
import { cancel, isCancel, password } from '@clack/prompts';
import { readFile } from 'node:fs/promises';
import {
  fetchWorkspaceCryptoStatus,
  type CliWorkspaceCryptoStatus,
  type CloudPlanDownload,
  type CloudPlanDownloadMatch,
  type PlannotatorWritebackJob,
} from './api.ts';
import { createSecretStore, workspaceSecretKey } from './secret-store.ts';

export interface CliWorkspaceCryptoContext {
  status: Extract<CliWorkspaceCryptoStatus, { enabled: true }>;
  workspaceKey: Uint8Array;
}

const sessionKeys = new Map<string, Uint8Array>();

export function setInjectedWorkspaceKey(
  workspaceOwnerId: string,
  keyEpoch: number,
  keyBase64: string | null,
): void {
  const secretId = workspaceSecretKey(workspaceOwnerId, keyEpoch);
  const previous = sessionKeys.get(secretId);
  if (previous) clearBytes(previous);
  if (keyBase64 === null) sessionKeys.delete(secretId);
  else sessionKeys.set(secretId, base64ToBytes(keyBase64, 'injected workspace key'));
}

export function getInjectedWorkspaceKey(
  workspaceOwnerId: string,
  keyEpoch: number,
): Uint8Array | null {
  return sessionKeys.get(workspaceSecretKey(workspaceOwnerId, keyEpoch))?.slice() ?? null;
}

type PrivateWriteback = Pick<
  PlannotatorWritebackJob,
  'localPlanId' | 'action' | 'feedback' | 'revisedContent' | 'annotations' | 'source'
>;

export async function decryptPlannotatorWritebackJob(
  job: PlannotatorWritebackJob,
): Promise<PlannotatorWritebackJob | null> {
  const context = await getCliWorkspaceCryptoContext({ promptIfMissing: false });
  if (!context) return job;
  if (context.workspaceKey.length === 0) return null;
  if (!job.encryptedWriteback || !job.stableCryptoId || !job.keyEpoch) {
    clearBytes(context.workspaceKey);
    throw new Error('Encrypted workspace returned a plaintext write-back');
  }
  try {
    const privateValue = decryptWorkspaceValue<PrivateWriteback>({
      workspaceKey: context.workspaceKey,
      workspaceOwnerId: context.status.workspaceOwnerId,
      keyEpoch: job.keyEpoch,
      table: 'plannotatorWritebacks',
      slot: 'writeback',
      stableCryptoId: job.stableCryptoId,
      envelope: deserializeCryptoEnvelope(job.encryptedWriteback),
    });
    return { ...job, ...privateValue };
  } finally {
    clearBytes(context.workspaceKey);
  }
}

export async function decryptCloudPlanMatch(
  plan: CloudPlanDownloadMatch,
): Promise<CloudPlanDownloadMatch> {
  const [decrypted] = await decryptCloudPlanMatches([plan]);
  if (!decrypted) throw new Error('Cloud plan disappeared during decryption');
  return decrypted;
}

export async function decryptCloudPlanMatches(
  plans: CloudPlanDownloadMatch[],
): Promise<CloudPlanDownloadMatch[]> {
  if (!plans.some((plan) => plan.encryptedSummary)) return plans;
  const context = await getCliWorkspaceCryptoContext({ promptIfMissing: true });
  if (!context) throw new Error('Encrypted plan returned by a plaintext workspace');
  try {
    return plans.map((plan) => {
      if (!plan.encryptedSummary) return plan;
      if (!plan.ownerId || !plan.stableCryptoId || !plan.keyEpoch) {
        throw new Error('Encrypted plan metadata is incomplete');
      }
      const summary = decryptPlanSummary({
        workspaceKey: context.workspaceKey,
        workspaceOwnerId: plan.ownerId,
        stableCryptoId: plan.stableCryptoId,
        keyEpoch: plan.keyEpoch,
        envelope: deserializeCryptoEnvelope(plan.encryptedSummary),
      });
      return { ...plan, localPlanId: summary.localPlanId, title: summary.title };
    });
  } finally {
    clearBytes(context.workspaceKey);
  }
}

export async function decryptCloudPlanDownload(
  plan: CloudPlanDownload,
): Promise<CloudPlanDownload> {
  if (!plan.encryptedSummary && !plan.encryptedBody) return plan;
  if (!plan.encryptedSummary || !plan.encryptedBody) {
    throw new Error('Encrypted plan is missing an envelope');
  }
  const context = await getCliWorkspaceCryptoContext({ promptIfMissing: true });
  if (!context) throw new Error('Encrypted plan returned by a plaintext workspace');
  if (!plan.ownerId || !plan.stableCryptoId || !plan.keyEpoch) {
    clearBytes(context.workspaceKey);
    throw new Error('Encrypted plan metadata is incomplete');
  }
  try {
    const summary = decryptPlanSummary({
      workspaceKey: context.workspaceKey,
      workspaceOwnerId: plan.ownerId,
      stableCryptoId: plan.stableCryptoId,
      keyEpoch: plan.keyEpoch,
      envelope: deserializeCryptoEnvelope(plan.encryptedSummary),
    });
    const content = decryptPlanBody({
      workspaceKey: context.workspaceKey,
      workspaceOwnerId: plan.ownerId,
      stableCryptoId: plan.stableCryptoId,
      keyEpoch: plan.keyEpoch,
      envelope: deserializeCryptoEnvelope(plan.encryptedBody),
    });
    return {
      ...plan,
      localPlanId: summary.localPlanId,
      title: summary.title,
      content,
      filePath: summary.filePath ?? '',
      workspace: summary.workspace,
    };
  } finally {
    clearBytes(context.workspaceKey);
  }
}

function materialFromStatus(
  status: Extract<CliWorkspaceCryptoStatus, { enabled: true; role: 'owner' }>,
): PassphraseWrappedKeyV1 {
  return {
    v: 1,
    kdf: {
      ...status.ownerKdf,
      salt: toArrayBuffer(base64ToBytes(status.ownerKdf.salt, 'KDF salt')),
    },
    envelope: deserializeCryptoEnvelope(status.ownerPassphraseWrappedKey),
  };
}

async function promptForPassphrase(): Promise<string | null> {
  if (!process.stdin.isTTY) return null;
  const value = await password({ message: 'Obfuscation passphrase', mask: '•' });
  if (isCancel(value)) {
    cancel('Unlock cancelled.');
    return null;
  }
  return value;
}

async function retainWorkspaceKey(
  status: Extract<CliWorkspaceCryptoStatus, { enabled: true }>,
  workspaceKey: Uint8Array,
): Promise<void> {
  const secretId = workspaceSecretKey(status.workspaceOwnerId, status.activeKeyEpoch);
  const previous = sessionKeys.get(secretId);
  if (previous) clearBytes(previous);
  sessionKeys.set(secretId, workspaceKey.slice());
  const store = createSecretStore();
  if (await store.available()) await store.set(secretId, bytesToBase64(workspaceKey));
}

export async function getCliWorkspaceCryptoContext(options: {
  promptIfMissing: boolean;
}): Promise<CliWorkspaceCryptoContext | null> {
  const status = await fetchWorkspaceCryptoStatus();
  if (!status)
    throw new Error('Unable to verify the workspace encryption state; refusing cloud access');
  if (!status.enabled) return null;
  const secretId = workspaceSecretKey(status.workspaceOwnerId, status.activeKeyEpoch);
  const session = sessionKeys.get(secretId);
  if (session) return { status, workspaceKey: session.slice() };

  const store = createSecretStore();
  if (await store.available()) {
    const stored = await store.get(secretId);
    if (stored) return { status, workspaceKey: base64ToBytes(stored, 'stored workspace key') };
  }

  if (!options.promptIfMissing) return { status, workspaceKey: new Uint8Array() };
  const passphrase = await promptForPassphrase();
  if (!passphrase) throw new Error('Obfuscation is locked. Run `agendex unlock`.');
  const workspaceKey =
    status.role === 'owner'
      ? await unwrapWorkspaceKeyWithPassphrase({
          wrappedKey: materialFromStatus(status),
          passphrase,
          workspaceOwnerId: status.workspaceOwnerId,
          keyEpoch: status.activeKeyEpoch,
        })
      : await (async () => {
          const privateKey = await unwrapMemberPrivateKeyWithPassphrase({
            encryptedPrivateKey: deserializeCryptoEnvelope(
              status.memberIdentity.encryptedPrivateKey,
            ),
            kdf: {
              ...status.memberIdentity.kdf,
              salt: toArrayBuffer(base64ToBytes(status.memberIdentity.kdf.salt, 'member KDF salt')),
            },
            passphrase,
            userId: status.memberId,
            keyVersion: status.memberIdentity.keyVersion,
          });
          try {
            return await openWorkspaceKeyGrant({
              grant: {
                ...status.grant,
                encapsulatedKey: base64ToBytes(
                  status.grant.encapsulatedKey,
                  'HPKE encapsulated key',
                ),
                ciphertext: base64ToBytes(status.grant.ciphertext, 'HPKE ciphertext'),
              },
              recipientPrivateKey: privateKey,
              workspaceOwnerId: status.workspaceOwnerId,
              memberId: status.memberId,
              keyEpoch: status.activeKeyEpoch,
            });
          } finally {
            clearBytes(privateKey);
          }
        })();
  await retainWorkspaceKey(status, workspaceKey);
  return { status, workspaceKey };
}

async function unlockFromRecoveryFile(filePath: string): Promise<CliWorkspaceCryptoContext | null> {
  const status = await fetchWorkspaceCryptoStatus();
  if (!status) throw new Error('Unable to verify the workspace encryption state');
  if (!status.enabled) return null;
  const contents = await readFile(filePath, 'utf8');
  let workspaceKey: Uint8Array;
  if (status.role === 'owner') {
    const kit = parseRecoveryKit(contents);
    if (
      kit.workspaceOwnerId !== status.workspaceOwnerId ||
      kit.keyEpoch !== status.activeKeyEpoch
    ) {
      throw new Error('Recovery kit belongs to a different workspace or key epoch');
    }
    if (status.state === 'rotating') {
      throw new Error('Resume key rotation with the passphrase so both key epochs can unlock');
    }
    workspaceKey = recoverWorkspaceKey(kit);
  } else {
    const privateKey = recoverMemberPrivateKey(contents, {
      userId: status.memberId,
      keyVersion: status.memberIdentity.keyVersion,
    });
    try {
      workspaceKey = await openWorkspaceKeyGrant({
        grant: {
          ...status.grant,
          encapsulatedKey: base64ToBytes(status.grant.encapsulatedKey, 'HPKE encapsulated key'),
          ciphertext: base64ToBytes(status.grant.ciphertext, 'HPKE ciphertext'),
        },
        recipientPrivateKey: privateKey,
        workspaceOwnerId: status.workspaceOwnerId,
        memberId: status.memberId,
        keyEpoch: status.activeKeyEpoch,
      });
    } finally {
      clearBytes(privateKey);
    }
  }
  await retainWorkspaceKey(status, workspaceKey);
  return { status, workspaceKey };
}

export async function runUnlockCommand(args: string[] = []): Promise<number> {
  const recoveryIndex = args.indexOf('--recovery');
  const recoveryPath = recoveryIndex >= 0 ? args[recoveryIndex + 1] : undefined;
  if (recoveryIndex >= 0 && !recoveryPath) {
    console.error('[agendex] --recovery requires a recovery-kit path.');
    return 1;
  }
  const context = recoveryPath
    ? await unlockFromRecoveryFile(recoveryPath)
    : await getCliWorkspaceCryptoContext({ promptIfMissing: true });
  if (!context) {
    console.log('[agendex] This workspace does not use Obfuscation.');
    return 0;
  }
  const store = createSecretStore();
  console.log(
    (await store.available())
      ? `[agendex] Obfuscation unlocked with ${store.backend}.`
      : '[agendex] Obfuscation unlocked for this process only; no supported secure store is available.',
  );
  clearBytes(context.workspaceKey);
  return 0;
}

export async function runLockCommand(): Promise<number> {
  const status = await fetchWorkspaceCryptoStatus();
  if (!status?.enabled) {
    console.log('[agendex] This workspace does not use Obfuscation.');
    return 0;
  }
  const secretId = workspaceSecretKey(status.workspaceOwnerId, status.activeKeyEpoch);
  const session = sessionKeys.get(secretId);
  if (session) clearBytes(session);
  sessionKeys.delete(secretId);
  const store = createSecretStore();
  if (await store.available()) await store.delete(secretId);
  console.log('[agendex] Obfuscation locked.');
  return 0;
}
