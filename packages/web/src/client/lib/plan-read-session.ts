import type { PlanReadResult } from '@agendex/shared/plan-read';
import type { Plan } from './api.ts';
import { canReadPlan, type PlanReadSource } from './plan-read-context.tsx';

// Coalesce StrictMode's simultaneous effects, but never replay a settled read on a later opening.
const pending = new Map<string, Promise<PlanReadResult>>();
export function requestPlanRead(
  key: string,
  source: PlanReadSource,
  plan: Plan,
  timeoutMs = 15_000,
): Promise<PlanReadResult> | null {
  if (!canReadPlan(source, plan) || plan.contentLoaded === false) return null;
  const existing = pending.get(key);
  if (existing) return existing;
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<PlanReadResult>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('Remembered revision request timed out. Reopen the plan to retry.')),
      timeoutMs,
    );
  });
  const result = Promise.race([
    new Promise<PlanReadResult>((resolve) => resolve(source.open(plan))),
    timeout,
  ]);
  pending.set(key, result);
  const done = () => {
    clearTimeout(timer);
    if (pending.get(key) === result) pending.delete(key);
  };
  void result.then(done, done);
  return result;
}
export function readSummary(result: PlanReadResult, plan: Pick<Plan, 'title' | 'content'>): string {
  if (result.reason === 'too-large')
    return 'This plan is too large to remember for read comparisons.';
  if (result.reason === 'unavailable')
    return 'The previously read snapshot is no longer available. This revision is now remembered.';
  if (!result.baseline)
    return 'No earlier read snapshot. This revision is now remembered for your next visit.';
  return result.baseline.title !== plan.title || result.baseline.content !== plan.content
    ? 'Changes available since your previous read.'
    : 'Title and content are unchanged since your previous read.';
}
/** Pending requests and effect results must follow the same source boundary as storage. */
export function readRevisionKey(scope: string | undefined, plan: Plan): string {
  return JSON.stringify([
    scope,
    plan.ownerId,
    plan.id,
    plan.agent,
    plan.filePath,
    plan.workspace,
    plan.updatedAt,
    plan.title,
    plan.content,
  ]);
}

/** A live revision refresh is part of the same visit, not another read. */
export function readVisitKey(scope: string | undefined, plan: Plan): string {
  return JSON.stringify([scope, plan.ownerId, plan.id, plan.agent, plan.filePath, plan.workspace]);
}
