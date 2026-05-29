import { startViewTransition } from '@agendex/web';
import { api } from '@convex/_generated/api';
import { useAction, useMutation } from 'convex/react';
import { useEffect, useState } from 'react';
import { Redirect, useLocation } from 'wouter';
import { useAuth } from '../hooks/useAuth';
import { useDaemonStatus } from '../hooks/useDaemonStatus';
import { useSubscription } from '../hooks/useSubscription';
import { useSubscriptionView } from '../hooks/useSubscriptionView';
import { authClient } from '../lib/auth-client';
import { PricingModal } from './PricingModal';
import { AccountTab } from './settings/AccountTab';
import { SettingsSidebar } from './settings/SettingsSidebar';
import { SettingsTabs } from './settings/SettingsTabs';
import { TeamTab } from './settings/TeamTab';
import type { SettingsTabId } from './settings/constants';

const DASHBOARD_PATH = '/dashboard';

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

export function SettingsPage() {
  const { user, isAuthenticated, isLoading, signOut } = useAuth();
  const { subscription, isActive, isTrialing, trialDaysLeft, createPortal } = useSubscription();
  const { devices } = useDaemonStatus();
  const [, navigate] = useLocation();
  const [showPricing, setShowPricing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [provider, setProvider] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTabId>('account');

  // Convex component API not in generated types
  // oxlint-disable-next-line typescript/no-explicit-any
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
  if (!isAuthenticated || !user) return <Redirect to="/login" />;

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
    <div className="agendex-app-shell min-h-screen">
      {/* Header */}
      <header className="agendex-topbar sticky top-0 z-20 border-b border-border">
        <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between px-4 lg:px-6">
          <button
            type="button"
            onClick={() => startViewTransition(() => navigate(DASHBOARD_PATH))}
            className="agendex-topbar-button flex items-center gap-2 p-1.5 -ml-1.5 rounded-default border border-transparent cursor-pointer"
            aria-label="Back to dashboard"
          >
            <BackArrow />
            <span className="text-[13px] font-medium">Back to dashboard</span>
          </button>

          <button
            type="button"
            onClick={handleSignOut}
            className="agendex-topbar-button text-[13px] px-3.5 py-1.5 rounded-default border border-border cursor-pointer font-medium"
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
            renewalDate={subView.renewalDate}
            cadence={subView.cadence}
          />

          {/* Right Content */}
          <section className="min-w-0">
            <SettingsTabs activeTab={activeTab} onChange={setActiveTab} />

            <div key={activeTab} className="settings-tab-content">
              {activeTab === 'account' && (
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
              )}

              {activeTab === 'team' && <TeamTab isActive={isActive} />}
            </div>
          </section>
        </div>
      </main>

      {showPricing && <PricingModal onClose={() => setShowPricing(false)} />}
    </div>
  );
}
