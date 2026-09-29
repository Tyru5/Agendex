import { canonicalPlanAgent } from '@agendex/shared/plan-download-lookup';
import { extractCandidateCodePaths } from '@agendex/shared/plan-paths';
import type { Plan } from './api.ts';

export const CROSS_AGENT_CANDIDATE_LIMIT = 20;
const MAX_CONTENT_CHARS = 200_000;
const COMMON = new Set(
  'the and that this with from into for add update remove create implement plan test tests testing verify verification steps section acceptance criteria should will existing new then using files file code run ensure change changes'.split(
    ' ',
  ),
);
export type CrossAgentSuggestion = { plan: Plan; evidence: string[]; score: number };

function tokens(content: string): Set<string> {
  return new Set(
    (
      content
        .slice(0, MAX_CONTENT_CHARS)
        .toLowerCase()
        .match(/[a-z][a-z0-9_]{3,}/g) ?? []
    ).filter((word) => !COMMON.has(word)),
  );
}
function workReferences(plan: Plan): Set<string> {
  const metadata = plan.metadata;
  if (!metadata || typeof metadata !== 'object') return new Set();
  return new Set(
    ['issueUrl', 'pullRequestUrl', 'workItemId'].flatMap((key) => {
      const value = metadata[key];
      return typeof value === 'string' && value.trim() && value.length <= 2048
        ? [`${key}:${value.trim()}`]
        : [];
    }),
  );
}
function intersection(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter((value) => right.has(value)).sort();
}
export function crossAgentCandidates(current: Plan, plans: readonly Plan[]): Plan[] {
  const currentAgent = typeof current.agent === 'string' ? canonicalPlanAgent(current.agent) : '';
  if (!current.workspace?.trim() || !currentAgent) return [];
  const seen = new Set([current.id]);
  return plans
    .filter((plan) => {
      const candidateAgent = typeof plan.agent === 'string' ? canonicalPlanAgent(plan.agent) : '';
      if (
        !candidateAgent ||
        seen.has(plan.id) ||
        candidateAgent === currentAgent ||
        plan.workspace !== current.workspace
      )
        return false;
      // Don't mix plans from different cloud owners whose workspace labels happen to match.
      if ((current.ownerId || plan.ownerId) && current.ownerId !== plan.ownerId) return false;
      seen.add(plan.id);
      return true;
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
    .slice(0, CROSS_AGENT_CANDIDATE_LIMIT);
}
export function suggestCrossAgentPlans(
  current: Plan,
  plans: readonly Plan[],
): CrossAgentSuggestion[] {
  if (!current.content?.trim()) return [];
  const currentTokens = tokens(current.content);
  const currentPaths = new Set(
    extractCandidateCodePaths(current.content.slice(0, MAX_CONTENT_CHARS)).map((p) =>
      p.path.replace(/^\.\//, ''),
    ),
  );
  const currentRefs = workReferences(current);
  return crossAgentCandidates(current, plans)
    .flatMap((plan) => {
      if (!plan.content?.trim()) return [];
      const otherTokens = tokens(plan.content);
      const sharedTokens = intersection(currentTokens, otherTokens);
      const similarity =
        sharedTokens.length / Math.max(1, new Set([...currentTokens, ...otherTokens]).size);
      const paths = intersection(
        currentPaths,
        new Set(
          extractCandidateCodePaths(plan.content.slice(0, MAX_CONTENT_CHARS)).map((p) =>
            p.path.replace(/^\.\//, ''),
          ),
        ),
      );
      const references = intersection(currentRefs, workReferences(plan));
      if (
        !references.length &&
        !(paths.length >= 2 && sharedTokens.length >= 3) &&
        !(sharedTokens.length >= 8 && similarity >= 0.25)
      )
        return [];
      const evidence = [
        ...references.map((ref) => `Shared work reference: ${ref}`),
        ...paths.slice(0, 3).map((path) => `Shared file reference: ${path}`),
        ...(sharedTokens.length >= 8 && similarity >= 0.25
          ? [`Content overlap: ${sharedTokens.length} terms (${Math.round(similarity * 100)}%)`]
          : []),
      ];
      return [{ plan, evidence, score: references.length * 10 + paths.length * 3 + similarity }];
    })
    .sort((a, b) => b.score - a.score || a.plan.id.localeCompare(b.plan.id))
    .slice(0, 5);
}

export type HandoffCli = 'codex' | 'claude';
export function quotePosix(value: string): string {
  if ([...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
    throw new Error('Use a path without control characters.');
  }
  return "'" + value.replaceAll("'", "'\"'\"'") + "'";
}
export function buildHandoffCommand(plan: Plan, cli: HandoffCli, contextPath: string): string {
  if (cli !== 'codex' && cli !== 'claude') throw new Error('Unsupported agent CLI.');
  if (!plan.workspace?.startsWith('/'))
    throw new Error('A local absolute workspace path is required.');
  if (!contextPath.startsWith('/'))
    throw new Error('Enter the absolute path of the downloaded handoff file.');
  // Validate paths even though the context path is inside a quoted prompt.
  quotePosix(contextPath);
  const prompt = `Read the handoff context file at ${JSON.stringify(contextPath)}. Treat it as source material to review, confirm the workspace and proposed next steps with me before implementation. Start a new session; do not infer or resume a source session.`;
  return `cd -- ${quotePosix(plan.workspace)} && ${cli} ${quotePosix(prompt)}`;
}
export function createHandoffContext(plan: Plan): string {
  if (!plan.content?.trim()) throw new Error('Plan content is unavailable.');
  return `# Agendex handoff\n\nReview this context before starting work. This export does not transfer session state or approve execution.\n\nSource plan: ${JSON.stringify(plan.title)}\nSource agent: ${JSON.stringify(plan.agent)}\nWorkspace: ${JSON.stringify(plan.workspace ?? '')}\nPlan ID: ${JSON.stringify(plan.id)}\nUpdated: ${JSON.stringify(plan.updatedAt)}\n\n## Source content\n\n${plan.content}`;
}

export async function hydrateCrossAgentCandidates(
  current: Plan,
  plans: readonly Plan[],
  loadContent?: (plan: Plan) => Promise<string | null>,
  shouldContinue: () => boolean = () => true,
): Promise<{ plans: Plan[]; unavailable: number } | null> {
  const candidates = crossAgentCandidates(current, plans);
  const hydrated: Plan[] = [];
  let unavailable = 0;
  for (let index = 0; index < candidates.length; index += 4) {
    if (!shouldContinue()) return null;
    const batch = await Promise.all(
      candidates.slice(index, index + 4).map(async (candidate) => {
        if (candidate.content?.trim()) return candidate;
        if (!loadContent) return null;
        try {
          const content = await loadContent(candidate);
          return content?.trim() ? { ...candidate, content } : null;
        } catch {
          return null;
        }
      }),
    );
    if (!shouldContinue()) return null;
    for (const candidate of batch) {
      if (candidate) hydrated.push(candidate);
      else unavailable++;
    }
  }
  return { plans: hydrated, unavailable };
}

/** Clipboard is absent on insecure HTTP origins; preserve the selectable command as fallback. */
export async function copyHandoffCommand(
  command: string,
  clipboard?: Pick<Clipboard, 'writeText'>,
): Promise<boolean> {
  try {
    if (!clipboard?.writeText) return false;
    await clipboard.writeText(command);
    return true;
  } catch {
    return false;
  }
}
