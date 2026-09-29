import {
  checklistFromSummary,
  extractPlanChecklist,
  type PlanChecklist,
} from '@agendex/shared/plan-checklist';
import type { PlanReceiptSummary } from '@agendex/shared/receipts';
import type { Plan } from './api.ts';
import { receiptSummaryForPlan } from './plan-receipt-format.ts';

export const MORNING_BRIEF_DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;
export const MORNING_BRIEF_MAX_LOOKBACK_MS = 7 * MORNING_BRIEF_DEFAULT_LOOKBACK_MS;

const ACTIVITY_POINT_LIMIT = 48;
const PICKUP_LIMIT = 4;
const RELAY_LIMIT = 5;
const CLOSED_LOOP_LIMIT = 3;

export type BriefPlanActivity = {
  plan: Plan;
  occurredAt: number;
  kind: 'created' | 'updated';
  checklist: PlanChecklist;
};

export type BriefWorkspaceRelay = {
  workspace: string;
  agents: string[];
  plans: Plan[];
  occurredAt: number;
};

/** A plan that finished in the window, and the evidence that says so. */
export type BriefClosedLoop = {
  plan: Plan;
  occurredAt: number;
  evidence: { kind: 'landed'; commits: number } | { kind: 'checklist'; steps: number };
};

/** Receipt summaries keyed by local plan id, as served by `GET /api/v1/receipts`. */
export type BriefReceipts = Readonly<Record<string, PlanReceiptSummary>>;

export type MorningBriefSnapshot = {
  since: number;
  until: number;
  activity: BriefPlanActivity[];
  pickups: BriefPlanActivity[];
  closedLoops: BriefClosedLoop[];
  relays: BriefWorkspaceRelay[];
  planCount: number;
  /** Plans whose attributed commits reached the default branch in the window. */
  landedCount: number;
  newPlanCount: number;
  updatedPlanCount: number;
  agentCount: number;
  workspaceCount: number;
};

function timestamp(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** "Landed · 4 commits" or "All 6 steps done". */
export function closedLoopEvidenceLabel(loop: BriefClosedLoop): string {
  const { evidence } = loop;
  if (evidence.kind === 'landed') {
    return `Landed · ${evidence.commits} commit${evidence.commits === 1 ? '' : 's'}`;
  }
  return evidence.steps === 1 ? '1 step done' : `All ${evidence.steps} steps done`;
}

/**
 * The mark-read button. Reading persists `until` as the next brief's start, so it waits for the
 * first receipt answer: marking read earlier would skip landings the brief never showed.
 */
export function morningBriefMarkReadState(state: {
  loading: boolean;
  error: boolean;
  markedRead: boolean;
  receiptsLoading: boolean;
  caughtUp: boolean;
}): { disabled: boolean; label: string } {
  if (state.markedRead) return { disabled: true, label: 'Brief read' };
  if (state.loading) return { disabled: true, label: 'Building brief' };
  if (state.error) return { disabled: true, label: 'Brief unavailable' };
  if (state.receiptsLoading) return { disabled: true, label: 'Checking git history' };
  if (state.caughtUp) return { disabled: true, label: 'Brief is current' };
  return { disabled: false, label: 'Mark brief read' };
}

/** Landed plans in `(since, until]`, from receipt evidence alone. */
function landedLoops(
  plans: readonly Plan[],
  receipts: BriefReceipts | undefined,
  since: number,
  until: number,
): BriefClosedLoop[] {
  if (!receipts) return [];
  const loops: BriefClosedLoop[] = [];
  for (const plan of plans) {
    const receipt = receiptSummaryForPlan(receipts, plan);
    const landedAt = receipt?.landedAt ? timestamp(receipt.landedAt) : undefined;
    if (!receipt || landedAt === undefined || landedAt <= since || landedAt > until) continue;
    loops.push({
      plan,
      occurredAt: landedAt,
      evidence: { kind: 'landed', commits: receipt.commits },
    });
  }
  return loops;
}

export function resolveMorningBriefSince(lastReadAt: number | null, now = Date.now()): number {
  const defaultSince = now - MORNING_BRIEF_DEFAULT_LOOKBACK_MS;
  if (lastReadAt === null || !Number.isFinite(lastReadAt) || lastReadAt <= 0 || lastReadAt > now) {
    return defaultSince;
  }
  return Math.max(lastReadAt, now - MORNING_BRIEF_MAX_LOOKBACK_MS);
}

function planActivity(plan: Plan, since: number, until: number): BriefPlanActivity | undefined {
  const createdAt = timestamp(plan.createdAt);
  const updatedAt = timestamp(plan.updatedAt);
  const occurredAt = updatedAt ?? createdAt;
  if (occurredAt === undefined || occurredAt <= since || occurredAt > until) return undefined;

  return {
    plan,
    occurredAt,
    kind:
      createdAt !== undefined && createdAt > since && createdAt <= until ? 'created' : 'updated',
    // Cloud list rows ship a checklist summary instead of content.
    checklist: plan.checklist
      ? checklistFromSummary(plan.checklist)
      : extractPlanChecklist(plan.content),
  };
}

function sampleActivityPoints(
  activitiesNewestFirst: BriefPlanActivity[],
  limit: number,
): BriefPlanActivity[] {
  const chronological = [...activitiesNewestFirst].reverse();
  if (chronological.length <= limit) return chronological;

  const sampled: BriefPlanActivity[] = [];
  const lastIndex = chronological.length - 1;
  for (let index = 0; index < limit; index++) {
    const sourceIndex = Math.round((index * lastIndex) / (limit - 1));
    const activity = chronological[sourceIndex];
    if (activity && sampled.at(-1)?.plan.id !== activity.plan.id) sampled.push(activity);
  }
  return sampled;
}

function buildRelays(activities: BriefPlanActivity[]): BriefWorkspaceRelay[] {
  const byWorkspace = new Map<string, BriefPlanActivity[]>();

  for (const activity of activities) {
    const workspace = activity.plan.workspace?.trim();
    if (!workspace) continue;
    const existing = byWorkspace.get(workspace);
    if (existing) existing.push(activity);
    else byWorkspace.set(workspace, [activity]);
  }

  const relays: BriefWorkspaceRelay[] = [];
  for (const [workspace, workspaceActivities] of byWorkspace) {
    const agents = [...new Set(workspaceActivities.map((activity) => activity.plan.agent))];
    if (agents.length < 2) continue;

    const uniquePlans: Plan[] = [];
    const seenPlanIds = new Set<string>();
    for (const activity of workspaceActivities) {
      if (seenPlanIds.has(activity.plan.id)) continue;
      seenPlanIds.add(activity.plan.id);
      uniquePlans.push(activity.plan);
    }

    relays.push({
      workspace,
      agents,
      plans: uniquePlans,
      occurredAt: Math.max(...workspaceActivities.map((activity) => activity.occurredAt)),
    });
  }

  return relays.sort((a, b) => b.occurredAt - a.occurredAt).slice(0, RELAY_LIMIT);
}

/**
 * `receipts` (keyed by local plan id) adds git evidence: a plan that landed in the window is a
 * closed loop even when its file never changed, and a plan with a usable receipt is judged by
 * it rather than by its checklist.
 */
export function buildMorningBrief(
  plans: readonly Plan[],
  since: number,
  until = Date.now(),
  receipts?: BriefReceipts,
): MorningBriefSnapshot {
  const activities = plans
    .map((plan) => planActivity(plan, since, until))
    .filter((activity): activity is BriefPlanActivity => Boolean(activity))
    .sort((a, b) => b.occurredAt - a.occurredAt);

  const landed = landedLoops(plans, receipts, since, until);
  const landedIds = new Set(landed.map((loop) => loop.plan.id));
  const incomplete = activities.filter(
    (activity) =>
      activity.checklist.total > 0 &&
      activity.checklist.remaining > 0 &&
      !landedIds.has(activity.plan.id),
  );
  const withoutTasks = activities.filter(
    (activity) => activity.checklist.total === 0 && !landedIds.has(activity.plan.id),
  );
  const pickups = [...incomplete, ...withoutTasks].slice(0, PICKUP_LIMIT);
  const checklistLoops = activities
    .filter((activity) => {
      const { checklist } = activity;
      if (checklist.total === 0 || checklist.completed !== checklist.total) return false;
      const receipt = receiptSummaryForPlan(receipts, activity.plan);
      return !receipt || receipt.status === 'unavailable';
    })
    .map(
      (activity): BriefClosedLoop => ({
        plan: activity.plan,
        occurredAt: activity.occurredAt,
        evidence: { kind: 'checklist', steps: activity.checklist.total },
      }),
    );
  const closedLoops = [...landed, ...checklistLoops]
    .sort((a, b) => b.occurredAt - a.occurredAt)
    .slice(0, CLOSED_LOOP_LIMIT);

  const agents = new Set(activities.map((activity) => activity.plan.agent));
  const workspaces = new Set(
    activities
      .map((activity) => activity.plan.workspace?.trim())
      .filter((workspace): workspace is string => Boolean(workspace)),
  );
  const newPlanCount = activities.filter((activity) => activity.kind === 'created').length;

  return {
    since,
    until,
    activity: sampleActivityPoints(activities, ACTIVITY_POINT_LIMIT),
    pickups,
    closedLoops,
    relays: buildRelays(activities),
    planCount: activities.length,
    landedCount: landed.length,
    newPlanCount,
    updatedPlanCount: activities.length - newPlanCount,
    agentCount: agents.size,
    workspaceCount: workspaces.size,
  };
}

export function hasMorningBriefUpdates(
  plans: readonly Plan[],
  since: number,
  until = Date.now(),
  receipts?: BriefReceipts,
): boolean {
  return (
    plans.some((plan) => {
      const occurredAt = timestamp(plan.updatedAt) ?? timestamp(plan.createdAt);
      return occurredAt !== undefined && occurredAt > since && occurredAt <= until;
    }) || landedLoops(plans, receipts, since, until).length > 0
  );
}
