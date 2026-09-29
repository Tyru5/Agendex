import type { Plan } from '../types.ts';
import { isIndexablePlan } from './plan-value.ts';

const TITLE_WEIGHT = 10;
const FILE_PATH_WEIGHT = 3;
const WORKSPACE_WEIGHT = 2;
const AGENT_WEIGHT = 2;
const CONTENT_WEIGHT = 1;
/** Content hits past this count add nothing, so long plans can't outrank a title hit. */
const MAX_COUNTED_CONTENT_HITS = 5;
const EXACT_TITLE_BONUS = 8;
const EXACT_CONTENT_BONUS = 4;

interface SearchFields {
  title: string;
  content: string;
  filePath: string;
  workspace: string;
  agent: string;
}

interface NormalizedPlan {
  source: SearchFields;
  normalized: SearchFields;
}

/**
 * Lowercased fields per plan object. Rescans replace plan objects, which drops
 * their entries; `source` catches the in-place edits `update()` makes.
 */
const normalizedPlans = new WeakMap<Plan, NormalizedPlan>();

function normalizedFields(plan: Plan): SearchFields {
  const workspace = plan.workspace ?? '';
  const cached = normalizedPlans.get(plan);
  if (
    cached &&
    cached.source.title === plan.title &&
    cached.source.content === plan.content &&
    cached.source.filePath === plan.filePath &&
    cached.source.workspace === workspace &&
    cached.source.agent === plan.agent
  ) {
    return cached.normalized;
  }
  const source: SearchFields = {
    title: plan.title,
    content: plan.content,
    filePath: plan.filePath,
    workspace,
    agent: plan.agent,
  };
  const normalized: SearchFields = {
    title: source.title.toLowerCase(),
    content: source.content.toLowerCase(),
    filePath: source.filePath.toLowerCase(),
    workspace: workspace.toLowerCase(),
    agent: source.agent.toLowerCase(),
  };
  normalizedPlans.set(plan, { source, normalized });
  return normalized;
}

/** Whitespace-separated terms; a double-quoted phrase is one term. */
function parseTerms(query: string): string[] {
  const terms = new Set<string>();
  for (const match of query.toLowerCase().matchAll(/"([^"]*)(?:"|$)|([^\s"]+)/g)) {
    const term = (match[1] ?? match[2] ?? '').trim();
    if (term) terms.add(term);
  }
  return Array.from(terms);
}

function countHits(text: string, term: string, cap: number): number {
  let hits = 0;
  let from = text.indexOf(term);
  while (from !== -1 && hits < cap) {
    hits += 1;
    from = text.indexOf(term, from + term.length);
  }
  return hits;
}

/** Relevance score, or `undefined` when some term matches no field. */
function scorePlan(fields: SearchFields, terms: string[], phrase: string | undefined) {
  let score = 0;
  for (const term of terms) {
    let termScore = 0;
    if (fields.title.includes(term)) termScore += TITLE_WEIGHT;
    if (fields.filePath.includes(term)) termScore += FILE_PATH_WEIGHT;
    if (fields.workspace.includes(term)) termScore += WORKSPACE_WEIGHT;
    if (fields.agent.includes(term)) termScore += AGENT_WEIGHT;
    termScore += CONTENT_WEIGHT * countHits(fields.content, term, MAX_COUNTED_CONTENT_HITS);
    if (termScore === 0) return undefined;
    score += termScore;
  }
  if (phrase) {
    if (fields.title.includes(phrase)) score += EXACT_TITLE_BONUS;
    if (fields.content.includes(phrase)) score += EXACT_CONTENT_BONUS;
  }
  return score;
}

/**
 * Case-insensitive substring search over indexable plans. Every query term
 * must appear in the title, content, file path, workspace, or agent. Results
 * are ordered by relevance (title hits first, then path/workspace/agent, then
 * capped content hits, plus a bonus for the whole query verbatim), then by
 * most recently updated.
 */
export function searchPlans(plans: readonly Plan[], query: string): Plan[] {
  const terms = parseTerms(query);
  if (terms.length === 0) return [];
  const phrase = terms.length > 1 ? terms.join(' ') : undefined;

  const scored: Array<{ plan: Plan; score: number }> = [];
  for (const plan of plans) {
    if (!isIndexablePlan(plan)) continue;
    const score = scorePlan(normalizedFields(plan), terms, phrase);
    if (score !== undefined) scored.push({ plan, score });
  }

  scored.sort(
    (a, b) => b.score - a.score || b.plan.updatedAt.getTime() - a.plan.updatedAt.getTime(),
  );
  return scored.map((entry) => entry.plan);
}
