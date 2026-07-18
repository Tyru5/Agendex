import { useMemo } from 'react';
import type { Plan } from '../lib/api.ts';
import type { PlanState } from '../lib/plan-state.ts';
import { focusPlanSearchField } from './PlanSearchField.tsx';

type SearchBarProps = {
  onFocusSearch?: () => void;
  search?: string;
  onSearch?: (q: string) => void;
  plans?: Plan[];
  selectedId?: string;
  onSelectPlan?: (plan: Plan) => void;
  splitPlanId?: string;
  onOpenInSplitView?: (plan: Plan) => void;
  isPro?: boolean;
  planState?: PlanState;
};

export function SearchBar({ onFocusSearch }: SearchBarProps) {
  const shortcutLabel = useMemo(() => {
    if (typeof navigator === 'undefined') return 'Mod K';
    return /Mac|iPhone|iPad/i.test(navigator.platform) ? '⌘K' : 'Ctrl K';
  }, []);

  return (
    <button
      type="button"
      onClick={() => {
        onFocusSearch?.();
        focusPlanSearchField();
      }}
      className="agendex-topbar-button flex items-center gap-2 rounded-lg py-[5px] px-2 border border-border min-w-0 w-full max-w-[150px] overflow-hidden cursor-pointer"
    >
      <SearchIcon />
      <span className="text-[12px] flex-1 min-w-0 text-left whitespace-nowrap overflow-hidden text-ellipsis">
        Search
      </span>
      <kbd className="font-[inherit] text-[10px] leading-none shrink-0 text-tertiary border border-border rounded-[4px] py-[3px] px-1 bg-hover">
        {shortcutLabel}
      </kbd>
    </button>
  );
}

function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      className="w-3.5 h-3.5 text-tertiary"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m21 21-4.35-4.35m1.85-5.15a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z"
      />
    </svg>
  );
}
