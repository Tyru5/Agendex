import { startViewTransition } from '@agendex/web';
import { api } from '@convex/_generated/api';
import { useAction, useMutation, useQuery } from 'convex/react';
import type { Id } from '@convex/_generated/dataModel';
import { useEffect, useState } from 'react';
import { Redirect, useLocation } from 'wouter';
import { useAuth } from '../hooks/useAuth';
import { useDaemonStatus } from '../hooks/useDaemonStatus';
import { useSubscription } from '../hooks/useSubscription';
import { useSubscriptionView } from '../hooks/useSubscriptionView';
import { authClient } from '../lib/auth-client';
import { InviteWorkspaceMemberDialog } from './InviteWorkspaceMemberDialog';
import { PricingModal } from './PricingModal';
import { AccountTab } from './settings/AccountTab';
import { SettingsSidebar } from './settings/SettingsSidebar';
import { SettingsTabs } from './settings/SettingsTabs';
import type { SettingsTabId } from './settings/constants';

function BackArrow() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  );
}

function WorkspaceMembersSection() {
  const [showInvite, setShowInvite] = useState(false);
  // biome-ignore lint/suspicious/noExplicitAny: Convex component API not in generated types
  const workspace = useQuery((api as any).workspaceMembers.listWorkspaceMembers);
  // biome-ignore lint/suspicious/noExplicitAny: Convex component API not in generated types
  const removeMember = useMutation((api as any).workspaceMembers.removeWorkspaceMember);
  // biome-ignore lint/suspicious/noExplicitAny: Convex component API not in generated types
  const revokeInvite = useMutation((api as any).workspaceMembers.revokeWorkspaceInvite);

  if (!workspace) return null;

  return (
    <>
      <section>
        <h2 className="text-[14px] font-semibold text-text mb-3">Workspace Members</h2>
        <div className="bg-surface border border-border rounded-default p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="text-[13px] text-secondary">
              {workspace.usedSeats} / {workspace.seatLimit} seats used
            </div>
            {workspace.remainingSeats > 0 && (
              <button
                type="button"
                onClick={() => setShowInvite(true)}
                className="text-[13px] px-3.5 py-1.5 rounded-default border-none text-white cursor-pointer font-semibold"
                style={{ background: 'var(--primary)' }}
              >
                Invite member
              </button>
            )}
          </div>

          {workspace.members.length > 0 && (
            <div className="flex flex-col gap-2 mb-3">
              {workspace.members.map((member: { _id: string; email: string; addedAt: number }) => (
                <div
                  key={member._id}
                  className="flex items-center justify-between py-2 px-3 rounded-default border border-border bg-bg"
                >
                  <div>
                    <div className="text-[13px] text-text">{member.email}</div>
                    <div className="text-[11px] text-tertiary mt-0.5">Member</div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      removeMember({ membershipId: member._id as Id<'workspaceMembers'> })
                    }
                    className="text-[12px] px-2.5 py-1 rounded-default border border-border bg-transparent cursor-pointer font-medium transition-colors duration-150"
                    style={{ color: '#ef4444' }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          {workspace.pendingInvites.length > 0 && (
            <div className="flex flex-col gap-2">
              {workspace.pendingInvites.map(
                (invite: { _id: string; email: string; createdAt: number }) => (
                  <div
                    key={invite._id}
                    className="flex items-center justify-between py-2 px-3 rounded-default border border-border bg-bg"
                  >
                    <div>
                      <div className="text-[13px] text-text">{invite.email}</div>
                      <div className="text-[11px] text-tertiary mt-0.5">Pending invite</div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        revokeInvite({ inviteId: invite._id as Id<'workspaceInvites'> })
                      }
                      className="text-[12px] px-2.5 py-1 rounded-default border border-border bg-transparent cursor-pointer font-medium transition-colors duration-150 text-secondary hover:text-text"
                    >
                      Revoke
                    </button>
                  </div>
                ),
              )}
            </div>
          )}

          {workspace.members.length === 0 && workspace.pendingInvites.length === 0 && (
            <p className="text-[13px] text-secondary">
              No members yet. Invite team members to give them read-only access to your plans.
            </p>
          )}
        </div>
      </section>

      {showInvite && <InviteWorkspaceMemberDialog onClose={() => setShowInvite(false)} />}
    </>
  );
}

export function SettingsPage() {
  const { user, isAuthenticated, isLoading, signOut } = useAuth();
  const { subscription, isActive, isTrialing, trialDaysLeft, createPortal } = useSubscription();
  const { devices } = useDaemonStatus();
  const [, navigate] = useLocation();
  const [showPricing, setShowPricing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [provider, setProvider] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTabId>('account');

  // biome-ignore lint/suspicious/noExplicitAny: Convex component API not in generated types
  const deleteAccountAction = useAction((api as any).account.deleteAccount);
  const removeDaemonMutation = useMutation(api.cli.removeDaemon);

  const subView = useSubscriptionView(subscription, isActive, isTrialing, trialDaysLeft);

  useEffect(() => {
    authClient.listAccounts().then(({ data }) => {
      if (data && data.length > 0) {
        setProvider(data[0]?.providerId ?? null);
      }
    });
  }, []);


  if (isLoading) return null;
  if (!isAuthenticated || !user) return <Redirect to="/" />;

  async function handleDeleteAccount() {
    setDeleting(true);
    try {
      await deleteAccountAction();
      try {
        await signOut();
      } catch {
        // The auth session may already be gone after server-side deletion.
      }
      startViewTransition(() => navigate('/'));
    } catch (err) {
      console.error('Delete account error:', err);
      setDeleting(false);
    }
  }

  async function handleSignOut() {
    try {
      await signOut();
    } catch {
      // ignore
    } finally {
      startViewTransition(() => navigate('/'));
    }
  }

  return (
    <div className="min-h-screen bg-bg">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-border bg-bg/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between px-4 lg:px-6">
          <button
            type="button"
            onClick={() => startViewTransition(() => navigate('/'))}
            className="flex items-center gap-2 p-1.5 -ml-1.5 rounded-default border-none bg-transparent text-secondary cursor-pointer transition-colors duration-150 hover:text-text"
            aria-label="Back to dashboard"
          >
            <BackArrow />
            <span className="text-[13px] font-medium">Back to Chat</span>
          </button>

          <button
            type="button"
            onClick={handleSignOut}
            className="text-[13px] px-3.5 py-1.5 rounded-default border border-border bg-transparent text-secondary cursor-pointer font-medium transition-colors duration-150 hover:text-text hover:bg-hover"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Body */}
      <main className="mx-auto max-w-[1400px] px-4 py-8 lg:px-6">
        <div className="grid gap-8 lg:grid-cols-[320px_minmax(0,1fr)]">
          {/* Left Sidebar */}
          <SettingsSidebar
            user={user}
            provider={provider}
            statusLabel={subView.statusLabel}
            isActive={isActive}
            isTrialing={isTrialing}
            trialDaysLeft={trialDaysLeft}
            subscription={subscription}
            renewalDate={subView.renewalDate}
            cadence={subView.cadence}
          />

          {/* Right Content */}
          <section className="min-w-0">
            <SettingsTabs activeTab={activeTab} onChange={setActiveTab} />

            <AccountTab
              user={user}
              subscription={subscription}
              isActive={isActive}
              isTrialing={isTrialing}
              trialDaysLeft={trialDaysLeft}
              devices={devices}
              createPortal={createPortal}
              onUpgrade={() => setShowPricing(true)}
              onDeleteDevice={async (deviceId) => {
                await removeDaemonMutation({ deviceId });
              }}
              onDeleteAccount={handleDeleteAccount}
              deleting={deleting}
            />

            {isActive && <WorkspaceMembersSection />}
          </section>
        </div>
      </main>

      {showPricing && <PricingModal onClose={() => setShowPricing(false)} />}
    </div>
  );
}
