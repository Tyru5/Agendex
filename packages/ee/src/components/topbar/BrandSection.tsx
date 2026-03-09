import { NewPlanIcon, SidebarToggleIcon, UploadIcon } from './TopbarIcons';

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
          className="size-[30px] rounded-lg border border-border text-secondary cursor-pointer flex items-center justify-center transition-colors duration-150 hover:bg-hover hover:text-text"
          style={{
            background: sidebarHidden ? 'var(--hover)' : 'transparent',
          }}
        >
          <SidebarToggleIcon hidden={sidebarHidden} />
        </button>
        {sidebarHidden && isPro && hasUnseenPlans && (
          <span className="sidebar-dot absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-blue-500 pointer-events-none" />
        )}
      </div>

      <span className="font-[Unbounded,sans-serif] font-medium text-[13px] tracking-[-0.02em] text-text whitespace-nowrap select-none">
        Agendex<span style={{ color: '#c8ff32' }}>.</span>
      </span>

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
            className="h-7 px-2.5 rounded-lg text-[11.5px] font-semibold tracking-[-0.01em] cursor-pointer flex items-center gap-1 border-none transition-all duration-150 bg-[#c8ff32] text-[#111] shadow-[0_0_0_1px_rgba(200,255,50,0.15),0_1px_3px_rgba(0,0,0,0.3)] hover:bg-[#d4ff5c] hover:shadow-[0_0_0_1px_rgba(200,255,50,0.3),0_2px_8px_rgba(200,255,50,0.15)] focus-visible:bg-[#d4ff5c] focus-visible:shadow-[0_0_0_1px_rgba(200,255,50,0.3),0_2px_8px_rgba(200,255,50,0.15)]"
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
            className="size-7 rounded-lg border border-border bg-transparent text-tertiary cursor-pointer flex items-center justify-center transition-all duration-150 hover:text-secondary hover:border-[rgba(255,255,255,0.12)] hover:bg-hover"
          >
            <UploadIcon />
          </button>
        </div>
      )}
    </div>
  );
}
