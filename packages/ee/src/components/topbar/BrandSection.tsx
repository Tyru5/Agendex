import { SidebarToggleIcon, UploadIcon } from './TopbarIcons';

export function BrandSection({
  sidebarPinnedOpen,
  sidebarHidden,
  sidebarWidth,
  isPro,
  hasUnseenPlans,
  mode,
  backendStatus,
  onToggleSidebar,
  onNewPlan,
  onUpload,
  onLogoClick,
}: {
  sidebarPinnedOpen: boolean;
  sidebarHidden: boolean;
  sidebarWidth: number;
  isPro: boolean;
  hasUnseenPlans: boolean;
  mode: 'local' | 'cloud';
  backendStatus: string;
  onToggleSidebar: () => void;
  onNewPlan: () => void;
  onUpload: () => void;
  onLogoClick: () => void;
}) {
  return (
    <div
      className="flex items-center gap-2.5 min-w-0 h-full shrink-0 pl-4"
      style={{
        width: sidebarPinnedOpen ? `${sidebarWidth}px` : undefined,
        flex: sidebarPinnedOpen ? '0 0 auto' : undefined,
        paddingRight: sidebarPinnedOpen ? '12px' : undefined,
        borderRight: sidebarPinnedOpen ? '1px solid var(--border)' : 'none',
      }}
    >
      <div className="shrink-0 relative">
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label={sidebarHidden ? 'Show sidebar' : 'Hide sidebar'}
          title={sidebarHidden ? 'Show sidebar' : 'Hide sidebar'}
          className="agendex-topbar-button size-[30px] rounded-lg border border-border cursor-pointer flex items-center justify-center"
          style={{
            background: sidebarHidden ? 'var(--hover)' : 'transparent',
          }}
        >
          <SidebarToggleIcon hidden={sidebarHidden} />
        </button>
        {sidebarHidden && isPro && hasUnseenPlans && (
          <span className="sidebar-dot absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-[var(--accent)] pointer-events-none" />
        )}
      </div>

      <button
        type="button"
        onClick={onLogoClick}
        className="font-[Unbounded,sans-serif] font-medium text-[13px] tracking-[0] text-text whitespace-nowrap select-none bg-transparent border-none p-0 cursor-pointer"
      >
        Agendex<span className="agendex-brand-mark">.</span>
      </button>

      {(mode === 'local' || (mode === 'cloud' && isPro)) && (
        <div
          className="flex items-center gap-1 ml-1.5 transition-[opacity,transform,filter] duration-200 ease-in-out"
          style={{
            opacity: sidebarPinnedOpen ? 0 : backendStatus === 'offline' ? 0.35 : 1,
            transform: sidebarPinnedOpen ? 'scale(0.95)' : 'scale(1)',
            filter: backendStatus === 'offline' ? 'blur(1.5px)' : undefined,
            pointerEvents: sidebarPinnedOpen || backendStatus === 'offline' ? 'none' : 'auto',
          }}
        >
          <button
            type="button"
            onClick={onNewPlan}
            aria-label="Create new plan"
            title="Create new plan"
            className="agendex-topbar-primary h-7 px-2.5 rounded-lg text-[11.5px] font-semibold cursor-pointer flex items-center gap-1"
          >
            <svg
              aria-hidden="true"
              width="11"
              height="11"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M6 1v10M1 6h10" />
            </svg>
            New
          </button>
          <button
            type="button"
            onClick={onUpload}
            aria-label="Upload plan"
            title="Upload plan"
            className="agendex-topbar-button size-7 rounded-lg border border-border cursor-pointer flex items-center justify-center"
          >
            <UploadIcon />
          </button>
        </div>
      )}
    </div>
  );
}
