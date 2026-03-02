import { ThemeToggle, type Plan } from '@agendex/web';
import { AuthButton } from './AuthButton';
import { CommandPalette } from './command-palette/CommandPalette';
import { SubscriptionBadge } from './SubscriptionBadge';
import { BrandSection } from './topbar/BrandSection';
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
  onToggleMode,
  onNavigate,
  onShowPricing,
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
  onToggleMode: () => void;
  onNavigate: (path: string) => void;
  onShowPricing: () => void;
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
          onNavigate={onNavigate}
          onShowPricing={onShowPricing}
        />
      </div>

      <div className="flex items-center justify-end gap-2.5 min-w-0 shrink-0 pr-4">
        <ThemeToggle />
        <SubscriptionBadge />
        <AuthButton />
        <div className="w-px h-4 bg-border" />
        <StatusPopover
          mode={mode}
          backendIndicator={backendIndicator}
          totalPlans={totalPlans}
          activeAgents={activeAgents}
          onToggleMode={onToggleMode}
        />
      </div>
    </div>
  );
}
