import { type Plan, type PlanState, ThemeToggle } from '@agendex/web';
import type { DaemonDeviceInfo } from '../hooks/useDaemonStatus';
import { AuthButton } from './AuthButton';
import { CommandPalette } from './command-palette/CommandPalette';
import { SubscriptionBadge } from './SubscriptionBadge';
import { BrandSection } from './topbar/BrandSection';
import { MachinesIndicator } from './topbar/MachinesIndicator';
import { StatusPopover } from './topbar/StatusPopover';

const SIDEBAR_EXPANDED_WIDTH = 260;

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
}) {
  return (
    <div
      className="flex items-center min-w-0 col-span-full border-b border-border bg-surface z-50 box-border"
      style={{ height: `${height}px` }}
    >
      <BrandSection
        sidebarPinnedOpen={sidebarPinnedOpen}
        sidebarHidden={sidebarHidden}
        sidebarWidth={SIDEBAR_EXPANDED_WIDTH}
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
        />
      </div>

      <div className="flex items-center justify-end gap-2.5 min-w-0 shrink-0 pr-4">
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
