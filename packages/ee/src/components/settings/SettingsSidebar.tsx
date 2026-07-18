import { GitHubIcon, GoogleIcon } from '@agendex/web';
import { PRIMARY_RGB_FALLBACK } from './constants';

interface SidebarProps {
  user: { name: string; email: string; image?: string | null };
  provider: string | null;
  statusLabel: string;
  isActive: boolean;
  isTrialing: boolean;
  trialDaysLeft: number;
  renewalDate: string | null;
  cadence: string | null;
}

function ProviderBadge({ provider }: { provider: string }) {
  const providers: Record<string, { icon: React.ReactNode; label: string }> = {
    github: { icon: <GitHubIcon size={14} />, label: 'GitHub' },
    google: { icon: <GoogleIcon size={14} />, label: 'Google' },
  };
  const info = providers[provider] ?? { icon: null, label: provider };
  return (
    <div className="flex items-center gap-1.5 text-[12px] text-tertiary">
      {info.icon}
      <span>Linked with {info.label}</span>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center size-9 rounded-[8px] bg-hover text-[13px] font-medium text-text">
      {children}
    </kbd>
  );
}

const shortcuts = [
  { label: 'Command Palette', keys: ['⌘', 'K'] },
  { label: 'Search Plans', keys: ['/'] },
  { label: 'Toggle Sidebar', keys: ['⌘', 'B'] },
  { label: 'Toggle Outline', keys: ['⇧', '⌘', 'O'] },
  { label: 'Toggle Tech Chart', keys: ['⇧', '⌘', 'G'] },
  { label: 'Submit Comment', keys: ['⌘', '↵'] },
  { label: 'Close / Cancel', keys: ['Esc'] },
] as const;

export function SettingsSidebar({
  user,
  provider,
  statusLabel,
  isActive,
  isTrialing,
  trialDaysLeft,
  renewalDate,
  cadence,
}: SidebarProps) {
  const initial = (user.name || user.email || '?').charAt(0).toUpperCase();

  return (
    <aside className="lg:sticky lg:top-[88px] self-start space-y-4">
      {/* Profile Hero Card */}
      <div
        className="rounded-2xl border border-border p-6 flex flex-col items-center text-center"
        style={{
          background: `radial-gradient(ellipse 80% 50% at 50% 0%, rgba(var(--primary-rgb, ${PRIMARY_RGB_FALLBACK}), 0.08), transparent 60%), var(--surface)`,
        }}
      >
        {user.image ? (
          <img
            src={user.image}
            alt=""
            className="size-24 rounded-full object-cover ring-2 ring-border"
          />
        ) : (
          <div className="size-24 rounded-full bg-hover flex items-center justify-center text-[28px] font-semibold text-secondary ring-2 ring-border">
            {initial}
          </div>
        )}

        <div className="mt-4 text-[17px] font-semibold text-text">{user.name}</div>
        <div className="mt-1 text-[13px] text-secondary truncate max-w-full">{user.email}</div>

        <div className="mt-3 flex items-center gap-2">
          <span
            className="inline-flex items-center px-3 py-1 rounded-full text-[12px] font-semibold"
            style={{
              background: isActive
                ? `rgba(var(--primary-rgb, ${PRIMARY_RGB_FALLBACK}), 0.15)`
                : 'var(--hover)',
              color: isActive ? 'var(--primary)' : 'var(--secondary)',
            }}
          >
            {statusLabel} Plan
          </span>
        </div>

        {provider && (
          <div className="mt-3">
            <ProviderBadge provider={provider} />
          </div>
        )}
      </div>

      {/* Plan Summary Card */}
      <div className="rounded-2xl border border-border bg-surface p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[14px] font-semibold text-text">Plan Details</h3>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-tertiary"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-secondary">Status</span>
            <span className="text-text font-medium">{statusLabel}</span>
          </div>

          {cadence && (
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-secondary">Billing</span>
              <span className="text-text font-medium">{cadence}</span>
            </div>
          )}

          {renewalDate && (
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-secondary">Renews</span>
              <span className="text-text font-medium">{renewalDate}</span>
            </div>
          )}

          {isTrialing && (
            <div className="mt-2 flex items-center gap-2 text-[12px] text-secondary bg-hover px-3 py-2 rounded-xl">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              {trialDaysLeft} day{trialDaysLeft !== 1 ? 's' : ''} remaining in trial
            </div>
          )}
        </div>
      </div>

      {/* Keyboard Shortcuts Card */}
      <div className="rounded-2xl border border-border bg-surface p-5">
        <h3 className="text-[14px] font-semibold text-text mb-4">Keyboard Shortcuts</h3>
        <div className="flex flex-col gap-3">
          {shortcuts.map((s) => (
            <div key={s.label} className="flex items-center justify-between">
              <span className="text-[13px] font-medium text-text">{s.label}</span>
              <div className="flex items-center gap-1.5">
                {s.keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
