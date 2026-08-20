import {
  ADAPTER_AGENT_ALIASES,
  resolveAdapterId,
  storedAgentValuesForAdapter,
} from '../adapters/agent-ids';
import { exactDuplicateKey } from './plan-sync-identity';

export type PlanDownloadLookupCandidate = {
  id: string;
  localPlanId?: string;
  agent: string;
  title: string;
  updatedAt: number;
  syncIdentityKey?: string;
  contentHash?: string;
  createdAt?: number;
};

export type PlanDownloadLookupSelection =
  | { kind: 'none' }
  | { kind: 'one'; plan: PlanDownloadLookupCandidate }
  | { kind: 'many'; plans: PlanDownloadLookupCandidate[] };

const AGENT_TITLE_SEPARATOR = /^(.+?)\s*[/|:]\s*(.+)$/;

export function normalizePlanLookupText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function canonicalPlanAgent(value: string): string {
  const lowered = value.trim().toLowerCase();
  if (!lowered) return '';
  const adapterId = resolveAdapterId(lowered);
  if (!adapterId) return lowered;
  return ADAPTER_AGENT_ALIASES[adapterId] ?? adapterId;
}

export function looksLikePlanAgent(value: string): boolean {
  return resolveAdapterId(value.trim().toLowerCase()) !== undefined;
}

export function planAgentsMatch(planAgent: string, requestedAgent: string): boolean {
  const left = canonicalPlanAgent(planAgent);
  const right = canonicalPlanAgent(requestedAgent);
  return left.length > 0 && left === right;
}

/** Stored `agent` values that should be queried for a user-supplied filter. */
export function planAgentLookupValues(requested: string): string[] {
  const trimmed = requested.trim();
  if (!trimmed) return [];

  const values = new Set<string>([trimmed]);
  const canonical = canonicalPlanAgent(trimmed);
  if (canonical) values.add(canonical);

  const adapterId = resolveAdapterId(trimmed.toLowerCase());
  if (adapterId) {
    for (const stored of storedAgentValuesForAdapter(adapterId)) {
      values.add(stored);
    }
  }

  return [...values];
}

export function parsePlanDownloadQuery(raw: string): { query: string; agent?: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { query: '' };

  const match = trimmed.match(AGENT_TITLE_SEPARATOR);
  const left = match?.[1]?.trim();
  const right = match?.[2]?.trim();
  if (!left || !right) return { query: trimmed };

  const leftIsAgent = looksLikePlanAgent(left);
  const rightIsAgent = looksLikePlanAgent(right);
  if (leftIsAgent && !rightIsAgent) {
    return { query: right, agent: canonicalPlanAgent(left) };
  }
  if (rightIsAgent && !leftIsAgent && !/\s/.test(left)) {
    return { query: left, agent: canonicalPlanAgent(right) };
  }
  if (leftIsAgent && !/\s/.test(right)) {
    return { query: right, agent: canonicalPlanAgent(left) };
  }

  return { query: trimmed };
}

function sortByNewest(plans: PlanDownloadLookupCandidate[]): PlanDownloadLookupCandidate[] {
  return [...plans].sort((a, b) => {
    if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
    return a.title.localeCompare(b.title);
  });
}

export const PLAN_DOWNLOAD_SUGGESTION_LIMIT = 5;
export const PLAN_DOWNLOAD_SUGGESTION_MIN_SCORE = 0.34;

function finish(matches: PlanDownloadLookupCandidate[]): PlanDownloadLookupSelection {
  if (matches.length === 0) return { kind: 'none' };
  if (matches.length === 1) {
    const plan = matches[0];
    if (!plan) return { kind: 'none' };
    return { kind: 'one', plan };
  }
  return { kind: 'many', plans: sortByNewest(matches) };
}

function lookupTokens(value: string): string[] {
  return normalizePlanLookupText(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const prev = Array.from({ length: b.length + 1 }, (_, index) => index);
  const curr = Array.from({ length: b.length + 1 }, () => 0);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    const aChar = a[i - 1];
    for (let j = 1; j <= b.length; j++) {
      const substitution = (prev[j - 1] ?? 0) + (aChar === b[j - 1] ? 0 : 1);
      const deletion = (prev[j] ?? 0) + 1;
      const insertion = (curr[j - 1] ?? 0) + 1;
      curr[j] = Math.min(substitution, deletion, insertion);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j] ?? 0;
  }

  return prev[b.length] ?? Math.max(a.length, b.length);
}

function editSimilarity(left: string, right: string): number {
  const maxLen = Math.max(left.length, right.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(left, right) / maxLen;
}

function tokensOverlap(queryTokens: string[], titleTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  let hits = 0;
  for (const queryToken of queryTokens) {
    const matched = titleTokens.some((titleToken) => {
      if (titleToken === queryToken) return true;
      if (titleToken.startsWith(queryToken) || queryToken.startsWith(titleToken)) return true;
      return (
        queryToken.length >= 3 &&
        titleToken.length >= 3 &&
        editSimilarity(queryToken, titleToken) >= 0.66
      );
    });
    if (matched) hits += 1;
  }
  return hits / queryTokens.length;
}

export function looksLikePlanIdQuery(query: string): boolean {
  const trimmed = query.trim();
  return trimmed.length >= 16 && /^[a-z0-9]+$/i.test(trimmed);
}

export function scorePlanTitleSimilarity(query: string, title: string): number {
  const normalizedQuery = normalizePlanLookupText(query);
  const normalizedTitle = normalizePlanLookupText(title);
  if (!normalizedQuery || !normalizedTitle) return 0;
  if (normalizedQuery === normalizedTitle) return 1;

  if (normalizedTitle.includes(normalizedQuery) || normalizedQuery.includes(normalizedTitle)) {
    const overlap =
      Math.min(normalizedQuery.length, normalizedTitle.length) /
      Math.max(normalizedQuery.length, normalizedTitle.length);
    return 0.72 + overlap * 0.28;
  }

  const editScore = editSimilarity(normalizedQuery, normalizedTitle);
  const tokenScore = tokensOverlap(lookupTokens(normalizedQuery), lookupTokens(normalizedTitle));
  return Math.max(editScore, tokenScore * 0.92);
}

export function suggestClosestPlans(
  plans: readonly PlanDownloadLookupCandidate[],
  query: string,
  agent?: string,
  options?: { limit?: number; minScore?: number },
): PlanDownloadLookupCandidate[] {
  const trimmedQuery = query.trim();
  if (!trimmedQuery || looksLikePlanIdQuery(trimmedQuery)) return [];

  const limit = options?.limit ?? PLAN_DOWNLOAD_SUGGESTION_LIMIT;
  const minScore = options?.minScore ?? PLAN_DOWNLOAD_SUGGESTION_MIN_SCORE;
  const requestedAgent = agent?.trim();

  return [...plans]
    .map((plan) => {
      let score = scorePlanTitleSimilarity(trimmedQuery, plan.title);
      if (requestedAgent && planAgentsMatch(plan.agent, requestedAgent)) score += 0.08;
      return { plan, score };
    })
    .filter((entry) => entry.score >= minScore)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (right.plan.updatedAt !== left.plan.updatedAt)
        return right.plan.updatedAt - left.plan.updatedAt;
      return left.plan.title.localeCompare(right.plan.title);
    })
    .slice(0, limit)
    .map((entry) => entry.plan);
}

export function selectPlanDownloadMatches(
  plans: readonly PlanDownloadLookupCandidate[],
  query: string,
  agent?: string,
): PlanDownloadLookupSelection {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return { kind: 'none' };

  const requestedAgent = agent?.trim();
  const pool = requestedAgent
    ? plans.filter((plan) => planAgentsMatch(plan.agent, requestedAgent))
    : [...plans];

  const exactId = pool.filter(
    (plan) => plan.id === trimmedQuery || plan.localPlanId === trimmedQuery,
  );
  if (exactId.length > 0) return finish(exactId);

  const normalizedQuery = normalizePlanLookupText(trimmedQuery);
  const exactTitle = pool.filter((plan) => normalizePlanLookupText(plan.title) === normalizedQuery);
  if (exactTitle.length > 0) return finish(exactTitle);

  const startsWith = pool.filter((plan) =>
    normalizePlanLookupText(plan.title).startsWith(normalizedQuery),
  );
  if (startsWith.length > 0) return finish(startsWith);

  const includes = pool.filter((plan) =>
    normalizePlanLookupText(plan.title).includes(normalizedQuery),
  );
  if (includes.length > 0) return finish(includes);

  return { kind: 'none' };
}

/** Inclusive title/id matching for browse listing. Unlike selectPlanDownloadMatches, this keeps every matching category on a page. */
export function filterPlanBrowseMatches(
  plans: readonly PlanDownloadLookupCandidate[],
  query: string,
  agent?: string,
): PlanDownloadLookupCandidate[] {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [...plans];

  const requestedAgent = agent?.trim();
  const pool = requestedAgent
    ? plans.filter((plan) => planAgentsMatch(plan.agent, requestedAgent))
    : [...plans];

  const normalizedQuery = normalizePlanLookupText(trimmedQuery);
  return pool.filter((plan) => {
    if (plan.id === trimmedQuery || plan.localPlanId === trimmedQuery) return true;
    const title = normalizePlanLookupText(plan.title);
    return (
      title === normalizedQuery ||
      title.startsWith(normalizedQuery) ||
      title.includes(normalizedQuery)
    );
  });
}

export function isExactPlanDownloadIdHit(
  plan: Pick<PlanDownloadLookupCandidate, 'id' | 'localPlanId'>,
  query: string,
): boolean {
  return plan.id === query || plan.localPlanId === query;
}

/**
 * All duplicate identities a plan row answers to. A row that carries a sync
 * identity still exposes its exact-content key so it collapses with a
 * duplicate row that never got a sync identity.
 */
export function planBrowseDedupeKeys(plan: PlanDownloadLookupCandidate): string[] {
  const keys: string[] = [];
  if (plan.syncIdentityKey) keys.push(`sync:${plan.syncIdentityKey}`);
  if (plan.contentHash) {
    keys.push(
      `exact:${exactDuplicateKey({
        agent: plan.agent,
        title: plan.title,
        contentHash: plan.contentHash,
      })}`,
    );
  }
  if (keys.length === 0) keys.push(`id:${plan.id}`);
  return keys;
}

export interface PlanBrowseDedupeResult {
  plan: PlanDownloadLookupCandidate;
  dedupeKeys: string[];
}

/**
 * Deduplicate like {@link dedupePlanDownloadCandidates}, but return the union
 * of identity keys across every row a group collapsed — optionally sourced
 * from a wider row set (e.g. pre-filter) — so callers can still match a later
 * duplicate that only a discarded row answered to.
 */
export function dedupePlanBrowseCandidates(
  plans: readonly PlanDownloadLookupCandidate[],
  keySource: readonly PlanDownloadLookupCandidate[] = plans,
): PlanBrowseDedupeResult[] {
  const unions = new Map<string, Set<string>>();
  for (const plan of keySource) {
    const groupKey = planDownloadDuplicateKey(plan);
    let union = unions.get(groupKey);
    if (!union) {
      union = new Set();
      unions.set(groupKey, union);
    }
    for (const key of planBrowseDedupeKeys(plan)) union.add(key);
  }
  return dedupePlanDownloadCandidates(plans).map((plan) => {
    const union = unions.get(planDownloadDuplicateKey(plan));
    return { plan, dedupeKeys: union ? [...union] : planBrowseDedupeKeys(plan) };
  });
}

function planDownloadDuplicateKey(plan: PlanDownloadLookupCandidate): string {
  if (plan.syncIdentityKey) return `sync:${plan.syncIdentityKey}`;
  if (plan.contentHash) {
    return `exact:${exactDuplicateKey({
      agent: plan.agent,
      title: plan.title,
      contentHash: plan.contentHash,
    })}`;
  }
  return `id:${plan.id}`;
}

export function dedupePlanDownloadCandidates(
  plans: readonly PlanDownloadLookupCandidate[],
): PlanDownloadLookupCandidate[] {
  const winners = new Map<string, PlanDownloadLookupCandidate>();
  for (const plan of plans) {
    const key = planDownloadDuplicateKey(plan);
    const existing = winners.get(key);
    if (!existing) {
      winners.set(key, plan);
      continue;
    }
    if (plan.updatedAt !== existing.updatedAt) {
      winners.set(key, plan.updatedAt > existing.updatedAt ? plan : existing);
      continue;
    }
    winners.set(key, (plan.createdAt ?? 0) > (existing.createdAt ?? 0) ? plan : existing);
  }

  const emitted = new Set<string>();
  const result: PlanDownloadLookupCandidate[] = [];
  for (const plan of plans) {
    const key = planDownloadDuplicateKey(plan);
    if (emitted.has(key)) continue;
    emitted.add(key);
    const winner = winners.get(key);
    if (winner) result.push(winner);
  }
  return result;
}

export const PLAN_DOWNLOAD_FALLBACK_PAGE_SIZE = 8;
export const PLAN_DOWNLOAD_FALLBACK_MAX_PLANS = 500;

export type PlanDownloadFallbackPage<T extends PlanDownloadLookupCandidate> = {
  plans: readonly T[];
  done: boolean;
};

/**
 * Walk owner-plan pages until the scan is exhausted or capped. Matching is
 * decided only on the full collected pool so a unique hit on an early page
 * can still become ambiguous if a later page has the same title.
 */
export async function scanPlanDownloadFallback<T extends PlanDownloadLookupCandidate>(
  query: string,
  agent: string | undefined,
  readPage: () => Promise<PlanDownloadFallbackPage<T>>,
  maxPlans: number = PLAN_DOWNLOAD_FALLBACK_MAX_PLANS,
): Promise<{ selection: PlanDownloadLookupSelection; candidates: T[] }> {
  const candidates: T[] = [];
  const maxPages = Math.max(1, Math.ceil(maxPlans / PLAN_DOWNLOAD_FALLBACK_PAGE_SIZE));
  for (let pagesRead = 0; pagesRead < maxPages && candidates.length < maxPlans; pagesRead++) {
    const page = await readPage();
    if (page.plans.length === 0) {
      if (page.done) break;
      continue;
    }
    const remaining = maxPlans - candidates.length;
    candidates.push(...page.plans.slice(0, remaining));
    if (page.done) break;
  }
  return {
    selection: selectPlanDownloadMatches(candidates, query, agent),
    candidates,
  };
}
