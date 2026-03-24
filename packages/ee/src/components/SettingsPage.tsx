import { GitHubIcon, GoogleIcon, startViewTransition } from '@agendex/web';
import { api } from '@convex/_generated/api';
import { useAction, useMutation, useQuery } from 'convex/react';
import type { Id } from '@convex/_generated/dataModel';
import { useEffect, useState } from 'react';
import { Redirect, useLocation } from 'wouter';
import { useAuth } from '../hooks/useAuth';
import { type DaemonDeviceInfo, useDaemonStatus } from '../hooks/useDaemonStatus';
import { type Subscription, useSubscription } from '../hooks/useSubscription';
import { authClient } from '../lib/auth-client';
import { formatRelativeTime, formatUptime } from '../lib/formatTime';
import { InviteWorkspaceMemberDialog } from './InviteWorkspaceMemberDialog';
import { PricingModal } from './PricingModal';

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

function ProviderBadge({ provider }: { provider: string }) {
  const providers: Record<string, { icon: React.ReactNode; label: string }> = {
    github: { icon: <GitHubIcon size={14} />, label: 'GitHub' },
    google: { icon: <GoogleIcon size={14} />, label: 'Google' },
  };
  const info = providers[provider] ?? { icon: null, label: provider };
  return (
    <div className="flex items-center gap-1.5 mt-2.5 text-[12px] text-tertiary">
      {info.icon}
      <span>Linked with {info.label}</span>
    </div>
  );
}

function AccountSection({
  user,
}: {
  user: { name: string; email: string; image?: string | null };
}) {
  const initial = (user.name || user.email || '?').charAt(0).toUpperCase();
  const [provider, setProvider] = useState<string | null>(null);

  useEffect(() => {
    authClient.listAccounts().then(({ data }) => {
      if (data && data.length > 0) {
        setProvider(data[0]?.providerId ?? null);
      }
    });
  }, []);

  return (
    <section>
      <h2 className="text-[14px] font-semibold text-text mb-3">Account</h2>
      <div className="bg-surface border border-border rounded-default p-5">
        <div className="flex items-start gap-4">
          {user.image ? (
            <img src={user.image} alt="" className="size-12 rounded-full object-cover shrink-0" />
          ) : (
            <div className="size-12 rounded-full bg-border flex items-center justify-center text-[16px] font-semibold text-secondary shrink-0">
              {initial}
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-medium text-text truncate">{user.name}</div>
            <div className="text-[13px] text-secondary mt-0.5 truncate">{user.email}</div>
            {provider && <ProviderBadge provider={provider} />}
          </div>
        </div>
      </div>
    </section>
  );
}

function BillingSection({
  subscription,
  isActive,
  isTrialing,
  trialDaysLeft,
  createPortal,
  onUpgrade,
}: {
  subscription: Subscription | null | undefined;
  isActive: boolean;
  isTrialing: boolean;
  trialDaysLeft: number;
  createPortal: () => Promise<void>;
  onUpgrade: () => void;
}) {
  const [portalLoading, setPortalLoading] = useState(false);

  async function handleManageBilling() {
    setPortalLoading(true);
    try {
      await createPortal();
    } catch {
      setPortalLoading(false);
    }
  }

  const isFreePlan = subscription?.status === 'canceled' && !subscription?.stripeSubscriptionId;
  const statusLabel = isTrialing
    ? 'Trial'
    : isActive
      ? 'Pro'
      : isFreePlan
        ? 'Free'
        : subscription?.status === 'canceled'
          ? 'Canceled'
          : 'Free';

  const statusColor = isTrialing
    ? 'text-[#c8ff32]'
    : isActive
      ? 'text-[var(--primary)]'
      : 'text-tertiary';

  return (
    <section>
      <h2 className="text-[14px] font-semibold text-text mb-3">Billing</h2>
      <div className="bg-surface border border-border rounded-default p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-[13px] text-secondary">Current plan</div>
            <div className={`text-[15px] font-semibold mt-0.5 ${statusColor}`}>{statusLabel}</div>
          </div>

          {isTrialing && (
            <div className="text-[12px] text-secondary bg-hover px-2.5 py-1 rounded-default">
              {trialDaysLeft} day{trialDaysLeft !== 1 ? 's' : ''} remaining
            </div>
          )}
        </div>

        {isActive && subscription && !isTrialing && (
          <div className="flex gap-6 mb-4 text-[13px]">
            <div>
              <span className="text-secondary">Type: </span>
              <span className="text-text">
                {subscription.plan === 'monthly' ? 'Monthly' : 'Annual'}
              </span>
            </div>
            <div>
              <span className="text-secondary">Renews: </span>
              <span className="text-text">
                {new Date(subscription.currentPeriodEnd).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>
            </div>
          </div>
        )}

        {isActive && !isTrialing ? (
          <button
            type="button"
            onClick={handleManageBilling}
            disabled={portalLoading}
            className="text-[13px] px-3.5 py-1.5 rounded-default border border-border bg-transparent text-text cursor-pointer font-medium transition-colors duration-150 hover:bg-hover disabled:opacity-50 disabled:cursor-default"
          >
            {portalLoading ? 'Redirecting...' : 'Manage Billing'}
          </button>
        ) : (
          <button
            type="button"
            onClick={onUpgrade}
            className="text-[13px] px-3.5 py-1.5 rounded-default border-none text-white cursor-pointer font-semibold"
            style={{ background: 'var(--primary)' }}
          >
            Upgrade to Pro
          </button>
        )}
      </div>
    </section>
  );
}

function DeleteConfirmModal({
  email,
  onConfirm,
  onCancel,
  deleting,
}: {
  email: string;
  onConfirm: () => void;
  onCancel: () => void;
  deleting: boolean;
}) {
  const [input, setInput] = useState('');
  const confirmed = input === email;

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && !deleting) onCancel();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !deleting) onCancel();
      }}
    >
      <div
        className="bg-surface border border-border rounded-default w-full max-w-[420px] mx-4"
        style={{ animation: 'statusPopoverIn 150ms ease-out' }}
      >
        <div className="p-5 border-b border-border">
          <h3 className="text-[15px] font-semibold text-text">Delete account</h3>
          <p className="text-[13px] text-secondary mt-1.5 leading-relaxed">
            This will permanently delete your account, cancel any active subscription, and remove
            all your data. This action cannot be undone.
          </p>
        </div>

        <div className="p-5">
          <label className="block text-[13px] text-secondary mb-2">
            Type <span className="text-text font-medium">{email}</span> to confirm
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={email}
              autoFocus
              disabled={deleting}
              className="mt-2 w-full px-3 py-2 text-[13px] rounded-default border border-border bg-bg text-text placeholder:text-tertiary outline-none transition-colors duration-150 focus:border-red-500/50"
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 px-5 pb-5">
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className="text-[13px] px-3.5 py-1.5 rounded-default border border-border bg-transparent text-text cursor-pointer font-medium transition-colors duration-150 hover:bg-hover disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!confirmed || deleting}
            className="text-[13px] px-3.5 py-1.5 rounded-default border-none text-white cursor-pointer font-medium transition-opacity duration-150 disabled:opacity-40 disabled:cursor-default"
            style={{ background: '#ef4444' }}
          >
            {deleting ? 'Deleting...' : 'Delete my account'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DangerZone({
  email,
  onDeleteAccount,
  deleting,
}: {
  email: string;
  onDeleteAccount: () => Promise<void>;
  deleting: boolean;
}) {
  const [showModal, setShowModal] = useState(false);

  return (
    <>
      <section>
        <h2 className="text-[14px] font-semibold text-text mb-3">Danger Zone</h2>
        <div
          className="bg-surface border rounded-default p-5"
          style={{ borderColor: 'rgba(239, 68, 68, 0.3)' }}
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[14px] font-medium text-text">Delete account</div>
              <div className="text-[13px] text-secondary mt-0.5">
                Permanently remove your account and all data
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowModal(true)}
              className="text-[13px] px-3.5 py-1.5 rounded-default border cursor-pointer font-medium transition-colors duration-150 bg-transparent shrink-0"
              style={{ color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.3)' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              Delete account
            </button>
          </div>
        </div>
      </section>

      {showModal && (
        <DeleteConfirmModal
          email={email}
          deleting={deleting}
          onConfirm={async () => {
            await onDeleteAccount();
            setShowModal(false);
          }}
          onCancel={() => setShowModal(false)}
        />
      )}
    </>
  );
}

function DeviceCard({ device }: { device: DaemonDeviceInfo }) {
  const isAlive = device.status === 'alive';
  return (
    <div className="bg-surface border border-border rounded-default p-4 flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <div className="text-[14px] font-medium text-text truncate">
          {device.hostname ?? 'Unknown device'}
        </div>
        <div className="flex items-center gap-1.5 text-[12px] shrink-0">
          <span
            className="inline-block size-2 rounded-full"
            style={{ background: isAlive ? '#22c55e' : '#eab308' }}
          />
          <span className={isAlive ? 'text-text' : 'text-secondary'}>
            {isAlive ? 'Online' : 'Stale'}
          </span>
        </div>
      </div>
      <div className="flex gap-6 text-[13px]">
        <div>
          <span className="text-secondary">Uptime: </span>
          <span className="text-text">
            {device.uptimeMs != null ? formatUptime(device.uptimeMs) : 'n/a'}
          </span>
        </div>
        <div>
          <span className="text-secondary">Last seen: </span>
          <span className="text-text">
            {device.lastSeenAt != null ? formatRelativeTime(device.lastSeenAt) : 'Never'}
          </span>
        </div>
      </div>
    </div>
  );
}

function DaemonSection({ devices }: { devices: DaemonDeviceInfo[] }) {
  return (
    <section>
      <h2 className="text-[14px] font-semibold text-text mb-3">Connected Machines</h2>
      {devices.length === 0 ? (
        <div className="bg-surface border border-border rounded-default p-5">
          <p className="text-[13px] text-secondary">
            No CLI daemons detected. Run{' '}
            <code className="text-[12px] bg-hover px-1.5 py-0.5 rounded-default">
              agendex start
            </code>{' '}
            to connect a machine.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {devices.map((device, i) => (
            <DeviceCard key={device.deviceId ?? `device-${i}`} device={device} />
          ))}
        </div>
      )}
    </section>
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
  // biome-ignore lint/suspicious/noExplicitAny: Convex component API not in generated types
  const deleteAccountAction = useAction((api as any).account.deleteAccount);

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

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="max-w-[600px] mx-auto px-4 h-14 flex items-center gap-3">
          <button
            type="button"
            onClick={() => startViewTransition(() => navigate('/'))}
            className="p-1.5 -ml-1.5 rounded-default border-none bg-transparent text-secondary cursor-pointer transition-colors duration-150 hover:text-text hover:bg-hover"
            aria-label="Back to dashboard"
          >
            <BackArrow />
          </button>
          <h1 className="text-[14px] font-semibold text-text">Settings</h1>
        </div>
      </header>

      <div className="max-w-[600px] mx-auto py-8 px-4 flex flex-col gap-8">
        <AccountSection user={user} />

        <BillingSection
          subscription={subscription}
          isActive={isActive}
          isTrialing={isTrialing}
          trialDaysLeft={trialDaysLeft}
          createPortal={createPortal}
          onUpgrade={() => setShowPricing(true)}
        />

        {isActive && <WorkspaceMembersSection />}

        <DaemonSection devices={devices} />

        <DangerZone email={user.email} onDeleteAccount={handleDeleteAccount} deleting={deleting} />
      </div>

      {showPricing && <PricingModal onClose={() => setShowPricing(false)} />}
    </div>
  );
}
