import {
  clearBytes,
  base64ToBytes,
  bytesToBase64,
  computeRecoveryVerificationProof,
  createRecoveryKit,
  deriveWorkspaceKeys,
  generateWorkspaceKey,
  unwrapWorkspaceKeyWithPassphrase,
  wrapWorkspaceKeyWithPassphrase,
  type CryptoEnvelopeV1,
  type PassphraseWrappedKeyV1,
  type RecoveryKitV1,
  type WorkspaceDerivedKeys,
} from '@agendex/shared/crypto';
import {
  clearAllBrowserWorkspaceKeys,
  clearBrowserWorkspaceKey,
  loadBrowserWorkspaceKey,
  storeBrowserWorkspaceKey,
} from './browser-obfuscation-key-store';
import {
  clearDesktopObfuscationKey,
  isDesktop,
  loadDesktopObfuscationKey,
  storeDesktopObfuscationKey,
} from './desktop';

export type WorkspaceKeyringSnapshot =
  | { status: 'locked'; workspaceOwnerId: string; keyEpoch: number | null }
  | { status: 'unlocked'; workspaceOwnerId: string; keyEpoch: number };

type UnlockedWorkspace = {
  workspaceKey: Uint8Array;
  derivedKeys: WorkspaceDerivedKeys;
  snapshot: WorkspaceKeyringSnapshot;
};

const unlocked = new Map<string, UnlockedWorkspace>();
const snapshots = new Map<string, WorkspaceKeyringSnapshot>();
const listeners = new Set<() => void>();
const summaryCache = new Map<string, unknown>();
const persistenceMarkers = new Map<string, symbol>();
let kdfWarmup: Promise<void> | null = null;
let warmedKdfWorker: Worker | null = null;

function emit(): void {
  for (const listener of listeners) listener();
}

function lockedSnapshot(
  workspaceOwnerId: string,
  keyEpoch: number | null,
): WorkspaceKeyringSnapshot {
  const previous = snapshots.get(workspaceOwnerId);
  if (previous?.status === 'locked' && previous.keyEpoch === keyEpoch) return previous;
  const snapshot: WorkspaceKeyringSnapshot = { status: 'locked', workspaceOwnerId, keyEpoch };
  snapshots.set(workspaceOwnerId, snapshot);
  return snapshot;
}

export function prewarmObfuscationKdf(): Promise<void> {
  if (typeof Worker === 'undefined') return Promise.resolve();
  if (warmedKdfWorker) return Promise.resolve();
  if (kdfWarmup) return kdfWarmup;
  kdfWarmup = new Promise<void>((resolve) => {
    const worker = new Worker(new URL('./obfuscation-kdf.worker.ts', import.meta.url), {
      type: 'module',
    });
    const id = crypto.randomUUID();
    let finished = false;
    const finish = (ready: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      worker.onmessage = null;
      worker.onerror = null;
      if (ready) warmedKdfWorker = worker;
      else worker.terminate();
      resolve();
    };
    worker.onmessage = (event: MessageEvent<{ id: string; ok: boolean }>) => {
      if (event.data.id === id) finish(event.data.ok);
    };
    worker.onerror = () => finish(false);
    const timeout = setTimeout(() => finish(false), 15_000);
    worker.postMessage({ id, mode: 'warm' });
  });
  return kdfWarmup;
}

async function acquireKdfWorker(): Promise<Worker> {
  await prewarmObfuscationKdf();
  const worker = warmedKdfWorker;
  warmedKdfWorker = null;
  kdfWarmup = null;
  return (
    worker ??
    new Worker(new URL('./obfuscation-kdf.worker.ts', import.meta.url), {
      type: 'module',
    })
  );
}

export function subscribeWorkspaceKeyring(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getWorkspaceKeyringSnapshot(
  workspaceOwnerId: string,
  keyEpoch: number | null = null,
): WorkspaceKeyringSnapshot {
  return snapshots.get(workspaceOwnerId) ?? lockedSnapshot(workspaceOwnerId, keyEpoch);
}

export function unlockWorkspaceKey(
  workspaceOwnerId: string,
  keyEpoch: number,
  workspaceKey: Uint8Array,
  persistOnDesktop = true,
): void {
  lockWorkspaceKey(workspaceOwnerId, false, false);
  const retainedKey = workspaceKey.slice();
  const snapshot: WorkspaceKeyringSnapshot = {
    status: 'unlocked',
    workspaceOwnerId,
    keyEpoch,
  };
  unlocked.set(workspaceOwnerId, {
    workspaceKey: retainedKey,
    derivedKeys: deriveWorkspaceKeys(retainedKey),
    snapshot,
  });
  snapshots.set(workspaceOwnerId, snapshot);
  const persistenceMarker = Symbol(workspaceOwnerId);
  persistenceMarkers.set(workspaceOwnerId, persistenceMarker);
  if (persistOnDesktop) {
    if (isDesktop()) {
      void storeDesktopObfuscationKey(workspaceOwnerId, keyEpoch, bytesToBase64(retainedKey)).catch(
        () => {},
      );
    } else {
      const persistedCopy = retainedKey.slice();
      void storeBrowserWorkspaceKey(workspaceOwnerId, keyEpoch, persistedCopy)
        .then(async () => {
          if (persistenceMarkers.get(workspaceOwnerId) !== persistenceMarker) {
            await clearBrowserWorkspaceKey(workspaceOwnerId, keyEpoch);
          }
        })
        .finally(() => clearBytes(persistedCopy))
        .catch(() => {});
    }
  }
  emit();
}

export async function restoreWorkspaceKeyFromDesktop(
  workspaceOwnerId: string,
  keyEpoch: number,
): Promise<boolean> {
  if (unlocked.has(workspaceOwnerId)) return true;
  const stored = await loadDesktopObfuscationKey(workspaceOwnerId, keyEpoch);
  if (!stored) return false;
  const workspaceKey = base64ToBytes(stored, 'desktop workspace key');
  try {
    unlockWorkspaceKey(workspaceOwnerId, keyEpoch, workspaceKey, false);
    return true;
  } finally {
    clearBytes(workspaceKey);
  }
}

export async function restoreWorkspaceKeyFromDevice(
  workspaceOwnerId: string,
  keyEpoch: number,
): Promise<boolean> {
  if (isDesktop()) return restoreWorkspaceKeyFromDesktop(workspaceOwnerId, keyEpoch);
  if (unlocked.has(workspaceOwnerId)) return true;
  const workspaceKey = await loadBrowserWorkspaceKey(workspaceOwnerId, keyEpoch);
  if (!workspaceKey) return false;
  try {
    unlockWorkspaceKey(workspaceOwnerId, keyEpoch, workspaceKey, false);
    return true;
  } finally {
    clearBytes(workspaceKey);
  }
}

async function unwrapInWorker(args: {
  wrappedKey: PassphraseWrappedKeyV1;
  passphrase: string;
  workspaceOwnerId: string;
  keyEpoch: number;
}): Promise<Uint8Array> {
  if (typeof Worker === 'undefined') return unwrapWorkspaceKeyWithPassphrase(args);
  const worker = await acquireKdfWorker();
  const id = crypto.randomUUID();
  try {
    return await new Promise<Uint8Array>((resolve, reject) => {
      worker.onmessage = (
        event: MessageEvent<{
          id: string;
          ok: boolean;
          workspaceKey?: ArrayBuffer;
          error?: string;
        }>,
      ) => {
        if (event.data.id !== id) return;
        if (!event.data.ok || !event.data.workspaceKey) {
          reject(new Error(event.data.error ?? 'Unable to unlock Obfuscation'));
          return;
        }
        resolve(new Uint8Array(event.data.workspaceKey));
      };
      worker.onerror = () => reject(new Error('Obfuscation key worker failed'));
      worker.postMessage({ id, mode: 'unlock', ...args });
    });
  } finally {
    worker.terminate();
  }
}

export interface WorkspaceSetupMaterial {
  workspaceKey: Uint8Array;
  passphraseWrappedKey: PassphraseWrappedKeyV1;
  recoveryKit: RecoveryKitV1;
  recoveryEnvelope: CryptoEnvelopeV1;
  recoveryProofCommitment: string;
}

export async function createWorkspaceSetupMaterial(args: {
  passphrase: string;
  workspaceOwnerId: string;
  keyEpoch: number;
  signal?: AbortSignal;
}): Promise<WorkspaceSetupMaterial> {
  const cancelled = () => {
    const error = new Error('Obfuscation setup cancelled');
    error.name = 'AbortError';
    return error;
  };
  if (args.signal?.aborted) throw cancelled();
  const { signal, ...cryptoArgs } = args;
  if (typeof Worker === 'undefined') {
    const workspaceKey = generateWorkspaceKey();
    try {
      const passphraseWrappedKey = await wrapWorkspaceKeyWithPassphrase({
        ...cryptoArgs,
        workspaceKey,
      });
      if (signal?.aborted) throw cancelled();
      const { kit: recoveryKit, recoveryEnvelope } = createRecoveryKit({
        ...cryptoArgs,
        workspaceKey,
      });
      const { indexKey } = deriveWorkspaceKeys(workspaceKey);
      const recoveryProofCommitment = computeRecoveryVerificationProof(
        indexKey,
        args.workspaceOwnerId,
        args.keyEpoch,
      );
      clearBytes(indexKey);
      return {
        workspaceKey,
        passphraseWrappedKey,
        recoveryKit,
        recoveryEnvelope,
        recoveryProofCommitment,
      };
    } catch (error) {
      clearBytes(workspaceKey);
      throw error;
    }
  }

  const worker = await acquireKdfWorker();
  const id = crypto.randomUUID();
  let rejectOnAbort: (() => void) | undefined;
  const onAbort = () => {
    worker.terminate();
    rejectOnAbort?.();
  };
  try {
    return await new Promise<WorkspaceSetupMaterial>((resolve, reject) => {
      rejectOnAbort = () => reject(cancelled());
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      worker.onmessage = (
        event: MessageEvent<{
          id: string;
          ok: boolean;
          workspaceKey?: ArrayBuffer;
          passphraseWrappedKey?: PassphraseWrappedKeyV1;
          recoveryKit?: RecoveryKitV1;
          recoveryEnvelope?: CryptoEnvelopeV1;
          recoveryProofCommitment?: string;
          error?: string;
        }>,
      ) => {
        const result = event.data;
        if (result.id !== id) return;
        if (
          !result.ok ||
          !result.workspaceKey ||
          !result.passphraseWrappedKey ||
          !result.recoveryKit ||
          !result.recoveryEnvelope ||
          !result.recoveryProofCommitment
        ) {
          reject(new Error(result.error ?? 'Unable to prepare Obfuscation'));
          return;
        }
        resolve({
          workspaceKey: new Uint8Array(result.workspaceKey),
          passphraseWrappedKey: result.passphraseWrappedKey,
          recoveryKit: result.recoveryKit,
          recoveryEnvelope: result.recoveryEnvelope,
          recoveryProofCommitment: result.recoveryProofCommitment,
        });
      };
      worker.onerror = () => reject(new Error('Obfuscation key worker failed'));
      worker.postMessage({ id, mode: 'setup', ...cryptoArgs });
    });
  } finally {
    signal?.removeEventListener('abort', onAbort);
    worker.terminate();
  }
}

export async function unlockWorkspaceWithPassphrase(args: {
  wrappedKey: PassphraseWrappedKeyV1;
  passphrase: string;
  workspaceOwnerId: string;
  keyEpoch: number;
}): Promise<void> {
  const workspaceKey = await unwrapInWorker(args);
  try {
    unlockWorkspaceKey(args.workspaceOwnerId, args.keyEpoch, workspaceKey);
  } finally {
    clearBytes(workspaceKey);
  }
}

export function lockWorkspaceKey(
  workspaceOwnerId: string,
  notify = true,
  clearPersisted = true,
): void {
  const entry = unlocked.get(workspaceOwnerId);
  persistenceMarkers.set(workspaceOwnerId, Symbol(workspaceOwnerId));
  if (entry) {
    clearBytes(
      entry.workspaceKey,
      entry.derivedKeys.contentKey,
      entry.derivedKeys.indexKey,
      entry.derivedKeys.inviteKey,
    );
    unlocked.delete(workspaceOwnerId);
  }
  for (const cacheKey of summaryCache.keys()) {
    if (cacheKey.startsWith(`${workspaceOwnerId}:`)) summaryCache.delete(cacheKey);
  }
  lockedSnapshot(workspaceOwnerId, entry?.snapshot.keyEpoch ?? null);
  const keyEpoch = entry?.snapshot.keyEpoch;
  if (clearPersisted && typeof keyEpoch === 'number') {
    if (isDesktop()) void clearDesktopObfuscationKey(workspaceOwnerId, keyEpoch).catch(() => {});
    else void clearBrowserWorkspaceKey(workspaceOwnerId, keyEpoch).catch(() => {});
  }
  if (notify) emit();
}

export function lockAllWorkspaceKeys(): void {
  for (const workspaceOwnerId of unlocked.keys()) lockWorkspaceKey(workspaceOwnerId, false);
  summaryCache.clear();
  persistenceMarkers.clear();
  if (!isDesktop()) void clearAllBrowserWorkspaceKeys().catch(() => {});
  emit();
}

export function withWorkspaceKey<T>(
  workspaceOwnerId: string,
  operation: (workspaceKey: Uint8Array, derivedKeys: WorkspaceDerivedKeys) => T,
): T {
  const entry = unlocked.get(workspaceOwnerId);
  if (!entry) throw new Error('Obfuscation is locked');
  return operation(entry.workspaceKey, entry.derivedKeys);
}

export function getCachedDecryptedSummary<T>(workspaceOwnerId: string, key: string): T | undefined {
  return summaryCache.get(`${workspaceOwnerId}:${key}`) as T | undefined;
}

export function setCachedDecryptedSummary(
  workspaceOwnerId: string,
  key: string,
  value: unknown,
): void {
  summaryCache.set(`${workspaceOwnerId}:${key}`, value);
}
