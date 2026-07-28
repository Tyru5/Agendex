import { type Plan, type PlanState } from '@agendex/web';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import type { DaemonDeviceInfo } from '../hooks/useDaemonStatus';
import {
  getDesktopPageZoomFactor,
  isDesktop,
  resetDesktopPageZoom,
  subscribeDesktopPageZoom,
} from '../lib/desktop';
import { AuthButton } from './AuthButton';
import { CommandPalette } from './command-palette/CommandPalette';
import { SubscriptionBadge } from './SubscriptionBadge';
import { BrandSection } from './topbar/BrandSection';
import { SystemStatusMenu } from './topbar/SystemStatusMenu';

function DesktopPageZoomIndicator() {
  const desktop = isDesktop();
  const [zoomPercent, setZoomPercent] = useState(() =>
    Math.round(getDesktopPageZoomFactor() * 100),
  );

  useEffect(() => {
    if (!desktop) return;
    const updateZoom = (factor = getDesktopPageZoomFactor()) =>
      setZoomPercent(Math.round(factor * 100));
    const onResize = () => updateZoom();
    // Keep resize as a fallback; menu/shortcut zoom is forwarded via preload.
    window.addEventListener('resize', onResize);
    const unsubscribe = subscribeDesktopPageZoom(updateZoom);
    return () => {
      window.removeEventListener('resize', onResize);
      unsubscribe();
    };
  }, [desktop]);

  if (!desktop || zoomPercent === 100) return null;

  return (
    <button
      type="button"
      onClick={() => {
        resetDesktopPageZoom();
      }}
      aria-label={`Page zoom: ${zoomPercent}%. Reset to 100%`}
      title="Reset page zoom to 100%"
      className="agendex-topbar-button agendex-topbar-control h-[30px] shrink-0 rounded-lg border border-border bg-transparent px-2 text-[11px] font-medium tabular-nums cursor-pointer"
    >
      {zoomPercent}%
    </button>
  );
}

export function DashboardTopbar({
  sidebarPinnedOpen,
  sidebarVisible,
  sidebarHidden,
  isPro,
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
  sidebarVisible: boolean;
  sidebarHidden: boolean;
  isPro: boolean;
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
  /** Extra controls rendered before the system status control. */
  actions?: ReactNode;
}) {
  return (
    <div
      className="agendex-topbar flex items-center min-w-0 col-span-full border-b border-border z-50 box-border"
      style={{ height: `${height}px` }}
    >
      <BrandSection
        sidebarPinnedOpen={sidebarPinnedOpen}
        sidebarVisible={sidebarVisible}
        sidebarHidden={sidebarHidden}
        sidebarWidth={sidebarWidthProp ?? 260}
        isPro={isPro}
        mode={mode}
        backendStatus={backendStatus}
        onToggleSidebar={onToggleSidebar}
        onNewPlan={onNewPlan}
        onUpload={onUpload}
        onLogoClick={() => onSelectPlan(undefined)}
      />

      <div className="hidden md:flex flex-1 min-w-0 justify-center">
        <CommandPalette
          hideTrigger
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

      <div className="flex items-center justify-end gap-1.5 min-w-0 shrink-0 pr-4">
        {onSwitchMode && (
          <div
            role="group"
            aria-label="Plan source"
            className="flex items-center rounded-lg border border-border p-0.5 mr-0.5"
          >
            {(['cloud', 'local'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => onSwitchMode(value)}
                className={`rounded-[6px] px-2 py-1 text-[12px] font-medium capitalize transition-colors duration-150 ${
                  mode === value
                    ? 'bg-hover text-text'
                    : 'bg-transparent text-tertiary hover:text-text'
                }`}
              >
                {value}
              </button>
            ))}
          </div>
        )}

        {actions}

        <DesktopPageZoomIndicator />

        <SystemStatusMenu
          backendIndicator={backendIndicator}
          totalPlans={totalPlans}
          activeAgents={activeAgents}
          devices={daemonDevices}
          aggregateStatus={daemonAggregateStatus}
        />

        <div className="w-px h-4 bg-border mx-0.5" />

        <SubscriptionBadge />
        <AuthButton />
      </div>
    </div>
  );
}
