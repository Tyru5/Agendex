import type { Plan } from '../types.ts';
import { getUsageSummary } from '../usage/service.ts';
import {
  countPlansInSession,
  resolveUsageSession,
  summarizeSessionCost,
  unavailableSessionCost,
  type PlanSessionCost,
  type SessionIdentity,
} from '../usage/session-cost.ts';
import type { UsageSummary } from '../usage/types.ts';

const TTL_MS = 5 * 60_000;
const MAX_CACHED_SESSIONS = 100;
const cache = new Map<string, { at: number; summary: UsageSummary }>();
const inflight = new Map<string, Promise<UsageSummary>>();
async function loadSession(identity: SessionIdentity): Promise<UsageSummary> {
  const key = JSON.stringify([identity.agent, identity.sessionId, identity.sessionAliases]);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.summary;
  const running = inflight.get(key);
  if (running) return running;
  const scan = getUsageSummary({ days: 90, session: identity })
    .then((summary) => {
      if (cache.size >= MAX_CACHED_SESSIONS) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(key, { at: Date.now(), summary });
      return summary;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, scan);
  return scan;
}

export async function getPlanSessionCost(
  plan: Plan,
  peers: readonly Plan[],
  load: (identity: SessionIdentity) => Promise<UsageSummary> = loadSession,
): Promise<PlanSessionCost> {
  const identity = resolveUsageSession(plan);
  if (typeof identity === 'string') return unavailableSessionCost(identity);
  try {
    const summary = await load(identity);
    const relevantSources = summary.sources.filter((source) => source.agent === identity.agent);
    if (relevantSources.length && relevantSources.every((source) => source.status !== 'scanned'))
      return unavailableSessionCost('usage-unavailable', identity);
    return summarizeSessionCost(identity, summary, countPlansInSession(peers, identity));
  } catch {
    return unavailableSessionCost('usage-unavailable', identity);
  }
}
