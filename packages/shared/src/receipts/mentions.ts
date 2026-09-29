/**
 * Turn a plan's file mentions into repo-relative match keys for receipts.
 * Mentions resolve against the plan workspace exactly like jump-to-source;
 * mentions that don't resolve keep fallback keys so files created, deleted
 * or moved after the plan still match commits.
 */

import { realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { candidatePathsForValidation, extractCandidateCodePaths } from '../plan-paths.ts';
import { isWithinWorkspace, resolveCodeFileBatch } from '../services/path-resolve.ts';
import type { Plan } from '../types.ts';
import type { PlanMention, ResolvedMentions } from './attribution.ts';

/** Repo-relative POSIX path, or null when `absolute` is outside the repo. */
function repoRelative(realRepoRoot: string, absolute: string): string | null {
  const rel = relative(realRepoRoot, absolute);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  return rel.split(sep).join('/');
}

function missingMention(
  path: string,
  realRepoRoot: string,
  workspace: string,
  baseDir: string | undefined,
): PlanMention | null {
  if (path.startsWith('./') && !baseDir) return null;
  const from = path.startsWith('./') && baseDir ? baseDir : workspace;
  const joined = repoRelative(realRepoRoot, isAbsolute(path) ? path : resolve(from, path));
  if (!joined) return null;
  const workspacePrefix = repoRelative(realRepoRoot, workspace) ?? '';
  if (workspacePrefix && !joined.startsWith(workspacePrefix + '/')) return null;
  // Explicit paths retain their location even when absent; never fuzzy-match an escape.
  if (isAbsolute(path) || path.startsWith('./') || path.startsWith('../')) {
    return { key: joined, found: false, joined };
  }
  // Fallback keys come from the text the plan wrote, minus leading ./ and ../.
  const tail = (isAbsolute(path) ? joined : path.replace(/^(?:\.{1,2}\/)+/, '')).toLowerCase();
  if (!tail) return null;
  return tail.includes('/')
    ? { key: joined, found: false, joined, suffix: tail, workspacePrefix }
    : { key: joined, found: false, joined, basename: tail, workspacePrefix };
}

/**
 * Resolve every trackable mention in `plan` against `realRepoRoot`. The
 * workspace is the plan's own when inside the repo, else the repo root.
 */
export async function resolvePlanMentions(
  plan: Pick<Plan, 'content' | 'workspace' | 'filePath'>,
  realRepoRoot: string,
): Promise<ResolvedMentions> {
  const paths = candidatePathsForValidation(extractCandidateCodePaths(plan.content));
  if (paths.length === 0) return { mentions: [], ambiguous: [] };

  let workspace = realRepoRoot;
  if (plan.workspace && isWithinWorkspace(plan.workspace, realRepoRoot)) {
    workspace = realpathSync(plan.workspace);
  }
  const planDir = plan.filePath ? dirname(plan.filePath) : undefined;
  const baseDir =
    planDir && isWithinWorkspace(planDir, workspace) ? realpathSync(planDir) : undefined;

  const results = await resolveCodeFileBatch(paths, workspace, baseDir);
  const byKey = new Map<string, PlanMention>();
  const ambiguous: string[] = [];
  for (const path of paths) {
    const result = results[path];
    let mention: PlanMention | null = null;
    if (result?.status === 'found') {
      const exact = repoRelative(realRepoRoot, result.resolved);
      if (exact) mention = { key: exact, found: true, exact };
    } else if (result?.status === 'missing') {
      mention = missingMention(path, realRepoRoot, workspace, baseDir);
    } else if (result?.status === 'ambiguous') {
      ambiguous.push(path);
    }
    if (!mention) continue;
    const existing = byKey.get(mention.key);
    if (!existing || (mention.found && !existing.found)) byKey.set(mention.key, mention);
  }
  return { mentions: [...byKey.values()], ambiguous };
}
