import type { Plan } from '@agendex/web';
import { type ReactNode, useCallback, useMemo, useState } from 'react';

export interface Command {
  id: string;
  label: string;
  group: 'actions' | 'plans' | 'settings' | 'support';
  icon: ReactNode;
  footerHint: string;
  proOnly?: boolean;
  closeOnSelect?: boolean;
  action: () => void;
}

export interface FlatItem {
  type: 'command' | 'plan' | 'group-header';
  command?: Command;
  plan?: Plan;
  groupLabel?: string;
}

const GROUP_ORDER: Command['group'][] = ['actions', 'plans', 'settings', 'support'];
const GROUP_LABELS: Record<Command['group'], string> = {
  actions: '',
  plans: 'Plans',
  settings: 'Settings',
  support: 'Support',
};

function getFlatItemKey(item: FlatItem): string | null {
  if (item.type === 'command' && item.command) return `command:${item.command.id}`;
  if (item.type === 'plan' && item.plan) return `plan:${item.plan.id}`;
  return null;
}

export function useCommandItems({
  commands,
  filteredPlans,
  search,
  selectedPlanId: _selectedPlanId,
  isPro: _isPro,
  onClose,
  onSelectPlan,
  onOpenInSplitView,
  planLimit = Number.POSITIVE_INFINITY,
  onRequestMorePlans,
}: {
  commands: Command[];
  filteredPlans: Plan[];
  search: string;
  selectedPlanId: string | undefined;
  isPro: boolean;
  onClose: () => void;
  onSelectPlan?: (plan: Plan) => void;
  onOpenInSplitView?: (plan: Plan) => void;
  planLimit?: number;
  onRequestMorePlans?: () => void;
}) {
  const [focusedIndex, setFocusedIndex] = useState(0);

  const filteredCommands = useMemo(() => {
    if (!search.trim()) return commands;
    const q = search.toLowerCase();
    return commands.filter((command) => command.label.toLowerCase().includes(q));
  }, [commands, search]);

  const visiblePlans = useMemo(() => filteredPlans.slice(0, planLimit), [filteredPlans, planLimit]);

  const flatItems = useMemo(() => {
    const items: FlatItem[] = [];

    for (const group of GROUP_ORDER) {
      const groupCmds = filteredCommands.filter((c) => c.group === group);
      if (groupCmds.length === 0) continue;

      const label = GROUP_LABELS[group];
      if (label) {
        items.push({ type: 'group-header', groupLabel: label });
      }
      for (const cmd of groupCmds) {
        items.push({ type: 'command', command: cmd });
      }
    }

    if (visiblePlans.length > 0) {
      items.push({ type: 'group-header', groupLabel: `Results (${filteredPlans.length})` });
      for (const plan of visiblePlans) {
        items.push({ type: 'plan', plan });
      }
    }

    return items;
  }, [filteredCommands, visiblePlans, filteredPlans.length]);

  const focusableItems = useMemo(
    () => flatItems.filter((item) => item.type !== 'group-header'),
    [flatItems],
  );

  const focusableIndexByKey = useMemo(() => {
    const indexByKey = new Map<string, number>();

    for (const [index, item] of focusableItems.entries()) {
      const key = getFlatItemKey(item);
      if (key) indexByKey.set(key, index);
    }

    return indexByKey;
  }, [focusableItems]);

  const focusedItem = focusableItems[focusedIndex];
  const footerHint =
    focusedItem?.command?.footerHint ?? (focusedItem?.plan ? 'Open plan · ⇧⏎ Split view' : '');

  const executeItem = useCallback(
    (item: FlatItem) => {
      if (item.type === 'command' && item.command) {
        item.command.action();
        if (item.command.closeOnSelect !== false) onClose();
      } else if (item.type === 'plan' && item.plan && onSelectPlan) {
        onSelectPlan(item.plan);
        onClose();
      }
    },
    [onClose, onSelectPlan],
  );

  const getFocusableIndex = useCallback(
    (item: FlatItem) => {
      const key = getFlatItemKey(item);
      return key ? (focusableIndexByKey.get(key) ?? -1) : -1;
    },
    [focusableIndexByKey],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Vim-style motions: Ctrl+N (down) / Ctrl+P (up) mirror the arrow keys.
      const isVimNext = e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'n';
      const isVimPrev = e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'p';

      if (e.key === 'ArrowDown' || isVimNext) {
        e.preventDefault();
        setFocusedIndex((i) => {
          const next = Math.min(i + 1, focusableItems.length - 1);
          if (next === focusableItems.length - 1) {
            onRequestMorePlans?.();
          }
          return next;
        });
      } else if (e.key === 'ArrowUp' || isVimPrev) {
        e.preventDefault();
        setFocusedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (focusedItem) {
          if (e.shiftKey && focusedItem.type === 'plan' && focusedItem.plan && onOpenInSplitView) {
            onOpenInSplitView(focusedItem.plan);
            onClose();
          } else {
            executeItem(focusedItem);
          }
        }
      }
    },
    [
      focusableItems.length,
      focusedItem,
      executeItem,
      onOpenInSplitView,
      onClose,
      onRequestMorePlans,
    ],
  );

  const resetFocus = useCallback(() => setFocusedIndex(0), []);

  return {
    flatItems,
    focusableItems,
    focusedIndex,
    setFocusedIndex,
    focusedItem,
    footerHint,
    onKeyDown,
    resetFocus,
    getFocusableIndex,
    executeItem,
    hasMorePlans: visiblePlans.length < filteredPlans.length,
    visiblePlanCount: visiblePlans.length,
    filteredPlansCount: filteredPlans.length,
  };
}
