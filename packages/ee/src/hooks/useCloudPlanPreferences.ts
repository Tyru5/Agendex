import type { PlanState, PlanStatePlan } from '@agendex/web';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useMutation, useQuery } from 'convex/react';
import { useCallback, useEffect, useMemo, useState } from 'react';

type OverlayEntry = {
  pinned?: boolean;
  lastSeenUpdatedAt?: number | null;
};

function updatedAtToMs(updatedAt: string) {
  return new Date(updatedAt).getTime();
}

export function useCloudPlanPreferences(): PlanState & { isReady: boolean } {
  const preferences = useQuery(api.planPreferences.listForMyPlans, {});
  const setPinnedMutation = useMutation(api.planPreferences.setPinned);
  const markSeenMutation = useMutation(api.planPreferences.markSeen);
  const markUnseenMutation = useMutation(api.planPreferences.markUnseen);
  const markManySeenMutation = useMutation(api.planPreferences.markManySeen);
  const [overlay, setOverlay] = useState<Record<string, OverlayEntry>>({});

  const basePreferences = useMemo(() => {
    const entries = preferences ?? [];
    const next = new Map<string, { pinned: boolean; lastSeenUpdatedAt?: number }>();
    for (const preference of entries) {
      next.set(preference.planId, {
        pinned: preference.pinned,
        lastSeenUpdatedAt: preference.lastSeenUpdatedAt,
      });
    }
    return next;
  }, [preferences]);

  useEffect(() => {
    if (preferences === undefined) return;
    setOverlay((current) => {
      let changed = false;
      const next = { ...current };
      for (const [planId, value] of Object.entries(current)) {
        const base = basePreferences.get(planId);
        const pinnedMatches =
          value.pinned === undefined || value.pinned === (base?.pinned ?? false);
        const seenMatches =
          value.lastSeenUpdatedAt === undefined ||
          value.lastSeenUpdatedAt === (base?.lastSeenUpdatedAt ?? null);
        if (pinnedMatches && seenMatches) {
          delete next[planId];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [basePreferences, preferences]);

  const getResolvedPreference = useCallback(
    (planId: string) => {
      const base = basePreferences.get(planId);
      const next = overlay[planId];
      return {
        pinned: next?.pinned ?? base?.pinned ?? false,
        lastSeenUpdatedAt:
          next?.lastSeenUpdatedAt === undefined
            ? (base?.lastSeenUpdatedAt ?? null)
            : next.lastSeenUpdatedAt,
      };
    },
    [basePreferences, overlay],
  );

  const isUnseen = useCallback(
    (planId: string, updatedAt: string) => {
      const hasLoaded = preferences !== undefined;
      const hasOverlay = overlay[planId] !== undefined;
      if (!hasLoaded && !hasOverlay) return false;
      return getResolvedPreference(planId).lastSeenUpdatedAt !== updatedAtToMs(updatedAt);
    },
    [getResolvedPreference, overlay, preferences],
  );

  const markSeen = useCallback(
    (planId: string, updatedAt: string) => {
      const updatedAtMs = updatedAtToMs(updatedAt);
      setOverlay((current) => ({
        ...current,
        [planId]: {
          ...current[planId],
          lastSeenUpdatedAt: updatedAtMs,
        },
      }));
      markSeenMutation({ planId: planId as Id<'plans'> }).catch((error) => {
        console.error('failed to mark plan seen', error);
        setOverlay((current) => {
          const next = { ...current };
          const entry = next[planId];
          if (!entry) return current;
          if (entry.pinned === undefined) {
            delete next[planId];
          } else {
            next[planId] = { pinned: entry.pinned, lastSeenUpdatedAt: undefined };
          }
          return next;
        });
      });
    },
    [markSeenMutation],
  );

  const markUnseen = useCallback(
    (planId: string) => {
      setOverlay((current) => ({
        ...current,
        [planId]: {
          ...current[planId],
          lastSeenUpdatedAt: null,
        },
      }));
      markUnseenMutation({ planId: planId as Id<'plans'> }).catch((error) => {
        console.error('failed to mark plan unseen', error);
        setOverlay((current) => {
          const next = { ...current };
          const entry = next[planId];
          if (!entry) return current;
          if (entry.pinned === undefined) {
            delete next[planId];
          } else {
            next[planId] = { pinned: entry.pinned, lastSeenUpdatedAt: undefined };
          }
          return next;
        });
      });
    },
    [markUnseenMutation],
  );

  const markAllSeen = useCallback(
    (plans: PlanStatePlan[]) => {
      const updatedEntries = Object.fromEntries(
        plans.map((plan) => [
          plan.id,
          {
            lastSeenUpdatedAt: updatedAtToMs(plan.updatedAt),
          } satisfies OverlayEntry,
        ]),
      );
      setOverlay((current) => {
        const next = { ...current };
        for (const [planId, value] of Object.entries(updatedEntries)) {
          next[planId] = { ...next[planId], ...value };
        }
        return next;
      });
      markManySeenMutation({ planIds: plans.map((plan) => plan.id as Id<'plans'>) }).catch(
        (error) => {
          console.error('failed to mark plans seen', error);
          setOverlay((current) => {
            const next = { ...current };
            for (const plan of plans) {
              const entry = next[plan.id];
              if (!entry) continue;
              if (entry.pinned === undefined) {
                delete next[plan.id];
              } else {
                next[plan.id] = { pinned: entry.pinned, lastSeenUpdatedAt: undefined };
              }
            }
            return next;
          });
        },
      );
    },
    [markManySeenMutation],
  );

  const isPinned = useCallback(
    (planId: string) => getResolvedPreference(planId).pinned,
    [getResolvedPreference],
  );

  const setPinned = useCallback(
    (planId: string, pinned: boolean) => {
      setOverlay((current) => ({
        ...current,
        [planId]: {
          ...current[planId],
          pinned,
        },
      }));
      setPinnedMutation({ planId: planId as Id<'plans'>, pinned }).catch((error) => {
        console.error('failed to set plan pinned state', error);
        setOverlay((current) => {
          const next = { ...current };
          const entry = next[planId];
          if (!entry) return current;
          if (entry.lastSeenUpdatedAt === undefined) {
            delete next[planId];
          } else {
            next[planId] = { pinned: undefined, lastSeenUpdatedAt: entry.lastSeenUpdatedAt };
          }
          return next;
        });
      });
    },
    [setPinnedMutation],
  );

  return useMemo(
    () => ({
      isUnseen,
      markSeen,
      markUnseen,
      markAllSeen,
      isPinned,
      setPinned,
      isReady: preferences !== undefined,
    }),
    [isUnseen, markSeen, markUnseen, markAllSeen, isPinned, setPinned, preferences],
  );
}
