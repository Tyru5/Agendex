import { startViewTransition } from '@agendex/web';
import { api } from '@convex/_generated/api';
import { useMutation, useQuery } from 'convex/react';
import { useState } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '../hooks/useAuth';

const DASHBOARD_PATH = '/dashboard';

export function AcceptInvitePage({ token }: { token: string }) {
  const { isAuthenticated, isLoading: authLoading, signIn } = useAuth();
  const [, navigate] = useLocation();
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Convex component API not in generated types
  // oxlint-disable-next-line typescript/no-explicit-any
  const invite = useQuery(
    // Convex component API not in generated types
    // oxlint-disable-next-line typescript/no-explicit-any
    (api as any).workspaceMembers.getWorkspaceInviteByToken,
    { token },
  );

  // Convex component API not in generated types
  // oxlint-disable-next-line typescript/no-explicit-any
  const acceptInvite = useMutation((api as any).workspaceMembers.acceptWorkspaceInvite);

  async function handleAccept() {
    setAccepting(true);
    setError(null);
    try {
      await acceptInvite({ token });
      startViewTransition(() => navigate(DASHBOARD_PATH));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to accept invite';
      setError(message);
      setAccepting(false);
    }
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
              <h2 className="text-[15px] font-semibold text-text mb-2">Invite not found</h2>
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
              <h2 className="text-[15px] font-semibold text-text mb-2">Invite revoked</h2>
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
              <h2 className="text-[15px] font-semibold text-text mb-2">Already accepted</h2>
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
              <h2 className="text-[15px] font-semibold text-text mb-2">Workspace invite</h2>
              <p className="text-[13px] text-secondary mb-4">
                You've been invited to join a workspace. Sign in to accept.
              </p>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() =>
                    signIn.social({ provider: 'github', callbackURL: window.location.href })
                  }
                  className="w-full text-[13px] py-2 px-4 rounded-default border border-border bg-transparent text-text cursor-pointer font-medium transition-colors duration-150 hover:bg-hover flex items-center justify-center gap-2"
                >
                  Sign in with GitHub
                </button>
                <button
                  type="button"
                  onClick={() =>
                    signIn.social({ provider: 'google', callbackURL: window.location.href })
                  }
                  className="w-full text-[13px] py-2 px-4 rounded-default border border-border bg-transparent text-text cursor-pointer font-medium transition-colors duration-150 hover:bg-hover flex items-center justify-center gap-2"
                >
                  Sign in with Google
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center">
              <h2 className="text-[15px] font-semibold text-text mb-2">Workspace invite</h2>
              <p className="text-[13px] text-secondary mb-1">
                You've been invited to join a workspace as a read-only member.
              </p>
              <p className="text-[12px] text-tertiary mb-4">
                Invited email: <span className="text-text font-medium">{invite?.email}</span>
              </p>

              {error && (
                <div className="text-[12px] text-[#ef4444] mb-3 p-2.5 rounded-default bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.2)]">
                  {error}
                </div>
              )}

              <button
                type="button"
                onClick={handleAccept}
                disabled={accepting}
                className="w-full text-[13px] py-2 px-4 rounded-default border-none text-white cursor-pointer font-semibold disabled:opacity-50 disabled:cursor-default"
                style={{ background: 'var(--primary)' }}
              >
                {accepting ? 'Accepting...' : 'Accept invite'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
