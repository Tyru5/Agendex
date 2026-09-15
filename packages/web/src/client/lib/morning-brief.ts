import type { Plan } from './api.ts';

export const MORNING_BRIEF_DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;
export const MORNING_BRIEF_MAX_LOOKBACK_MS = 7 * MORNING_BRIEF_DEFAULT_LOOKBACK_MS;

const ACTIVITY_POINT_LIMIT = 48;
const PICKUP_LIMIT = 4;
const RELAY_LIMIT = 5;
const CLOSED_LOOP_LIMIT = 3;

export type BriefChecklist = {
  total: number;
  completed: number;
  remaining: number;
  nextStep?: string;
};

export type BriefPlanActivity = {
  plan: Plan;
  occurredAt: number;
  kind: 'created' | 'updated';
  checklist: BriefChecklist;
};

export type BriefWorkspaceRelay = {
  workspace: string;
  agents: string[];
  plans: Plan[];
  occurredAt: number;
};

export type MorningBriefSnapshot = {
  since: number;
  until: number;
  activity: BriefPlanActivity[];
  pickups: BriefPlanActivity[];
  closedLoops: BriefPlanActivity[];
  relays: BriefWorkspaceRelay[];
  planCount: number;
  newPlanCount: number;
  updatedPlanCount: number;
  agentCount: number;
  workspaceCount: number;
};

function timestamp(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function cleanTaskLabel(value: string): string {
  return value
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractBriefChecklist(content: string): BriefChecklist {
  const taskPattern = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])]\s+(.+?)\s*$/gm;
  let total = 0;
  let completed = 0;
  let nextStep: string | undefined;

  for (const match of content.matchAll(taskPattern)) {
    total++;
    const isCompleted = match[1]?.toLowerCase() === 'x';
    if (isCompleted) {
      completed++;
      continue;
    }
    if (!nextStep) {
      const label = cleanTaskLabel(match[2] ?? '');
      if (label) nextStep = label;
    }
  }

  return {
    total,
    completed,
    remaining: Math.max(0, total - completed),
    nextStep,
  };
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
    checklist: extractBriefChecklist(plan.content),
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

export function buildMorningBrief(
  plans: readonly Plan[],
  since: number,
  until = Date.now(),
): MorningBriefSnapshot {
  const activities = plans
    .map((plan) => planActivity(plan, since, until))
    .filter((activity): activity is BriefPlanActivity => Boolean(activity))
    .sort((a, b) => b.occurredAt - a.occurredAt);

  const incomplete = activities.filter(
    (activity) => activity.checklist.total > 0 && activity.checklist.remaining > 0,
  );
  const withoutTasks = activities.filter((activity) => activity.checklist.total === 0);
  const pickups = [...incomplete, ...withoutTasks].slice(0, PICKUP_LIMIT);
  const closedLoops = activities
    .filter(
      (activity) =>
        activity.checklist.total > 0 && activity.checklist.completed === activity.checklist.total,
    )
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
): boolean {
  return plans.some((plan) => {
    const occurredAt = timestamp(plan.updatedAt) ?? timestamp(plan.createdAt);
    return occurredAt !== undefined && occurredAt > since && occurredAt <= until;
  });
}
