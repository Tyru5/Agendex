import { startViewTransition } from '@agendex/web';
import { api } from '@convex/_generated/api';
import { useAction } from 'convex/react';
import { useEffect, useState } from 'react';
import { Redirect, useLocation } from 'wouter';
import { useAuth } from '../hooks/useAuth';
import { authClient } from '../lib/auth-client';
import { useSubscription } from '../hooks/useSubscription';
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
    >
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

function ProviderBadge({ provider }: { provider: string }) {
  const providers: Record<string, { icon: React.ReactNode; label: string }> = {
    github: { icon: <GitHubIcon />, label: 'GitHub' },
    google: { icon: <GoogleIcon />, label: 'Google' },
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
        setProvider(data[0].providerId);
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
  subscription: any;
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
          </label>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={email}
            autoFocus
            disabled={deleting}
            className="w-full px-3 py-2 text-[13px] rounded-default border border-border bg-bg text-text placeholder:text-tertiary outline-none transition-colors duration-150 focus:border-red-500/50"
          />
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

export function SettingsPage() {
  const { user, isAuthenticated, isLoading, signOut } = useAuth();
  const { subscription, isActive, isTrialing, trialDaysLeft, createPortal } = useSubscription();
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

        <DangerZone email={user.email} onDeleteAccount={handleDeleteAccount} deleting={deleting} />
      </div>

      {showPricing && <PricingModal onClose={() => setShowPricing(false)} />}
    </div>
  );
}
