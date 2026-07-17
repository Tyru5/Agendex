import type { Plan } from './api.ts';

export type LineageConfidence = 'session' | 'thread' | 'workspace-fallback';

export type LineageRelation = 'self' | 'peer' | 'parent' | 'child';

export type RelatedPlanEntry = {
  plan: Plan;
  relation: LineageRelation;
  confidence: LineageConfidence;
};

export type PlanLineage = {
  /** Timeline of related plans including the current plan when anything related exists. */
  items: RelatedPlanEntry[];
  parent?: RelatedPlanEntry;
  children: RelatedPlanEntry[];
  peers: RelatedPlanEntry[];
  hasRelated: boolean;
};

const WORKSPACE_FALLBACK_LIMIT = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringMeta(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

/** Reads lineage keys adapters stash on `plan.metadata`. */
export function extractLineageKeys(plan: Pick<Plan, 'metadata'>): {
  sessionId?: string;
  parentThreadId?: string;
  branch?: string;
} {
  if (!isRecord(plan.metadata)) return {};
  return {
    sessionId: stringMeta(plan.metadata, 'sessionId'),
    parentThreadId: stringMeta(plan.metadata, 'parentThreadId'),
    branch: stringMeta(plan.metadata, 'branch'),
  };
}

function dayKey(iso: string): string | undefined {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return undefined;
  return new Date(ms).toISOString().slice(0, 10);
}

function planDays(plan: Plan): Set<string> {
  const days = new Set<string>();
  const created = dayKey(plan.createdAt);
  const updated = dayKey(plan.updatedAt);
  if (created) days.add(created);
  if (updated) days.add(updated);
  return days;
}

function daysOverlap(a: Plan, b: Plan): boolean {
  const aDays = planDays(a);
  for (const day of planDays(b)) {
    if (aDays.has(day)) return true;
  }
  return false;
}

function sortByCreatedThenUpdated(a: Plan, b: Plan): number {
  const created = Date.parse(a.createdAt) - Date.parse(b.createdAt);
  if (created !== 0) return created;
  return Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
}

function emptyLineage(current: Plan): PlanLineage {
  return {
    items: [{ plan: current, relation: 'self', confidence: 'session' }],
    children: [],
    peers: [],
    hasRelated: false,
  };
}

/**
 * Groups plans that share agent-session lineage with `current`.
 *
 * Priority:
 * 1. Same `metadata.sessionId` (peers)
 * 2. Codex-style `parentThreadId` parent/child links
 * 3. Soft fallback: same agent + workspace + (branch or overlapping day)
 */
export function getRelatedPlans(current: Plan, allPlans: readonly Plan[]): PlanLineage {
  const keys = extractLineageKeys(current);
  const byId = new Map<string, RelatedPlanEntry>();

  const remember = (entry: RelatedPlanEntry) => {
    const existing = byId.get(entry.plan.id);
    if (!existing) {
      byId.set(entry.plan.id, entry);
      return;
    }
    // Prefer stronger relations / confidence when the same plan appears twice.
    const relationRank: Record<LineageRelation, number> = {
      self: 4,
      parent: 3,
      child: 2,
      peer: 1,
    };
    const confidenceRank: Record<LineageConfidence, number> = {
      session: 3,
      thread: 2,
      'workspace-fallback': 1,
    };
    if (
      relationRank[entry.relation] > relationRank[existing.relation] ||
      (entry.relation === existing.relation &&
        confidenceRank[entry.confidence] > confidenceRank[existing.confidence])
    ) {
      byId.set(entry.plan.id, entry);
    }
  };

  remember({
    plan: current,
    relation: 'self',
    confidence: keys.sessionId ? 'session' : 'workspace-fallback',
  });

  if (keys.sessionId) {
    for (const plan of allPlans) {
      if (plan.id === current.id) continue;
      const other = extractLineageKeys(plan);
      if (other.sessionId === keys.sessionId) {
        remember({ plan, relation: 'peer', confidence: 'session' });
      }
    }

    if (keys.parentThreadId && keys.parentThreadId !== keys.sessionId) {
      for (const plan of allPlans) {
        if (plan.id === current.id) continue;
        const other = extractLineageKeys(plan);
        if (other.sessionId === keys.parentThreadId) {
          remember({ plan, relation: 'parent', confidence: 'thread' });
        }
      }
    }

    for (const plan of allPlans) {
      if (plan.id === current.id) continue;
      const other = extractLineageKeys(plan);
      if (other.parentThreadId && other.parentThreadId === keys.sessionId) {
        remember({ plan, relation: 'child', confidence: 'thread' });
      }
    }
  } else {
    const workspace = current.workspace?.trim();
    if (workspace) {
      const fallbacks: Plan[] = [];
      for (const plan of allPlans) {
        if (plan.id === current.id) continue;
        if (plan.agent !== current.agent) continue;
        if (plan.workspace?.trim() !== workspace) continue;
        const other = extractLineageKeys(plan);
        // Skip plans that have their own session identity — they belong elsewhere.
        if (other.sessionId) continue;
        const branchMatch = Boolean(keys.branch && other.branch && keys.branch === other.branch);
        if (branchMatch || daysOverlap(current, plan)) {
          fallbacks.push(plan);
        }
      }
      fallbacks.sort(sortByCreatedThenUpdated);
      for (const plan of fallbacks.slice(0, WORKSPACE_FALLBACK_LIMIT)) {
        remember({ plan, relation: 'peer', confidence: 'workspace-fallback' });
      }
    }
  }

  const peers = [...byId.values()].filter((entry) => entry.relation === 'peer');
  const children = [...byId.values()].filter((entry) => entry.relation === 'child');
  const parent = [...byId.values()].find((entry) => entry.relation === 'parent');
  const hasRelated = peers.length > 0 || children.length > 0 || Boolean(parent);

  if (!hasRelated) return emptyLineage(current);

  const items = [...byId.values()].sort((a, b) => sortByCreatedThenUpdated(a.plan, b.plan));
  return { items, parent, children, peers, hasRelated };
}

/**
 * Returns plan ids that share a `sessionId` with at least one other plan.
 * Used for the lightweight list affordance.
 */
export function plansWithSessionSiblings(plans: readonly Plan[]): ReadonlySet<string> {
  const bySession = new Map<string, string[]>();
  for (const plan of plans) {
    const { sessionId } = extractLineageKeys(plan);
    if (!sessionId) continue;
    const key = `${plan.agent}\0${sessionId}`;
    const list = bySession.get(key);
    if (list) list.push(plan.id);
    else bySession.set(key, [plan.id]);
  }

  const result = new Set<string>();
  for (const ids of bySession.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) result.add(id);
  }
  return result;
}
