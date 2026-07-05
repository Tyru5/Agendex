import { type Plan, type PlanState, ThemeToggle } from '@agendex/web';
import type { ReactNode } from 'react';
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
  onSwitchMode,
  sidebarWidth: sidebarWidthProp,
  actions,
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
  onSwitchMode?: (mode: 'local' | 'cloud') => void;
  sidebarWidth?: number;
  /** Extra controls rendered at the start of the right cluster. */
  actions?: ReactNode;
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
        {actions}
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
