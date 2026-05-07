import { useState } from 'react';
import type { DaemonDeviceInfo } from '../../hooks/useDaemonStatus';
import type { Subscription } from '../../hooks/useSubscription';
import { formatRelativeTime, formatUptime } from '../../lib/formatTime';
import { AgentAvatarsSection } from './AgentAvatarsSection';
import { FREE_FEATURES, MONTHLY_PRICE, PRIMARY_RGB_FALLBACK, PRO_FEATURES } from './constants';

interface AccountTabProps {
  user: { name: string; email: string; image?: string | null };
  subscription: Subscription | null | undefined;
  isActive: boolean;
  isTrialing: boolean;
  trialDaysLeft: number;
  devices: DaemonDeviceInfo[];
  createPortal: () => Promise<void>;
  onUpgrade: () => void;
  onDeleteDevice: (deviceId: string) => Promise<void>;
  onDeleteAccount: () => Promise<void>;
  deleting: boolean;
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-[var(--primary,#8b5cf6)] shrink-0 mt-0.5"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function PlanCard({
  badge,
  name,
  price,
  period,
  features,
  cta,
  ctaHref,
  onCtaClick,
  isCurrentPlan,
  isAccent,
}: {
  badge: string;
  name: string;
  price: string;
  period: string;
  features: readonly string[];
  cta: string;
  ctaHref?: string;
  onCtaClick?: () => void;
  isCurrentPlan?: boolean;
  isAccent?: boolean;
}) {
  const ctaElement = ctaHref ? (
    <a
      href={ctaHref}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-auto block text-center text-[13px] font-semibold px-4 py-2.5 rounded-xl border border-border bg-transparent text-text transition-colors duration-150 hover:bg-hover no-underline"
    >
      {cta}
    </a>
  ) : (
    <button
      type="button"
      onClick={onCtaClick}
      disabled={isCurrentPlan}
      className={[
        'mt-auto text-[13px] font-semibold px-4 py-2.5 rounded-xl border transition-colors duration-150 cursor-pointer',
        isCurrentPlan
          ? 'border-border bg-transparent text-secondary cursor-default'
          : 'border-transparent text-white',
      ].join(' ')}
      style={!isCurrentPlan ? { background: 'var(--primary, #8b5cf6)' } : undefined}
    >
      {cta}
    </button>
  );

  return (
    <div
      className={[
        'relative rounded-2xl border p-6 flex flex-col gap-4',
        isCurrentPlan
          ? 'border-[var(--primary,#8b5cf6)]/50 ring-1 ring-[var(--primary,#8b5cf6)]/20'
          : isAccent
            ? 'border-[var(--primary,#8b5cf6)]/30'
            : 'border-border',
      ].join(' ')}
      style={{
        background: isCurrentPlan
          ? `radial-gradient(ellipse 80% 50% at 50% 0%, rgba(var(--primary-rgb, ${PRIMARY_RGB_FALLBACK}), 0.10), transparent 60%), var(--surface)`
          : isAccent
            ? `radial-gradient(ellipse 80% 50% at 50% 0%, rgba(var(--primary-rgb, ${PRIMARY_RGB_FALLBACK}), 0.06), transparent 60%), var(--surface)`
            : 'var(--surface)',
      }}
    >
      {isCurrentPlan && (
        <span
          className="absolute -top-3 right-5 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-3 py-1 rounded-full"
          style={{
            background: 'var(--primary, #8b5cf6)',
            color: '#fff',
            boxShadow: `0 2px 8px rgba(var(--primary-rgb, ${PRIMARY_RGB_FALLBACK}), 0.3)`,
          }}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Current
        </span>
      )}
      <div>
        <span
          className="inline-block text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg mb-3"
          style={{
            background: isCurrentPlan
              ? `rgba(var(--primary-rgb, ${PRIMARY_RGB_FALLBACK}), 0.15)`
              : isAccent
                ? `rgba(var(--primary-rgb, ${PRIMARY_RGB_FALLBACK}), 0.15)`
                : 'var(--hover)',
            color: isCurrentPlan || isAccent ? 'var(--primary, #8b5cf6)' : 'var(--secondary)',
          }}
        >
          {badge}
        </span>
        <h3 className="text-[18px] font-semibold text-text">{name}</h3>
        <div className="flex items-baseline gap-1 mt-1">
          <span className="text-[28px] font-bold text-text">{price}</span>
          <span className="text-[13px] text-secondary">{period}</span>
        </div>
      </div>

      <ul className="flex flex-col gap-2.5 flex-1">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2.5 text-[13px] text-secondary">
            <CheckIcon />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      {ctaElement}
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[20px] font-semibold text-text mb-4">{children}</h2>;
}

function DeviceCard({
  device,
  onRemove,
}: {
  device: DaemonDeviceInfo;
  onRemove?: (deviceId: string) => void;
}) {
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState(false);
  const isAlive = device.status === 'alive';
  const canRemove = device.deviceId != null && onRemove != null;

  async function handleRemove() {
    setRemoving(true);
    setError(false);
    try {
      await onRemove!(device.deviceId as string);
    } catch {
      setError(true);
      setRemoving(false);
    }
  }

  return (
    <div className="bg-surface border border-border rounded-2xl p-4 flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <div className="text-[14px] font-medium text-text truncate">
          {device.hostname ?? 'Unknown device'}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1.5 text-[12px]">
            <span
              className="inline-block size-2 rounded-full"
              style={{ background: isAlive ? '#22c55e' : '#eab308' }}
            />
            <span className={isAlive ? 'text-text' : 'text-secondary'}>
              {isAlive ? 'Online' : 'Stale'}
            </span>
          </div>
          {canRemove && (
            <button
              type="button"
              disabled={removing}
              onClick={handleRemove}
              className="text-[12px] px-2 py-1 rounded-lg border border-border bg-transparent text-secondary cursor-pointer font-medium transition-colors duration-150 hover:text-red-400 hover:border-red-400/30 hover:bg-red-400/10 disabled:opacity-50 disabled:cursor-default"
            >
              {removing ? 'Removing…' : error ? 'Failed — Retry' : 'Remove'}
            </button>
          )}
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
        className="bg-surface border border-border rounded-2xl w-full max-w-[420px] mx-4"
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

export function AccountTab({
  user,
  subscription,
  isActive,
  isTrialing,
  trialDaysLeft,
  devices,
  createPortal,
  onUpgrade,
  onDeleteDevice,
  onDeleteAccount,
  deleting,
}: AccountTabProps) {
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const isFreePlan = subscription?.status === 'canceled' && !subscription?.stripeSubscriptionId;

  async function handleManageBilling() {
    setPortalLoading(true);
    setPortalError(null);
    try {
      await createPortal();
    } catch (err) {
      setPortalError('Unable to open billing portal. Please try again.');
      setPortalLoading(false);
    }
  }

  return (
    <div className="space-y-10">
      {/* Choose Your Plan */}
      <section>
        <SectionHeading>Choose Your Plan</SectionHeading>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <PlanCard
            badge="Self-Hosted"
            name="Free"
            price="$0"
            period="/forever"
            features={FREE_FEATURES}
            cta="View on GitHub"
            ctaHref="https://github.com/Tyru5/agendex"
            isCurrentPlan={!isActive}
          />
          <PlanCard
            badge="Pro"
            name="Cloud"
            price={`$${MONTHLY_PRICE}`}
            period="/mo"
            features={PRO_FEATURES}
            cta={
              isActive && !isTrialing
                ? 'Current Plan'
                : isTrialing
                  ? `Trial · ${trialDaysLeft}d left`
                  : 'Upgrade to Pro'
            }
            onCtaClick={isActive && !isTrialing ? undefined : onUpgrade}
            isCurrentPlan={isActive && !isTrialing}
            isAccent
          />
        </div>
        <p className="text-[12px] text-tertiary mt-3">
          * Prices shown do not include taxes. Taxes are added at checkout where required.
        </p>
      </section>

      {/* Billing Preferences */}
      <section>
        <SectionHeading>Billing Preferences</SectionHeading>
        <div className="rounded-2xl border border-border bg-surface p-5">
          {isActive && !isFreePlan ? (
            <>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-[14px] font-medium text-text">Receipts & Invoices</div>
                  <div className="text-[13px] text-secondary mt-0.5">
                    Sent to {user.email} when a payment succeeds.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleManageBilling}
                  disabled={portalLoading}
                  className="text-[13px] px-3.5 py-1.5 rounded-xl border border-border bg-transparent text-text cursor-pointer font-medium transition-colors duration-150 hover:bg-hover disabled:opacity-50 disabled:cursor-default shrink-0"
                >
                  {portalLoading ? 'Redirecting...' : 'Manage Billing'}
                </button>
              </div>
              {portalError && <div className="text-[12px] text-red-400 mt-2">{portalError}</div>}
            </>
          ) : (
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-[14px] font-medium text-text">Billing Preferences</div>
                <div className="text-[13px] text-secondary mt-0.5">Available on the Pro plan.</div>
              </div>
              <button
                type="button"
                onClick={onUpgrade}
                className="text-[13px] px-3.5 py-1.5 rounded-xl border-none text-white cursor-pointer font-semibold shrink-0"
                style={{ background: 'var(--primary, #8b5cf6)' }}
              >
                Upgrade to Pro
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Agent Avatars */}
      <AgentAvatarsSection />

      {/* Connected Machines */}
      <section>
        <SectionHeading>Connected Machines</SectionHeading>
        {devices.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface p-5">
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
              <DeviceCard
                key={device.deviceId ?? `device-${i}`}
                device={device}
                onRemove={onDeleteDevice}
              />
            ))}
          </div>
        )}
      </section>

      {/* Danger Zone */}
      <section>
        <SectionHeading>Danger Zone</SectionHeading>
        <div
          className="rounded-2xl border p-5"
          style={{ borderColor: 'rgba(239, 68, 68, 0.3)', background: 'var(--surface)' }}
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
              onClick={() => setShowDeleteModal(true)}
              className="text-[13px] px-3.5 py-1.5 rounded-xl border cursor-pointer font-medium transition-colors duration-150 bg-transparent shrink-0"
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

      {showDeleteModal && (
        <DeleteConfirmModal
          email={user.email}
          deleting={deleting}
          onConfirm={async () => {
            await onDeleteAccount();
            setShowDeleteModal(false);
          }}
          onCancel={() => setShowDeleteModal(false)}
        />
      )}
    </div>
  );
}
