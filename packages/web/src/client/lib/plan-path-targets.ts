import { extractPlanGitContext, forgeKind, sourceFileUrl } from '@agendex/shared/git-forge';
import type { Plan } from './api.ts';
import type { ParsedCodePath } from './plan-paths.ts';

export interface PlanPathRemoteTarget {
  url: string;
  label: string;
}

export function planPathTargetKey(path: Pick<ParsedCodePath, 'path' | 'line' | 'lineEnd'>): string {
  return `${path.path}\0${path.line ?? ''}\0${path.lineEnd ?? ''}`;
}

function repoRelativePath(path: string, workspace?: string): string | null {
  let candidate = path.replace(/\\/g, '/');
  const normalizedWorkspace = workspace?.replace(/\\/g, '/').replace(/\/+$/, '');

  if (candidate.startsWith('/')) {
    if (!normalizedWorkspace) return null;
    if (candidate === normalizedWorkspace) return null;
    if (!candidate.startsWith(`${normalizedWorkspace}/`)) return null;
    candidate = candidate.slice(normalizedWorkspace.length + 1);
  }

  candidate = candidate.replace(/^\.\/+/, '');
  if (!candidate || candidate.startsWith('~/')) return null;
  const segments = candidate.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return null;
  return segments.join('/');
}

function forgeLabel(host: string): string {
  switch (forgeKind(host)) {
    case 'github':
      return 'Open on GitHub';
    case 'gitlab':
      return 'Open on GitLab';
    case 'bitbucket':
      return 'Open on Bitbucket';
    default:
      return 'Open in repository';
  }
}

export function remoteTargetForPlanPath(
  plan: Pick<Plan, 'workspace' | 'metadata'>,
  path: Pick<ParsedCodePath, 'path' | 'line' | 'lineEnd'>,
): PlanPathRemoteTarget | null {
  const git = extractPlanGitContext(plan.metadata);
  const ref = git?.commit ?? git?.branch;
  if (!git?.repo || !ref) return null;

  const relative = repoRelativePath(path.path, plan.workspace);
  if (!relative) return null;
  const url = sourceFileUrl(git.repo, ref, relative, path.line, path.lineEnd);
  if (!url) return null;
  return { url, label: forgeLabel(git.repo.host) };
}

export function remoteTargetsForPlanPaths(
  plan: Pick<Plan, 'workspace' | 'metadata'>,
  paths: readonly ParsedCodePath[],
): Record<string, PlanPathRemoteTarget> {
  const targets: Record<string, PlanPathRemoteTarget> = {};
  for (const path of paths) {
    const target = remoteTargetForPlanPath(plan, path);
    if (target) targets[planPathTargetKey(path)] = target;
  }
  return targets;
}
