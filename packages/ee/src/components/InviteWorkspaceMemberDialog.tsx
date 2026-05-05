import { api } from '@convex/_generated/api';
import { useMutation } from 'convex/react';
import { useState } from 'react';

const appUrl = (import.meta.env.VITE_APP_URL as string) || window.location.origin;

interface InviteWorkspaceMemberDialogProps {
  onClose: () => void;
}

export function InviteWorkspaceMemberDialog({ onClose }: InviteWorkspaceMemberDialogProps) {
  const [email, setEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Convex component API not in generated types
  // oxlint-disable-next-line typescript/no-explicit-any
  const invite = useMutation((api as any).workspaceMembers.inviteWorkspaceMember);

  async function handleInvite() {
    if (!email.trim()) return;
    setInviting(true);
    setError(null);
    try {
      const result = await invite({ email: email.trim() });
      setInviteToken(result.token);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to send invite';
      setError(message);
    } finally {
      setInviting(false);
    }
  }

  async function handleCopy() {
    if (!inviteToken) return;
    const url = `${appUrl}/invite/${inviteToken}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        className="bg-surface border border-border rounded-default w-full max-w-[420px] mx-4"
        style={{ animation: 'statusPopoverIn 150ms ease-out' }}
      >
        <div className="p-5 border-b border-border">
          <h3 className="text-[15px] font-semibold text-text">Invite workspace member</h3>
          <p className="text-[13px] text-secondary mt-1.5 leading-relaxed">
            Members get read-only access to all your synced plans.
          </p>
        </div>

        <div className="p-5">
          {inviteToken ? (
            <div>
              <p className="text-[13px] text-secondary mb-3">
                Share this link with <span className="text-text font-medium">{email}</span>:
              </p>
              <div className="flex items-center gap-2 py-2 px-2.5 rounded-default border border-border bg-bg">
                <span className="flex-1 text-[12px] text-secondary font-mono overflow-hidden text-ellipsis whitespace-nowrap">
                  {appUrl}/invite/{inviteToken}
                </span>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="py-[3px] px-2.5 text-[11.5px] font-medium rounded-default border border-border bg-transparent cursor-pointer whitespace-nowrap"
                  style={{ color: copied ? '#16a34a' : 'var(--secondary)' }}
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-[13px] text-secondary mb-2">
                Email address
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="teammate@example.com"
                  autoFocus
                  disabled={inviting}
                  className="mt-2 w-full px-3 py-2 text-[13px] rounded-default border border-border bg-bg text-text placeholder:text-tertiary outline-none transition-colors duration-150 focus:border-[var(--primary)]"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && email.trim()) handleInvite();
                  }}
                />
              </label>

              {error && (
                <div className="text-[12px] text-[#ef4444] mt-2 p-2.5 rounded-default bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.2)]">
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 pb-5">
          <button
            type="button"
            onClick={onClose}
            className="text-[13px] px-3.5 py-1.5 rounded-default border border-border bg-transparent text-text cursor-pointer font-medium transition-colors duration-150 hover:bg-hover"
          >
            {inviteToken ? 'Done' : 'Cancel'}
          </button>
          {!inviteToken && (
            <button
              type="button"
              onClick={handleInvite}
              disabled={!email.trim() || inviting}
              className="text-[13px] px-3.5 py-1.5 rounded-default border-none text-white cursor-pointer font-semibold disabled:opacity-40 disabled:cursor-default"
              style={{ background: 'var(--primary)' }}
            >
              {inviting ? 'Inviting...' : 'Send invite'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
