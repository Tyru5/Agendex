import { type Plan, type PlanState, ThemeToggle } from '@agendex/web';
import type { DaemonDeviceInfo } from '../hooks/useDaemonStatus';
import { AuthButton } from './AuthButton';
import { CommandPalette } from './command-palette/CommandPalette';
import { SubscriptionBadge } from './SubscriptionBadge';
import { BrandSection } from './topbar/BrandSection';
import { MachinesIndicator } from './topbar/MachinesIndicator';
import { StatusPopover } from './topbar/StatusPopover';

export function DashboardTopbar({
  sidebarPinnedOpen,
  sidebarHidden,
  isPro,
  hasUnseenPlans,
  mode,
  backendStatus,
  backendIndicator,
  totalPlans,
  activeAgents,
  search,
  plans,
  selectedPlan,
  height,
  onToggleSidebar,
  onSetSearch,
  onSelectPlan,
  onNewPlan,
  onUpload,
  onHistory,
  onNavigate,
  daemonDevices,
  daemonAggregateStatus,
  onShowPricing,
  splitPlanId,
  onOpenInSplitView,
  onCloseSplit,
  planState,
  onToggleOutline,
  onToggleChart,
  onDeletePlan,
  onShowChangelog,
  onManageSources,
  onSwitchMode,
  sidebarWidth: sidebarWidthProp,
}: {
  sidebarPinnedOpen: boolean;
  sidebarHidden: boolean;
  isPro: boolean;
  hasUnseenPlans: boolean;
  mode: 'local' | 'cloud';
  backendStatus: string;
  backendIndicator: { label: string; color: string };
  totalPlans: number;
  activeAgents: number;
  search: string;
  plans: Plan[];
  selectedPlan: Plan | undefined;
  height: number;
  onToggleSidebar: () => void;
  onSetSearch: (v: string) => void;
  onSelectPlan: (p: Plan | undefined) => void;
  onNewPlan: () => void;
  onUpload: () => void;
  onHistory: () => void;
  onNavigate: (path: string) => void;
  daemonDevices: DaemonDeviceInfo[];
  daemonAggregateStatus: 'alive' | 'stale' | 'unknown';
  onShowPricing: () => void;
  splitPlanId?: string;
  onOpenInSplitView: (plan: Plan) => void;
  onCloseSplit?: () => void;
  planState: PlanState;
  onToggleOutline?: () => void;
  onToggleChart?: () => void;
  onDeletePlan?: (planId: string) => void;
  onShowChangelog?: () => void;
  onManageSources?: () => void;
  onSwitchMode?: (mode: 'local' | 'cloud') => void;
  sidebarWidth?: number;
}) {
  return (
    <div
      className="agendex-topbar flex items-center min-w-0 col-span-full border-b border-border z-50 box-border"
      style={{ height: `${height}px` }}
    >
      <BrandSection
        sidebarPinnedOpen={sidebarPinnedOpen}
        sidebarHidden={sidebarHidden}
        sidebarWidth={sidebarWidthProp ?? 260}
        isPro={isPro}
        hasUnseenPlans={hasUnseenPlans}
        mode={mode}
        backendStatus={backendStatus}
        onToggleSidebar={onToggleSidebar}
        onNewPlan={onNewPlan}
        onUpload={onUpload}
        onLogoClick={() => onSelectPlan(undefined)}
      />

      <div className="hidden md:flex flex-1 min-w-0 justify-center">
        <CommandPalette
          search={search}
          onSearch={onSetSearch}
          plans={plans}
          selectedId={selectedPlan?.id}
          onSelectPlan={onSelectPlan}
          isPro={isPro}
          mode={mode}
          onNewPlan={onNewPlan}
          onUpload={onUpload}
          onHistory={onHistory}
          onNavigate={onNavigate}
          onShowPricing={onShowPricing}
          splitPlanId={splitPlanId}
          onOpenInSplitView={onOpenInSplitView}
          onCloseSplit={onCloseSplit}
          planState={planState}
          onToggleOutline={onToggleOutline}
          onToggleChart={onToggleChart}
          onDeletePlan={onDeletePlan}
          onShowChangelog={onShowChangelog}
        />
      </div>

      <div className="flex items-center justify-end gap-2.5 min-w-0 shrink-0 pr-4">
        {onSwitchMode && (
          <>
            <div
              role="group"
              aria-label="Plan source"
              className="flex items-center rounded-lg border border-border p-0.5"
            >
              {(['cloud', 'local'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={mode === value}
                  onClick={() => onSwitchMode(value)}
                  className={`rounded-[6px] px-2.5 py-1 text-[12px] font-medium capitalize transition-colors duration-150 ${
                    mode === value
                      ? 'bg-hover text-text'
                      : 'bg-transparent text-tertiary hover:text-text'
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
            <div className="w-px h-4 bg-border" />
          </>
        )}
        {onManageSources && (
          <>
            <button
              type="button"
              onClick={onManageSources}
              aria-label="Manage plan sources"
              title="Manage plan sources"
              className="agendex-topbar-button w-[30px] h-[30px] rounded-lg border border-border bg-transparent text-tertiary cursor-pointer flex items-center justify-center"
            >
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
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            </button>
            <div className="w-px h-4 bg-border" />
          </>
        )}
        <MachinesIndicator devices={daemonDevices} aggregateStatus={daemonAggregateStatus} />
        <div className="w-px h-4 bg-border" />
        <ThemeToggle />
        <SubscriptionBadge />
        <AuthButton />
        <div className="w-px h-4 bg-border" />
        <StatusPopover
          mode={mode}
          backendIndicator={backendIndicator}
          totalPlans={totalPlans}
          activeAgents={activeAgents}
        />
      </div>
    </div>
  );
}
