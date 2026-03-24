import { useMemo } from 'react';
import type { PlanState } from '../lib/plan-state.ts';
import { usePinnedPlans } from './usePinnedPlans.ts';
import { useSeenPlans } from './useSeenPlans.ts';

export function usePlanState(): PlanState {
  const seen = useSeenPlans();
  const pinned = usePinnedPlans();

  return useMemo(
    () => ({
      isUnseen: seen.isUnseen,
      markSeen: seen.markSeen,
      markUnseen: seen.markUnseen,
      markAllSeen: seen.markAllSeen,
      isPinned: pinned.isPinned,
      setPinned: pinned.setPinned,
    }),
    [
      seen.isUnseen,
      seen.markSeen,
      seen.markUnseen,
      seen.markAllSeen,
      pinned.isPinned,
      pinned.setPinned,
    ],
  );
}
