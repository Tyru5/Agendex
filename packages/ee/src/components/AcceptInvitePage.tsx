import { startViewTransition } from '@agendex/web';
import {
  base64UrlToBytes,
  createMemberRecoveryKit,
  createInviteEnrollmentProof,
  generateMemberIdentityKeyPair,
  wrapMemberPrivateKey,
} from '@agendex/shared/crypto';
import { api } from '@convex/_generated/api';
import { useMutation, useQuery } from 'convex/react';
import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '../hooks/useAuth';
import { PRIMARY_CONTRAST_FALLBACK } from './settings/constants';

const DASHBOARD_PATH = '/dashboard';

export function AcceptInvitePage({ token }: { token: string }) {
  const { user, isAuthenticated, isLoading: authLoading, signIn } = useAuth();
  const [, navigate] = useLocation();
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [pendingCryptoArgs, setPendingCryptoArgs] = useState<Record<string, unknown> | null>(null);
  const [recoveryChecksum, setRecoveryChecksum] = useState<string | null>(null);
  const [recoveryVerified, setRecoveryVerified] = useState(false);
  const [enrollmentSubmitted, setEnrollmentSubmitted] = useState(false);

  const storageKey = `agendex:invite-secret:${token}`;
  const fragmentSecret = new URLSearchParams(window.location.hash.slice(1)).get('k');
  const inviteSecret = fragmentSecret ?? sessionStorage.getItem(storageKey);
  useEffect(() => {
    if (!fragmentSecret) return;
    sessionStorage.setItem(storageKey, fragmentSecret);
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  }, [fragmentSecret, storageKey]);

  const invite = useQuery(api.workspaceMembers.getWorkspaceInviteByToken, { token });
  useEffect(() => {
    if (invite && invite.status !== 'valid') sessionStorage.removeItem(storageKey);
  }, [invite, storageKey]);

  const acceptInvite = useMutation(api.workspaceMembers.acceptWorkspaceInvite);

  async function handleAccept() {
    setAccepting(true);
    setError(null);
    try {
      const result = await acceptInvite({ token, ...pendingCryptoArgs });
      sessionStorage.removeItem(storageKey);
      if (result?.pendingApproval) {
        setEnrollmentSubmitted(true);
        setAccepting(false);
        return;
      }
      startViewTransition(() => navigate(DASHBOARD_PATH));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to accept invite';
      setError(message);
      setAccepting(false);
    }
  }

  async function prepareEncryptedIdentity() {
    if (!user?.id || !inviteSecret) {
      setError('This encrypted invite is missing its fragment key. Ask the owner for a new link.');
      return;
    }
    if (passphrase.length < 12 || passphrase !== confirmPassphrase) {
      setError('Use a matching passphrase of at least 12 characters.');
      return;
    }
    setAccepting(true);
    setError(null);
    try {
      const inviteSecretBytes = base64UrlToBytes(inviteSecret, 'invite secret');
      const identity = await generateMemberIdentityKeyPair();
      const wrapped = await wrapMemberPrivateKey({
        privateKey: identity.privateKey,
        passphrase,
        userId: user.id,
        keyVersion: 1,
      });
      const proof = createInviteEnrollmentProof({
        inviteSecret: inviteSecretBytes,
        token,
        userId: user.id,
        publicKey: identity.publicKey,
      });
      const memberRecoveryKit = createMemberRecoveryKit({
        userId: user.id,
        keyVersion: 1,
        recoverySecret: wrapped.recoverySecret,
        recoveryWrappedPrivateKey: wrapped.recoveryWrappedPrivateKey,
      });
      const recoveryKit = JSON.stringify(memberRecoveryKit, null, 2);
      const url = URL.createObjectURL(new Blob([recoveryKit], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'agendex-member-recovery.json';
      link.click();
      URL.revokeObjectURL(url);
      setPendingCryptoArgs({
        memberPublicKey: identity.publicKey,
        enrollmentProof: proof,
        encryptedPrivateKey: wrapped.encryptedPrivateKey,
        recoveryWrappedPrivateKey: wrapped.recoveryWrappedPrivateKey,
        kdf: wrapped.kdf,
        keyVersion: 1,
      });
      setRecoveryChecksum(memberRecoveryKit.checksum);
      setRecoveryVerified(false);
      identity.privateKey.fill(0);
      wrapped.recoverySecret.fill(0);
      inviteSecretBytes.fill(0);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to prepare member encryption');
    } finally {
      setAccepting(false);
    }
  }

  async function verifyRecoveryFile(file: File | undefined) {
    if (!file || !recoveryChecksum) return;
    try {
      const parsed = JSON.parse(await file.text()) as { checksum?: unknown };
      if (parsed.checksum !== recoveryChecksum) throw new Error('Recovery kit does not match');
      setRecoveryVerified(true);
      setError(null);
    } catch (caught) {
      setRecoveryVerified(false);
      setError(caught instanceof Error ? caught.message : 'Invalid recovery kit');
    }
  }

  function startInviteSignIn(provider: 'github' | 'google') {
    if (inviteSecret) sessionStorage.setItem(`agendex:invite-secret:${token}`, inviteSecret);
    void signIn.social({
      provider,
      callbackURL: `${window.location.origin}/invite/${token}`,
    });
  }

  const loading = authLoading || invite === undefined;

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center">
      <div className="w-full max-w-[420px] mx-4">
        <div className="bg-surface border border-border rounded-default p-6">
          {loading ? (
            <div className="text-center">
              <div className="text-[13px] text-secondary">Loading invite...</div>
            </div>
          ) : invite?.status === 'not_found' ? (
            <div className="text-center">
              <h2 className="text-[14px] font-semibold text-text mb-2">Invite not found</h2>
              <p className="text-[13px] text-secondary mb-4">
                This invite link is invalid or does not exist.
              </p>
              <button
                type="button"
                onClick={() => startViewTransition(() => navigate(DASHBOARD_PATH))}
                className="text-[13px] px-3.5 py-1.5 rounded-default border border-border bg-transparent text-text cursor-pointer font-medium transition-colors duration-150 hover:bg-hover"
              >
                Go to dashboard
              </button>
            </div>
          ) : invite?.status === 'revoked' ? (
            <div className="text-center">
              <h2 className="text-[14px] font-semibold text-text mb-2">Invite revoked</h2>
              <p className="text-[13px] text-secondary mb-4">
                This invite has been revoked by the workspace owner.
              </p>
              <button
                type="button"
                onClick={() => startViewTransition(() => navigate(DASHBOARD_PATH))}
                className="text-[13px] px-3.5 py-1.5 rounded-default border border-border bg-transparent text-text cursor-pointer font-medium transition-colors duration-150 hover:bg-hover"
              >
                Go to dashboard
              </button>
            </div>
          ) : invite?.status === 'accepted' ? (
            <div className="text-center">
              <h2 className="text-[14px] font-semibold text-text mb-2">Already accepted</h2>
              <p className="text-[13px] text-secondary mb-4">
                This invite has already been accepted.
              </p>
              <button
                type="button"
                onClick={() => startViewTransition(() => navigate(DASHBOARD_PATH))}
                className="text-[13px] px-3.5 py-1.5 rounded-default border border-border bg-transparent text-text cursor-pointer font-medium transition-colors duration-150 hover:bg-hover"
              >
                Go to dashboard
              </button>
            </div>
          ) : !isAuthenticated ? (
            <div className="text-center">
              <h2 className="text-[14px] font-semibold text-text mb-2">Workspace invite</h2>
              <p className="text-[13px] text-secondary mb-4">
                You've been invited to join a workspace. Sign in to accept.
              </p>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => startInviteSignIn('github')}
                  className="w-full text-[13px] py-2 px-4 rounded-default border border-border bg-transparent text-text cursor-pointer font-medium transition-colors duration-150 hover:bg-hover flex items-center justify-center gap-2"
                >
                  Sign in with GitHub
                </button>
                <button
                  type="button"
                  onClick={() => startInviteSignIn('google')}
                  className="w-full text-[13px] py-2 px-4 rounded-default border border-border bg-transparent text-text cursor-pointer font-medium transition-colors duration-150 hover:bg-hover flex items-center justify-center gap-2"
                >
                  Sign in with Google
                </button>
              </div>
            </div>
          ) : enrollmentSubmitted ? (
            <div className="text-center">
              <h2 className="text-[14px] font-semibold text-text mb-2">Approval requested</h2>
              <p className="text-[13px] text-secondary">
                The workspace owner must unlock Obfuscation and approve your device before access
                starts.
              </p>
            </div>
          ) : (
            <div className="text-center">
              <h2 className="text-[14px] font-semibold text-text mb-2">Workspace invite</h2>
              <p className="text-[13px] text-secondary mb-1">
                You've been invited to join a workspace as a read-only member.
              </p>
              <p className="text-[12px] text-tertiary mb-4">
                Invited email: <span className="text-text font-medium">{invite?.email}</span>
              </p>

              {invite?.encrypted && !pendingCryptoArgs && (
                <div className="text-left mb-4 space-y-2">
                  <label className="block text-[12px] text-secondary">
                    Member passphrase
                    <input
                      type="password"
                      value={passphrase}
                      onChange={(event) => setPassphrase(event.target.value)}
                      className="mt-1 w-full px-3 py-2 rounded-default border border-border bg-bg text-text"
                    />
                  </label>
                  <label className="block text-[12px] text-secondary">
                    Confirm passphrase
                    <input
                      type="password"
                      value={confirmPassphrase}
                      onChange={(event) => setConfirmPassphrase(event.target.value)}
                      className="mt-1 w-full px-3 py-2 rounded-default border border-border bg-bg text-text"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => void prepareEncryptedIdentity()}
                    disabled={accepting}
                    className="w-full text-[13px] py-2 px-4 rounded-default border border-border bg-transparent text-text cursor-pointer font-medium"
                  >
                    Download recovery kit
                  </button>
                </div>
              )}

              {invite?.encrypted && pendingCryptoArgs && !recoveryVerified && (
                <label className="block text-left text-[12px] text-secondary mb-4">
                  Re-import the recovery kit to verify it
                  <input
                    type="file"
                    accept="application/json,.json"
                    onChange={(event) => void verifyRecoveryFile(event.target.files?.[0])}
                    className="mt-2 block w-full text-[12px]"
                  />
                </label>
              )}

              {error && (
                <div className="text-[12px] text-[var(--danger)] mb-3 p-2.5 rounded-default bg-[var(--danger)]/10 border border-[var(--danger)]/20">
                  {error}
                </div>
              )}

              <button
                type="button"
                onClick={handleAccept}
                disabled={accepting || (invite?.encrypted && !recoveryVerified)}
                className="w-full text-[13px] py-2 px-4 rounded-default border-none cursor-pointer font-semibold disabled:opacity-50 disabled:cursor-default"
                style={{
                  background: 'var(--primary)',
                  color: `var(--accent-contrast, ${PRIMARY_CONTRAST_FALLBACK})`,
                }}
              >
                {accepting
                  ? 'Accepting...'
                  : invite?.encrypted
                    ? 'Request owner approval'
                    : 'Accept invite'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
