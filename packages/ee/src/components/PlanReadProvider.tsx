import { ownedPlanReadSource } from '../lib/owned-plan-read-source.ts';
import { localPlanReadSource, PlanReadContext, type PlanReadSource } from '@agendex/web';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useMutation } from 'convex/react';
import { type ReactNode, useMemo } from 'react';
export function PlanReadProvider({
  mode,
  userId,
  children,
}: {
  mode: 'local' | 'cloud';
  userId?: string;
  children: ReactNode;
}) {
  const open = useMutation(api.planReads.open);
  const clear = useMutation(api.planReads.clear);
  const source = useMemo<PlanReadSource>(
    () =>
      mode === 'local'
        ? localPlanReadSource
        : ownedPlanReadSource(
            userId,
            (plan) =>
              open({
                planId: plan.id as Id<'plans'>,
                updatedAt: new Date(plan.updatedAt).getTime(),
                title: plan.title,
                content: plan.content,
              }),
            (plan) => clear({ planId: plan.id as Id<'plans'> }),
          ),
    [mode, userId, open, clear],
  );
  return <PlanReadContext.Provider value={source}>{children}</PlanReadContext.Provider>;
}
