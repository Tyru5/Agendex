import type { Plan } from './api.ts';

/**
 * Filters plans by a search query across title, content, agent, workspace,
 * and file path.
 *
 * `contentMatchIds` covers plans whose `content` is not present client-side
 * (cloud mode ships list items without content): ids in the set count as
 * content matches, as determined by a server-side search. Local mode omits it
 * and keeps pure substring matching.
 */
export function filterPlans(
  plans: Plan[],
  query: string,
  contentMatchIds?: ReadonlySet<string>,
): Plan[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return plans;

  return plans.filter((plan) => {
    // Content matching is mode-exclusive: when contentMatchIds is provided
    // (cloud mode), the server-side search is authoritative — even if a
    // content snippet is ever shipped client-side, it must not be substring
    // matched. Local mode falls back to substring matching on full content.
    const contentMatches = contentMatchIds
      ? contentMatchIds.has(plan.id)
      : plan.content.toLowerCase().includes(normalizedQuery);
    return (
      plan.title.toLowerCase().includes(normalizedQuery) ||
      contentMatches ||
      plan.agent.toLowerCase().includes(normalizedQuery) ||
      plan.workspace?.toLowerCase().includes(normalizedQuery) ||
      plan.filePath.toLowerCase().includes(normalizedQuery)
    );
  });
}
