import { filterPlans, type Plan } from '@agendex/web';
import { type ReactNode, useCallback, useMemo, useState } from 'react';

export interface Command {
  id: string;
  label: string;
  group: 'actions' | 'plans' | 'settings' | 'support';
  icon: ReactNode;
  footerHint: string;
  proOnly?: boolean;
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

export function useCommandItems({
  commands,
  plans,
  search,
  selectedPlanId,
  isPro,
  onClose,
  onSelectPlan,
}: {
  commands: Command[];
  plans: Plan[];
  search: string;
  selectedPlanId: string | undefined;
  isPro: boolean;
  onClose: () => void;
  onSelectPlan?: (plan: Plan) => void;
}) {
  const [focusedIndex, setFocusedIndex] = useState(0);

  const filteredCommands = useMemo(() => {
    if (!search.trim()) return commands;
    const q = search.toLowerCase();
    return commands.filter((c) => c.label.toLowerCase().includes(q));
  }, [commands, search]);

  const filteredPlans = useMemo(() => filterPlans(plans, search), [plans, search]);

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

    if (filteredPlans.length > 0) {
      items.push({ type: 'group-header', groupLabel: `Results (${filteredPlans.length})` });
      for (const plan of filteredPlans) {
        items.push({ type: 'plan', plan });
      }
    }

    return items;
  }, [filteredCommands, filteredPlans]);

  const focusableItems = useMemo(
    () => flatItems.filter((item) => item.type !== 'group-header'),
    [flatItems],
  );

  const focusedItem = focusableItems[focusedIndex];
  const footerHint = focusedItem?.command?.footerHint ?? (focusedItem?.plan ? 'Open plan' : '');

  const executeItem = useCallback(
    (item: FlatItem) => {
      if (item.type === 'command' && item.command) {
        item.command.action();
        onClose();
      } else if (item.type === 'plan' && item.plan && onSelectPlan) {
        onSelectPlan(item.plan);
        onClose();
      }
    },
    [onClose, onSelectPlan],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex((i) => Math.min(i + 1, focusableItems.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (focusedItem) {
          executeItem(focusedItem);
        }
      }
    },
    [focusableItems.length, focusedItem, executeItem],
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
    filteredPlans,
  };
}
