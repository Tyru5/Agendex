import { localPlanReadSource, PlanReadContext, type PlanReadSource } from '@agendex/web';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useMutation } from 'convex/react';
import { type ReactNode, useMemo } from 'react';
export function PlanReadProvider({
  mode,
  children,
}: {
  mode: 'local' | 'cloud';
  children: ReactNode;
}) {
  const open = useMutation(api.planReads.open);
  const clear = useMutation(api.planReads.clear);
  const source = useMemo<PlanReadSource>(
    () =>
      mode === 'local'
        ? localPlanReadSource
        : {
            scope: 'cloud',
            open: (plan) =>
              open({
                planId: plan.id as Id<'plans'>,
                updatedAt: new Date(plan.updatedAt).getTime(),
                title: plan.title,
                content: plan.content,
              }),
            clear: (plan) => clear({ planId: plan.id as Id<'plans'> }),
          },
    [mode, open, clear],
  );
  return <PlanReadContext.Provider value={source}>{children}</PlanReadContext.Provider>;
}
