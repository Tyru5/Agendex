import type { PlanReadResult } from '@agendex/shared/plan-read';
import { createContext } from 'react';
import { api, type Plan } from './api.ts';
export type PlanReadSource = {
  scope: string;
  /** Optional per-plan eligibility, e.g. cloud owner-only read baselines. */
  canRead?: (plan: Plan) => boolean;
  open: (plan: Plan) => Promise<PlanReadResult>;
  clear: (plan: Plan) => Promise<unknown>;
};
export const localPlanReadSource: PlanReadSource = {
  scope: 'local',
  open: api.openPlanRead,
  clear: api.clearPlanRead,
};
/** Public/shared viewers intentionally have no reader and never record private baselines. */
export const PlanReadContext = createContext<PlanReadSource | null>(null);

export function canReadPlan(source: PlanReadSource | null, plan: Plan): boolean {
  return Boolean(source && (source.canRead?.(plan) ?? true));
}
