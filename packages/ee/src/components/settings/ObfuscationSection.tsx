import {
  clearBytes,
  createRecoveryKit,
  openWorkspaceKeyGrant,
  parseRecoveryKit,
  recoverMemberPrivateKey,
  recoverWorkspaceKey,
  toBytes,
  unwrapMemberPrivateKeyWithPassphrase,
  unwrapWorkspaceKeyWithPassphrase,
  verifyRecoveryKit,
} from '@agendex/shared/crypto';
import { api } from '@convex/_generated/api';
import { useConvex, useMutation, useQuery } from 'convex/react';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useDaemonStatus } from '../../hooks/useDaemonStatus.ts';
import {
  createWorkspaceSetupMaterial,
  getWorkspaceKeyringSnapshot,
  lockWorkspaceKey,
  prewarmObfuscationKdf,
  restoreWorkspaceKeyFromDevice,
  subscribeWorkspaceKeyring,
  unlockWorkspaceKey,
  unlockWorkspaceWithPassphrase,
  withWorkspaceKey,
  type WorkspaceSetupMaterial,
} from '../../lib/obfuscation-keyring';
import { runWorkspaceSeal } from '../../lib/obfuscation-seal';

type SetupStep = 'consequences' | 'passphrase' | 'recovery' | 'confirm';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to update Obfuscation';
}

function downloadRecoveryKit(setup: WorkspaceSetupMaterial): void {
  const contents = `${JSON.stringify(setup.recoveryKit, null, 2)}\n`;
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `agendex-recovery-${setup.recoveryKit.workspaceOwnerId}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function SetupModal({
  email,
  workspaceOwnerId,
  onClose,
  onStarted,
}: {
  email: string;
  workspaceOwnerId: string;
  onClose: () => void;
  onStarted: () => void;
}) {
  const startWorkspaceSeal = useMutation(api.workspaceCrypto.startWorkspaceSeal);
  const [step, setStep] = useState<SetupStep>('consequences');
  const [passphrase, setPassphrase] = useState('');
  const [passphraseAgain, setPassphraseAgain] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [setup, setSetup] = useState<WorkspaceSetupMaterial | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [verified, setVerified] = useState(false);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    void prewarmObfuscationKdf();
  }, []);
  const [error, setError] = useState<string | null>(null);
  const setupAbort = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      setupAbort.current?.abort();
    },
    [],
  );

  useEffect(
    () => () => {
      if (setup) clearBytes(setup.workspaceKey);
    },
    [setup],
  );

  async function createSetup() {
    if (passphrase.length < 12) {
      setError('Use at least 12 characters. A longer unique phrase is safer.');
      return;
    }
    if (passphrase !== passphraseAgain) {
      setError('The passphrases do not match.');
      return;
    }
    setWorking(true);
    setError(null);
    const abortController = new AbortController();
    setupAbort.current?.abort();
    setupAbort.current = abortController;
    try {
      const material = await createWorkspaceSetupMaterial({
        passphrase,
        workspaceOwnerId,
        keyEpoch: 1,
        signal: abortController.signal,
      });
      setSetup(material);
      setPassphrase('');
      setPassphraseAgain('');
      setStep('recovery');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      if (setupAbort.current === abortController) setupAbort.current = null;
      setWorking(false);
    }
  }

  async function verifyRecoveryFile(file: File | undefined) {
    if (!file || !setup) return;
    setError(null);
    try {
      const kit = parseRecoveryKit(await file.text());
      if (kit.workspaceOwnerId !== workspaceOwnerId || kit.keyEpoch !== 1) {
        throw new Error('That recovery kit belongs to a different workspace');
      }
      if (!verifyRecoveryKit(kit, setup.workspaceKey)) {
        throw new Error('That recovery kit does not recover this workspace key');
      }
      setVerified(true);
    } catch (caught) {
      setVerified(false);
      setError(errorMessage(caught));
    }
  }

  async function startSeal() {
    if (!setup || confirmation !== email || !downloaded || !verified) return;
    setWorking(true);
    setError(null);
    try {
      await startWorkspaceSeal({
        confirmedEmail: confirmation,
        clientProtocol: 1,
        operationId: crypto.randomUUID(),
        leaseId: crypto.randomUUID(),
        ownerKdf: setup.passphraseWrappedKey.kdf,
        ownerPassphraseWrappedKey: setup.passphraseWrappedKey.envelope,
        ownerRecoveryWrappedKey: setup.recoveryEnvelope,
        recoveryProofCommitment: setup.recoveryProofCommitment,
      });
      unlockWorkspaceKey(workspaceOwnerId, 1, setup.workspaceKey);
      clearBytes(setup.workspaceKey);
      setSetup(null);
      onStarted();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setWorking(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[260] flex items-center justify-center bg-black/70 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="obfuscation-setup-title"
        className="w-full max-w-[580px] rounded-2xl border border-border bg-surface shadow-2xl"
      >
        <div className="flex items-start justify-between border-b border-border p-5">
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary">
              Step {['consequences', 'passphrase', 'recovery', 'confirm'].indexOf(step) + 1} of 4
            </div>
            <h2 id="obfuscation-setup-title" className="text-[20px] font-semibold text-text">
              Enable Obfuscation
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={working}
            className="rounded-lg px-2 py-1 text-secondary hover:bg-hover hover:text-text disabled:opacity-50"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="p-5">
          {step === 'consequences' && (
            <div className="space-y-4 text-[13px] leading-relaxed text-secondary">
              <p>
                Agendex servers cannot decrypt your obfuscated cloud content. Titles, bodies, paths,
                comments, tags, attachments, hostnames, and IP addresses are encrypted on your
                device.
              </p>
              <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-amber-200">
                This cannot be turned off. Cloud body search and share links stop working. Losing
                both your passphrase and recovery kit permanently loses access to the data.
              </div>
              <p>
                Agendex still sees account and billing records, membership, timestamps, agents,
                record counts, ciphertext sizes, and access patterns.
              </p>
              <button
                type="button"
                onClick={() => setStep('passphrase')}
                className="rounded-xl border-0 bg-[var(--primary)] px-4 py-2.5 text-[13px] font-semibold text-[var(--accent-contrast)]"
              >
                I understand the consequences
              </button>
            </div>
          )}

          {step === 'passphrase' && (
            <div className="space-y-4">
              <p className="text-[13px] leading-relaxed text-secondary">
                This passphrase is separate from GitHub or Google login. Agendex never receives it.
              </p>
              <label className="block text-[13px] text-secondary">
                Passphrase
                <input
                  type="password"
                  value={passphrase}
                  onChange={(event) => setPassphrase(event.target.value)}
                  autoComplete="new-password"
                  className="mt-2 w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-text outline-none focus:border-[var(--primary)]"
                />
              </label>
              <label className="block text-[13px] text-secondary">
                Confirm passphrase
                <input
                  type="password"
                  value={passphraseAgain}
                  onChange={(event) => setPassphraseAgain(event.target.value)}
                  autoComplete="new-password"
                  className="mt-2 w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-text outline-none focus:border-[var(--primary)]"
                />
              </label>
              <button
                type="button"
                disabled={working}
                onClick={() => void createSetup()}
                className="rounded-xl border-0 bg-[var(--primary)] px-4 py-2.5 text-[13px] font-semibold text-[var(--accent-contrast)] disabled:opacity-50"
              >
                {working ? 'Deriving key…' : 'Create recovery kit'}
              </button>
            </div>
          )}

          {step === 'recovery' && setup && (
            <div className="space-y-4">
              <p className="text-[13px] leading-relaxed text-secondary">
                Download the kit, keep it somewhere separate from this device, then import the same
                file to prove it works. Agendex cannot recreate its recovery secret.
              </p>
              <button
                type="button"
                onClick={() => {
                  downloadRecoveryKit(setup);
                  setDownloaded(true);
                }}
                className="rounded-xl border border-border bg-hover px-4 py-2.5 text-[13px] font-semibold text-text"
              >
                {downloaded ? 'Download recovery kit again' : 'Download recovery kit'}
              </button>
              <label className="block text-[13px] text-secondary">
                Verify downloaded kit
                <input
                  type="file"
                  accept="application/json,.json"
                  disabled={!downloaded}
                  onChange={(event) => void verifyRecoveryFile(event.target.files?.[0])}
                  className="mt-2 block w-full text-[12px] text-secondary file:mr-3 file:rounded-lg file:border file:border-border file:bg-hover file:px-3 file:py-2 file:text-text"
                />
              </label>
              {verified && <div className="text-[13px] text-emerald-400">Recovery verified.</div>}
              <button
                type="button"
                disabled={!downloaded || !verified}
                onClick={() => setStep('confirm')}
                className="rounded-xl border-0 bg-[var(--primary)] px-4 py-2.5 text-[13px] font-semibold text-[var(--accent-contrast)] disabled:opacity-40"
              >
                Continue
              </button>
            </div>
          )}

          {step === 'confirm' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-[13px] leading-relaxed text-red-200">
                Starting now blocks share links and plaintext writes immediately. Existing cloud
                records will be sealed in resumable batches. This action cannot be reverted.
              </div>
              <label className="block text-[13px] text-secondary">
                Type <span className="font-medium text-text">{email}</span> to confirm
                <input
                  type="text"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-text outline-none focus:border-red-400"
                />
              </label>
              <button
                type="button"
                disabled={working || confirmation !== email}
                onClick={() => void startSeal()}
                className="rounded-xl border-0 bg-red-500 px-4 py-2.5 text-[13px] font-semibold text-white disabled:opacity-40"
              >
                {working ? 'Starting…' : 'Enable permanently and start sealing'}
              </button>
            </div>
          )}

          {error && (
            <div className="mt-4 text-[12px] text-red-400" role="alert">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function ObfuscationSection({ email }: { email: string }) {
  const convex = useConvex();
  const status = useQuery(api.workspaceCrypto.getWorkspaceCryptoStatus, {});
  const memberMaterial = useQuery(
    api.workspaceMembers.getMemberCryptoUnlockMaterial,
    status?.role === 'member' ? {} : 'skip',
  );
  const [showSetup, setShowSetup] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rotationSourceKey, setRotationSourceKey] = useState<Uint8Array | null>(null);
  const daemonStatus = useDaemonStatus();
  const workspaceOwnerId = status?.workspaceOwnerId ?? '';
  const keyEpoch = status?.settings?.activeKeyEpoch ?? null;
  const keyring = useSyncExternalStore(
    subscribeWorkspaceKeyring,
    () => getWorkspaceKeyringSnapshot(workspaceOwnerId, keyEpoch),
    () => getWorkspaceKeyringSnapshot(workspaceOwnerId, keyEpoch),
  );

  const blockerText = useMemo(() => {
    if (!status?.blockers) return null;
    if (status.blockers.hasMembers) return 'Remove workspace members before enabling.';
    if (status.blockers.hasPendingInvites) return 'Revoke pending invitations before enabling.';
    return null;
  }, [status?.blockers]);

  const daemonUnlockSummary = useMemo(() => {
    if (daemonStatus.devices.length === 0) return 'no active daemon';
    const unlocked = daemonStatus.devices.filter((device) => device.cryptoUnlocked).length;
    const locked = daemonStatus.devices.filter((device) => device.cryptoUnlocked === false).length;
    const unknown = daemonStatus.devices.length - unlocked - locked;
    return [
      `${unlocked} unlocked`,
      `${locked} locked`,
      ...(unknown ? [`${unknown} unknown`] : []),
    ].join(' · ');
  }, [daemonStatus.devices]);

  useEffect(() => {
    const operation = status?.settings?.operation;
    if (
      !operation ||
      !['sealing', 'rotating', 'failed'].includes(status.settings?.state ?? '') ||
      keyring.status !== 'unlocked' ||
      operation.phase === 'audit'
    ) {
      return;
    }
    if (operation.kind === 'rotate' && !rotationSourceKey) return;
    const abortController = new AbortController();
    void runWorkspaceSeal({
      convex,
      workspaceOwnerId,
      keyEpoch: status.settings?.activeKeyEpoch ?? 1,
      operation,
      sourceWorkspaceKey:
        operation.kind === 'rotate' ? (rotationSourceKey ?? undefined) : undefined,
      signal: abortController.signal,
    }).catch((caught) => {
      if (!abortController.signal.aborted) setError(errorMessage(caught));
    });
    return () => abortController.abort();
  }, [convex, keyring.status, rotationSourceKey, status?.settings, workspaceOwnerId]);

  useEffect(() => {
    if (status?.settings?.operation || !rotationSourceKey) return;
    clearBytes(rotationSourceKey);
    setRotationSourceKey(null);
  }, [rotationSourceKey, status?.settings?.operation]);

  useEffect(() => {
    if (keyring.status !== 'locked' || !workspaceOwnerId || keyEpoch === null) return;
    void restoreWorkspaceKeyFromDevice(workspaceOwnerId, keyEpoch).catch(() => {});
  }, [keyEpoch, keyring.status, workspaceOwnerId]);

  useEffect(() => {
    if (status?.settings && keyring.status === 'locked') void prewarmObfuscationKdf();
  }, [keyring.status, status?.settings]);

  if (status === undefined || status === null || !status.visible) return null;

  const settings = status.settings;
  const role = status.role;
  const enabled = settings !== null;
  const canUnlock =
    status.role === 'owner' && settings?.ownerKdf && settings.ownerPassphraseWrappedKey;

  async function unlock() {
    if (!canUnlock || !settings?.ownerKdf || !settings.ownerPassphraseWrappedKey) return;
    const ownerKdf = settings.ownerKdf;
    const ownerPassphraseWrappedKey = settings.ownerPassphraseWrappedKey;
    let previousKey: Uint8Array | null = null;
    setUnlocking(true);
    setError(null);
    try {
      if (
        settings.state === 'rotating' &&
        settings.previousKeyEpoch &&
        settings.previousOwnerKdf &&
        settings.previousOwnerPassphraseWrappedKey
      ) {
        previousKey = await unwrapWorkspaceKeyWithPassphrase({
          wrappedKey: {
            v: 1,
            kdf: settings.previousOwnerKdf,
            envelope: settings.previousOwnerPassphraseWrappedKey,
          },
          passphrase,
          workspaceOwnerId,
          keyEpoch: settings.previousKeyEpoch,
        });
      }
      await unlockWorkspaceWithPassphrase({
        wrappedKey: {
          v: 1,
          kdf: ownerKdf,
          envelope: ownerPassphraseWrappedKey,
        },
        passphrase,
        workspaceOwnerId,
        keyEpoch: settings.activeKeyEpoch,
      });
      if (previousKey) {
        setRotationSourceKey(previousKey);
        previousKey = null;
      }
    } catch {
      if (previousKey) clearBytes(previousKey);
      setError('Unable to unlock. Check the passphrase and try again.');
    } finally {
      setPassphrase('');
      setUnlocking(false);
    }
  }

  async function unlockMember() {
    if (!memberMaterial) return;
    setUnlocking(true);
    setError(null);
    try {
      const privateKey = await unwrapMemberPrivateKeyWithPassphrase({
        encryptedPrivateKey: memberMaterial.identity.encryptedPrivateKey,
        kdf: memberMaterial.identity.kdf,
        passphrase,
        userId: memberMaterial.memberId,
        keyVersion: memberMaterial.identity.keyVersion,
      });
      try {
        await unlockMemberWithPrivateKey(privateKey);
      } finally {
        clearBytes(privateKey);
      }
    } catch {
      setError('Unable to unlock. Check the member passphrase and try again.');
    } finally {
      setPassphrase('');
      setUnlocking(false);
    }
  }

  async function unlockMemberWithPrivateKey(privateKey: Uint8Array) {
    if (!memberMaterial) throw new Error('Member key material is unavailable');
    const workspaceKey = await openWorkspaceKeyGrant({
      grant: {
        ...memberMaterial.grant,
        encapsulatedKey: toBytes(memberMaterial.grant.encapsulatedKey),
        ciphertext: toBytes(memberMaterial.grant.ciphertext),
      },
      recipientPrivateKey: privateKey,
      workspaceOwnerId: memberMaterial.workspaceOwnerId,
      memberId: memberMaterial.memberId,
      keyEpoch: memberMaterial.activeKeyEpoch,
    });
    try {
      unlockWorkspaceKey(
        memberMaterial.workspaceOwnerId,
        memberMaterial.activeKeyEpoch,
        workspaceKey,
      );
    } finally {
      clearBytes(workspaceKey);
    }
  }

  async function recoverFromKit(file: File | undefined) {
    if (!file || !settings) return;
    setUnlocking(true);
    setError(null);
    try {
      const contents = await file.text();
      if (role === 'member') {
        if (!memberMaterial) throw new Error('Member key material is unavailable');
        const privateKey = recoverMemberPrivateKey(contents, {
          userId: memberMaterial.memberId,
          keyVersion: memberMaterial.identity.keyVersion,
        });
        try {
          await unlockMemberWithPrivateKey(privateKey);
        } finally {
          clearBytes(privateKey);
        }
      } else {
        if (settings.state === 'rotating') {
          throw new Error('Resume key rotation with the passphrase so both key epochs can unlock.');
        }
        const kit = parseRecoveryKit(contents);
        if (kit.workspaceOwnerId !== workspaceOwnerId || kit.keyEpoch !== settings.activeKeyEpoch) {
          throw new Error('Recovery kit belongs to a different workspace or key epoch');
        }
        const workspaceKey = recoverWorkspaceKey(kit);
        try {
          unlockWorkspaceKey(workspaceOwnerId, settings.activeKeyEpoch, workspaceKey);
        } finally {
          clearBytes(workspaceKey);
        }
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setUnlocking(false);
    }
  }

  function downloadFreshRecoveryKit() {
    if (!settings || role !== 'owner') return;
    try {
      const kit = withWorkspaceKey(workspaceOwnerId, (workspaceKey) =>
        createRecoveryKit({
          workspaceKey,
          workspaceOwnerId,
          keyEpoch: settings.activeKeyEpoch,
        }),
      ).kit;
      const url = URL.createObjectURL(
        new Blob([`${JSON.stringify(kit, null, 2)}\n`], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `agendex-recovery-epoch-${settings.activeKeyEpoch}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <section>
      <div className="mb-4 flex items-baseline gap-3">
        <h2 className="text-[20px] font-semibold text-text">Obfuscation</h2>
        <span className="text-[12px] text-tertiary">Zero-knowledge encryption</span>
      </div>
      <div className="rounded-2xl border border-border bg-surface p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="text-[14px] font-medium text-text">
              {enabled ? 'Cloud content is obfuscated' : 'Agendex cannot read your cloud data'}
            </div>
            <p className="mt-1 max-w-[680px] text-[13px] leading-relaxed text-secondary">
              {status.role === 'member'
                ? 'This workspace encrypts cloud data. The owner enabled this and it cannot be turned off.'
                : enabled
                  ? 'Encryption is permanent. Keep your recovery kit safe; Agendex cannot replace it.'
                  : 'Encrypt cloud content on your devices before it reaches Convex. Enabling is permanent and disables body search and share links.'}
            </p>
            {settings?.enabledAt && (
              <div className="mt-2 text-[12px] text-tertiary">
                Enabled {new Date(settings.enabledAt).toLocaleDateString()} · epoch{' '}
                {settings.activeKeyEpoch} · Cannot be reverted
              </div>
            )}
            {enabled && (
              <div className="mt-2 text-[12px] text-tertiary">
                Daemon unlock: {daemonUnlockSummary}
              </div>
            )}
            {settings?.operation && (
              <div className="mt-3 rounded-lg border border-border bg-hover px-3 py-2 text-[12px] text-secondary">
                {settings.state === 'rotating' ? 'Rotating keys' : 'Sealing existing data'} ·{' '}
                {settings.operation.phase} · {settings.operation.processed} processed
              </div>
            )}
            {blockerText && <div className="mt-2 text-[12px] text-amber-300">{blockerText}</div>}
            {error && (
              <div className="mt-2 text-[12px] text-red-400" role="alert">
                {error}
              </div>
            )}
          </div>

          {status.role === 'owner' && !enabled && (
            <button
              type="button"
              disabled={Boolean(blockerText)}
              onClick={() => setShowSetup(true)}
              className="shrink-0 rounded-xl border border-border bg-transparent px-3.5 py-2 text-[13px] font-semibold text-text hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              Enable Obfuscation
            </button>
          )}

          {enabled && keyring.status === 'unlocked' && (
            <div className="flex shrink-0 flex-wrap gap-2">
              {status.role === 'owner' && (
                <button
                  type="button"
                  onClick={downloadFreshRecoveryKit}
                  className="rounded-xl border border-border bg-transparent px-3.5 py-2 text-[13px] font-semibold text-text hover:bg-hover"
                >
                  New recovery kit
                </button>
              )}
              <button
                type="button"
                onClick={() => lockWorkspaceKey(workspaceOwnerId)}
                className="rounded-xl border border-border bg-transparent px-3.5 py-2 text-[13px] font-semibold text-text hover:bg-hover"
              >
                Lock
              </button>
            </div>
          )}
        </div>

        {enabled &&
          keyring.status === 'locked' &&
          ((status.role === 'owner' && canUnlock) ||
            (status.role === 'member' && memberMaterial)) && (
            <div className="mt-4 max-w-[520px]">
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="password"
                  value={passphrase}
                  onChange={(event) => setPassphrase(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter')
                      void (status.role === 'member' ? unlockMember() : unlock());
                  }}
                  placeholder="Obfuscation passphrase"
                  autoComplete="current-password"
                  className="min-w-0 flex-1 rounded-xl border border-border bg-bg px-3 py-2 text-[13px] text-text outline-none focus:border-[var(--primary)]"
                />
                <button
                  type="button"
                  disabled={unlocking || passphrase.length === 0}
                  onClick={() => void (status.role === 'member' ? unlockMember() : unlock())}
                  className="rounded-xl border-0 bg-[var(--primary)] px-4 py-2 text-[13px] font-semibold text-[var(--accent-contrast)] disabled:opacity-40"
                >
                  {unlocking ? 'Unlocking…' : 'Unlock'}
                </button>
              </div>
              <label className="mt-2 inline-flex cursor-pointer text-[12px] font-medium text-secondary hover:text-text">
                Use a recovery kit
                <input
                  type="file"
                  accept="application/json,.json"
                  className="sr-only"
                  disabled={unlocking}
                  onChange={(event) => {
                    void recoverFromKit(event.target.files?.[0]);
                    event.target.value = '';
                  }}
                />
              </label>
            </div>
          )}
      </div>

      {showSetup && (
        <SetupModal
          email={email}
          workspaceOwnerId={workspaceOwnerId}
          onClose={() => setShowSetup(false)}
          onStarted={() => setShowSetup(false)}
        />
      )}
    </section>
  );
}
