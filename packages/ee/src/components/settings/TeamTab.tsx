import { api } from '@convex/_generated/api';
import {
  clearBytes,
  equalBytes,
  openBytes,
  sealWorkspaceKeyGrant,
  toBytes,
  verifyRecoveryKit,
  verifyInviteEnrollmentProof,
  unwrapWorkspaceKeyWithPassphrase,
} from '@agendex/shared/crypto';
import type { Id } from '@convex/_generated/dataModel';
import { useConvex, useMutation, useQuery } from 'convex/react';
import { useState } from 'react';
import { InviteWorkspaceMemberDialog } from '../InviteWorkspaceMemberDialog';
import { useWorkspaceCryptoStatus } from '../../hooks/useCloudMetadataCrypto.ts';
import {
  createWorkspaceSetupMaterial,
  unlockWorkspaceKey,
  withWorkspaceKey,
} from '../../lib/obfuscation-keyring.ts';
import { runWorkspaceSeal } from '../../lib/obfuscation-seal.ts';
import { PRIMARY_CONTRAST_FALLBACK } from './constants';

function SeatMeter({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  const isNearLimit = used >= total - 1 && used < total;
  const isFull = used >= total;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] text-secondary">
          <span className="text-text font-semibold">{used}</span> of {total} seats used
        </span>
        {isFull && (
          <span className="text-[11px] font-medium text-[var(--danger)]">No seats remaining</span>
        )}
        {isNearLimit && (
          <span className="text-[11px] font-medium text-[var(--warning)]">1 seat remaining</span>
        )}
      </div>
      <div className="h-1.5 rounded-full bg-hover overflow-hidden">
        <div
          className="h-full w-full origin-left rounded-full transition-transform duration-500 ease-out"
          style={{
            transform: `scaleX(${pct / 100})`,
            background: isFull
              ? 'var(--danger)'
              : isNearLimit
                ? 'var(--warning)'
                : 'var(--primary)',
          }}
        />
      </div>
    </div>
  );
}

function MemberRow({
  email,
  memberRole,
  detail,
  isPending,
  onAction,
  actionLabel,
  actionDanger,
}: {
  email: string;
  memberRole: string;
  detail?: string;
  isPending?: boolean;
  onAction: () => void;
  actionLabel: string;
  actionDanger?: boolean;
}) {
  const initial = email.charAt(0).toUpperCase();

  return (
    <div className="group flex items-center gap-3 py-3 px-4 rounded-xl transition-colors duration-150 hover:bg-hover/50">
      <div
        className="size-9 rounded-full flex items-center justify-center text-[13px] font-semibold shrink-0"
        style={{
          background: isPending ? 'var(--hover)' : 'rgba(var(--primary-rgb, 139, 92, 246), 0.12)',
          color: isPending ? 'var(--tertiary)' : 'var(--primary)',
          border: isPending ? '1px dashed var(--border)' : 'none',
        }}
      >
        {isPending ? '?' : initial}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-text truncate">{email}</span>
          {isPending && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[var(--warning)]/15 text-[var(--warning)]">
              Pending
            </span>
          )}
        </div>
        <div className="text-[12px] text-tertiary mt-0.5">
          {memberRole}
          {detail ? ` · ${detail}` : ''}
        </div>
      </div>

      <button
        type="button"
        onClick={onAction}
        className={[
          'text-[12px] px-3 py-1.5 rounded-lg border bg-transparent cursor-pointer font-medium transition-[opacity,background-color,color,border-color] duration-150 opacity-0 group-hover:opacity-100 focus:opacity-100 shrink-0',
          actionDanger
            ? 'border-[var(--danger)]/30 text-[var(--danger)] hover:bg-[var(--danger)]/10'
            : 'border-border text-secondary hover:text-text hover:bg-hover',
        ].join(' ')}
      >
        {actionLabel}
      </button>
    </div>
  );
}

interface TeamTabProps {
  isActive: boolean;
}

export function TeamTab({ isActive }: TeamTabProps) {
  const [showInvite, setShowInvite] = useState(false);
  const [rotatingMemberId, setRotatingMemberId] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const convex = useConvex();
  const cryptoStatus = useWorkspaceCryptoStatus(isActive);

  const workspace = useQuery(api.workspaceMembers.listWorkspaceMembers, isActive ? {} : 'skip');
  const removeMember = useMutation(api.workspaceMembers.removeWorkspaceMember);
  const revokeInvite = useMutation(api.workspaceMembers.revokeWorkspaceInvite);
  const approveInvite = useMutation(api.workspaceMembers.approveEncryptedWorkspaceInvite);
  const startRotation = useMutation(api.workspaceCrypto.startWorkspaceRotation);

  async function removeMemberWithRotation(membershipId: Id<'workspaceMembers'>) {
    if (!cryptoStatus?.settings) {
      await removeMember({ membershipId });
      return;
    }
    if (
      !window.confirm(
        'Removing this member revokes access and rotates every cloud encryption key. Previously copied data cannot be revoked. Continue?',
      )
    ) {
      return;
    }
    const passphrase = window.prompt(
      'Enter the current Obfuscation passphrase. It will also protect the rotated key:',
    );
    if (!passphrase || passphrase.length < 12) return;
    setRotatingMemberId(membershipId);
    setOperationError(null);
    let oldWorkspaceKey: Uint8Array | undefined;
    let setup: Awaited<ReturnType<typeof createWorkspaceSetupMaterial>> | undefined;
    try {
      oldWorkspaceKey = withWorkspaceKey(cryptoStatus.workspaceOwnerId, (workspaceKey) =>
        workspaceKey.slice(),
      );
      if (!cryptoStatus.settings.ownerKdf || !cryptoStatus.settings.ownerPassphraseWrappedKey) {
        throw new Error('Owner key wrapper is unavailable');
      }
      const verifiedOldKey = await unwrapWorkspaceKeyWithPassphrase({
        wrappedKey: {
          v: 1,
          kdf: cryptoStatus.settings.ownerKdf,
          envelope: cryptoStatus.settings.ownerPassphraseWrappedKey,
        },
        passphrase,
        workspaceOwnerId: cryptoStatus.workspaceOwnerId,
        keyEpoch: cryptoStatus.settings.activeKeyEpoch,
      });
      const passphraseMatches = equalBytes(verifiedOldKey, oldWorkspaceKey);
      clearBytes(verifiedOldKey);
      if (!passphraseMatches) throw new Error('The Obfuscation passphrase is incorrect');
      const nextEpoch = cryptoStatus.settings.activeKeyEpoch + 1;
      setup = await createWorkspaceSetupMaterial({
        passphrase,
        workspaceOwnerId: cryptoStatus.workspaceOwnerId,
        keyEpoch: nextEpoch,
      });
      const recipients = await convex.query(api.workspaceMembers.getRotationRecipients, {
        membershipId,
      });
      const retainedSetup = setup;
      const grants = await Promise.all(
        recipients.map(async (recipient) => ({
          memberId: recipient.memberId,
          ...(await sealWorkspaceKeyGrant({
            workspaceKey: retainedSetup.workspaceKey,
            recipientPublicKey: toBytes(recipient.publicKey),
            workspaceOwnerId: cryptoStatus.workspaceOwnerId,
            memberId: recipient.memberId,
            keyEpoch: nextEpoch,
          })),
        })),
      );
      const recoveryContents = `${JSON.stringify(setup.recoveryKit, null, 2)}\n`;
      const recoveryUrl = URL.createObjectURL(
        new Blob([recoveryContents], { type: 'application/json' }),
      );
      const recoveryLink = document.createElement('a');
      recoveryLink.href = recoveryUrl;
      recoveryLink.download = `agendex-recovery-epoch-${nextEpoch}.json`;
      recoveryLink.click();
      URL.revokeObjectURL(recoveryUrl);
      const recoveryFile = await new Promise<File | null>((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json,.json';
        input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
        input.addEventListener('cancel', () => resolve(null), { once: true });
        input.click();
      });
      if (!recoveryFile) throw new Error('Rotation cancelled before recovery-kit verification');
      if (!verifyRecoveryKit(await recoveryFile.text(), setup.workspaceKey)) {
        throw new Error('The selected recovery kit does not match the rotated key');
      }
      const operationId = crypto.randomUUID();
      const leaseId = crypto.randomUUID();
      await startRotation({
        membershipId,
        clientProtocol: 1,
        operationId,
        leaseId,
        ownerKdf: setup.passphraseWrappedKey.kdf,
        ownerPassphraseWrappedKey: setup.passphraseWrappedKey.envelope,
        ownerRecoveryWrappedKey: setup.recoveryEnvelope,
        recoveryProofCommitment: setup.recoveryProofCommitment,
        grants: grants.map((grant) => ({
          ...grant,
          encapsulatedKey: grant.encapsulatedKey.buffer as ArrayBuffer,
          ciphertext: grant.ciphertext.buffer as ArrayBuffer,
        })),
      });
      unlockWorkspaceKey(cryptoStatus.workspaceOwnerId, nextEpoch, setup.workspaceKey);
      await runWorkspaceSeal({
        convex,
        workspaceOwnerId: cryptoStatus.workspaceOwnerId,
        keyEpoch: nextEpoch,
        sourceWorkspaceKey: oldWorkspaceKey,
        operation: { id: operationId, phase: 'plans', processed: 0, leaseId },
      });
    } catch (caught) {
      setOperationError(
        caught instanceof Error ? caught.message : 'Unable to rotate workspace key',
      );
    } finally {
      if (oldWorkspaceKey) clearBytes(oldWorkspaceKey);
      if (setup) clearBytes(setup.workspaceKey);
      setRotatingMemberId(null);
    }
  }

  async function approveEncryptedInvite(invite: {
    _id: string;
    token: string;
    pendingMemberId?: string;
    memberPublicKey?: ArrayBuffer;
    enrollmentProof?: string;
    encryptedInviteSecret?: unknown;
  }) {
    setOperationError(null);
    if (
      !cryptoStatus?.settings ||
      !invite.pendingMemberId ||
      !invite.memberPublicKey ||
      !invite.enrollmentProof ||
      !invite.encryptedInviteSecret
    ) {
      return;
    }
    const workspaceOwnerId = cryptoStatus.workspaceOwnerId;
    const keyEpoch = cryptoStatus.settings.activeKeyEpoch;
    const pendingMemberId = invite.pendingMemberId;
    const memberPublicKey = invite.memberPublicKey;
    const enrollmentProof = invite.enrollmentProof;
    const encryptedInviteSecret = invite.encryptedInviteSecret;
    try {
      await withWorkspaceKey(workspaceOwnerId, async (workspaceKey, derivedKeys) => {
        const retainedWorkspaceKey = workspaceKey.slice();
        const inviteSecret = openBytes(derivedKeys.inviteKey, encryptedInviteSecret, {
          workspaceOwnerId,
          table: 'workspaceInvitations',
          stableCryptoId: invite.token,
          slot: 'invite-secret',
          keyEpoch,
        });
        const publicKey = toBytes(memberPublicKey, 'member public key');
        try {
          if (
            !verifyInviteEnrollmentProof({
              inviteSecret,
              token: invite.token,
              userId: pendingMemberId,
              publicKey,
              proof: enrollmentProof,
            })
          ) {
            throw new Error('Member enrollment proof does not match this invite');
          }
          const grant = await sealWorkspaceKeyGrant({
            workspaceKey: retainedWorkspaceKey,
            recipientPublicKey: publicKey,
            workspaceOwnerId,
            memberId: pendingMemberId,
            keyEpoch,
          });
          await approveInvite({
            inviteId: invite._id as Id<'workspaceInvites'>,
            keyEpoch,
            ...grant,
            encapsulatedKey: grant.encapsulatedKey.buffer as ArrayBuffer,
            ciphertext: grant.ciphertext.buffer as ArrayBuffer,
          });
        } finally {
          clearBytes(retainedWorkspaceKey, inviteSecret);
        }
      });
    } catch (caught) {
      setOperationError(caught instanceof Error ? caught.message : 'Unable to approve member');
    }
  }

  if (!isActive) {
    return (
      <div className="space-y-6">
        <div className="rounded-2xl border border-border bg-surface p-8 text-center">
          <div className="mx-auto mb-4 size-12 rounded-xl bg-hover flex items-center justify-center">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-tertiary"
              aria-hidden="true"
            >
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <h3 className="text-[14px] font-semibold text-text mb-1.5">
            Team members require a Pro plan
          </h3>
          <p className="text-[13px] text-secondary max-w-[320px] mx-auto leading-relaxed">
            Upgrade to invite up to 5 members with read-only access to your synced plans.
          </p>
        </div>
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="space-y-6">
        <div className="rounded-2xl border border-border bg-surface p-6">
          <div className="flex flex-col gap-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 py-3 px-4 animate-pulse">
                <div className="size-9 rounded-full bg-hover" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-40 rounded bg-hover" />
                  <div className="h-3 w-24 rounded bg-hover" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const memberCount = workspace.members.length;
  const pendingCount = workspace.pendingInvites.length;
  const hasMembers = memberCount > 0 || pendingCount > 0;

  return (
    <div className="space-y-6">
      {operationError && (
        <div
          className="rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-4 py-3 text-[13px] text-[var(--danger)]"
          role="alert"
        >
          {operationError}
        </div>
      )}
      {/* Header row with seat meter and invite button */}
      <div className="flex items-end justify-between gap-4">
        <div className="flex-1 max-w-xs">
          <SeatMeter used={workspace.usedSeats} total={workspace.seatLimit} />
        </div>
        {workspace.remainingSeats > 0 && workspace.teamEnrollmentAvailable && (
          <button
            type="button"
            onClick={() => setShowInvite(true)}
            className="flex items-center gap-1.5 text-[13px] px-4 py-2 rounded-xl border-none cursor-pointer font-semibold transition-opacity duration-150 hover:opacity-90 shrink-0"
            style={{
              background: 'var(--primary)',
              color: `var(--accent-contrast, ${PRIMARY_CONTRAST_FALLBACK})`,
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            Invite member
          </button>
        )}
        {!workspace.teamEnrollmentAvailable && (
          <span className="text-[12px] text-tertiary">Encrypted team enrollment is in canary.</span>
        )}
      </div>

      {/* Members list */}
      <div className="rounded-2xl border border-border bg-surface overflow-hidden">
        {hasMembers ? (
          <div className="divide-y divide-border/50">
            {/* Active members first */}
            {workspace.members.map((member: { _id: string; email: string; addedAt: number }) => (
              <MemberRow
                key={member._id}
                email={member.email}
                memberRole="Member"
                detail={`Joined ${new Date(member.addedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}
                onAction={() => void removeMemberWithRotation(member._id as Id<'workspaceMembers'>)}
                actionLabel={rotatingMemberId === member._id ? 'Rotating…' : 'Remove'}
                actionDanger
              />
            ))}

            {/* Pending invites */}
            {workspace.pendingInvites.map(
              (invite: {
                _id: string;
                email: string;
                createdAt: number;
                token: string;
                pendingMemberId?: string;
                memberPublicKey?: ArrayBuffer;
                enrollmentProof?: string;
                encryptedInviteSecret?: unknown;
              }) => (
                <MemberRow
                  key={invite._id}
                  email={invite.email}
                  memberRole="Invited"
                  detail={`Sent ${new Date(invite.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}
                  isPending
                  onAction={() =>
                    invite.pendingMemberId
                      ? void approveEncryptedInvite(invite)
                      : revokeInvite({ inviteId: invite._id as Id<'workspaceInvites'> })
                  }
                  actionLabel={invite.pendingMemberId ? 'Approve' : 'Revoke'}
                />
              ),
            )}
          </div>
        ) : (
          <div className="p-8 text-center">
            <div className="mx-auto mb-3 size-10 rounded-lg bg-hover flex items-center justify-center">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-tertiary"
                aria-hidden="true"
              >
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <line x1="19" x2="19" y1="8" y2="14" />
                <line x1="22" x2="16" y1="11" y2="11" />
              </svg>
            </div>
            <p className="text-[13px] text-secondary leading-relaxed">
              No team members yet. Invite collaborators to give them
              <br />
              read-only access to your synced plans.
            </p>
          </div>
        )}
      </div>

      {showInvite && <InviteWorkspaceMemberDialog onClose={() => setShowInvite(false)} />}
    </div>
  );
}
