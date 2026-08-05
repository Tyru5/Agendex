import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import type { PlanPathContextValue, PlanPathOpenResult } from '../components/PlanPathContext.tsx';
import {
  api,
  hasToken,
  type OpenInAppInfo,
  type PathExistsApiResult,
  type Plan,
} from '../lib/api.ts';
import { candidatePathsForValidation, extractCandidateCodePaths } from '../lib/plan-paths.ts';
import { remoteTargetsForPlanPaths } from '../lib/plan-path-targets.ts';

const OPEN_IN_APP_STORAGE_KEY = 'agendex_open_in_app';
/** Soft re-check while a plan stays open so newly created files can link up. */
const PATH_VALIDATION_REFRESH_MS = 30_000;
/** Must match PATH_EXISTS_BATCH_LIMIT in @agendex/shared. */
const PATH_EXISTS_BATCH_LIMIT = 500;
const EMPTY_PATH_RESULTS: Record<string, PathExistsApiResult> = {};

interface ValidationState {
  planId: string;
  results: Record<string, PathExistsApiResult>;
  status: PlanPathContextValue['status'];
  statusMessage?: string;
}

type ValidationAction =
  | { type: 'loading'; planId: string }
  | { type: 'ready'; planId: string; results: Record<string, PathExistsApiResult> }
  | { type: 'unavailable'; planId: string; message: string };

function validationReducer(state: ValidationState, action: ValidationAction): ValidationState {
  if (action.type === 'loading') {
    return { planId: action.planId, results: EMPTY_PATH_RESULTS, status: 'loading' };
  }
  if (action.type === 'unavailable') {
    return {
      planId: action.planId,
      results: EMPTY_PATH_RESULTS,
      status: 'unavailable',
      statusMessage: action.message,
    };
  }
  if (
    state.planId === action.planId &&
    state.status === 'ready' &&
    pathResultsEqual(state.results, action.results)
  ) {
    return state;
  }
  return { planId: action.planId, results: action.results, status: 'ready' };
}

export function getPreferredOpenInApp(apps: readonly OpenInAppInfo[]): string {
  const stored = localStorage.getItem(OPEN_IN_APP_STORAGE_KEY);
  if (stored && apps.some((app) => app.id === stored)) return stored;
  return apps.find((app) => app.kind === 'editor')?.id ?? apps[0]?.id ?? 'reveal';
}

export function setPreferredOpenInApp(appId: string): void {
  localStorage.setItem(OPEN_IN_APP_STORAGE_KEY, appId);
}

// One probe per session; the catalog is host-wide, not per plan.
let openInAppsPromise: Promise<OpenInAppInfo[]> | null = null;

function fetchOpenInApps(): Promise<OpenInAppInfo[]> {
  if (!openInAppsPromise) {
    openInAppsPromise = api
      .getOpenInApps()
      .then((response) => (response.available ? response.apps : []))
      .catch(() => {
        openInAppsPromise = null;
        return [];
      });
  }
  return openInAppsPromise;
}

function pathResultsEqual(
  left: Record<string, PathExistsApiResult>,
  right: Record<string, PathExistsApiResult>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;

  for (const key of leftKeys) {
    const a = left[key];
    const b = right[key];
    if (!a || !b || a.status !== b.status) return false;
    if (a.status === 'found' && b.status === 'found') {
      if (a.resolved !== b.resolved || a.relative !== b.relative) return false;
    } else if (a.status === 'ambiguous' && b.status === 'ambiguous') {
      if (a.matches.length !== b.matches.length) return false;
      for (let i = 0; i < a.matches.length; i++) {
        if (a.matches[i] !== b.matches[i]) return false;
      }
    }
  }
  return true;
}

async function checkPlanPathsBatched(
  planId: string,
  sourceFilePath: string,
  paths: readonly string[],
): Promise<Record<string, PathExistsApiResult>> {
  const requests: Array<Promise<{ results: Record<string, PathExistsApiResult> }>> = [];
  for (let offset = 0; offset < paths.length; offset += PATH_EXISTS_BATCH_LIMIT) {
    const chunk = paths.slice(offset, offset + PATH_EXISTS_BATCH_LIMIT);
    requests.push(api.checkPlanPaths(planId, chunk, sourceFilePath));
  }

  const merged: Record<string, PathExistsApiResult> = {};
  for (const response of await Promise.all(requests)) {
    Object.assign(merged, response.results);
  }
  return merged;
}

/**
 * Resolve code-path candidates against both available surfaces: the local API
 * for same-machine editor opening, and synced git metadata for Cloud links.
 */
export function useValidatedPlanPaths(
  plan: Pick<Plan, 'id' | 'localPlanId' | 'workspace' | 'metadata' | 'filePath'>,
  content: string,
): PlanPathContextValue | null {
  const [resultsState, dispatchValidation] = useReducer(validationReducer, {
    planId: plan.id,
    results: EMPTY_PATH_RESULTS,
    status: 'loading',
  });
  const [apps, setApps] = useState<OpenInAppInfo[]>([]);
  const [preferredAppId, setPreferredAppId] = useState('reveal');

  const candidates = useMemo(() => extractCandidateCodePaths(content), [content]);
  const paths = useMemo(() => candidatePathsForValidation(candidates), [candidates]);
  const remoteTargets = useMemo(
    () =>
      remoteTargetsForPlanPaths({ workspace: plan.workspace, metadata: plan.metadata }, candidates),
    [candidates, plan.metadata, plan.workspace],
  );
  const localPlanId = plan.localPlanId ?? plan.id;

  // Drop prior-plan results immediately on switch so overlapping path strings
  // cannot briefly render/open with the previous workspace resolution.
  const currentState: typeof resultsState =
    resultsState.planId === plan.id
      ? resultsState
      : { planId: plan.id, results: EMPTY_PATH_RESULTS, status: 'loading' };
  const results = currentState.results;

  const hasLocalCandidates = Boolean(plan.workspace) && paths.length > 0;
  const hasRemoteTargets = Object.keys(remoteTargets).length > 0;
  const localEnabled = hasLocalCandidates && hasToken();
  const contextEnabled = hasLocalCandidates || hasRemoteTargets;

  useEffect(() => {
    if (!hasLocalCandidates) {
      if (hasRemoteTargets) {
        dispatchValidation({ type: 'ready', planId: plan.id, results: EMPTY_PATH_RESULTS });
      } else {
        dispatchValidation({ type: 'loading', planId: plan.id });
      }
      return;
    }
    if (!localEnabled) {
      if (hasRemoteTargets) {
        dispatchValidation({ type: 'ready', planId: plan.id, results: EMPTY_PATH_RESULTS });
        return;
      }
      dispatchValidation({
        type: 'unavailable',
        planId: plan.id,
        message: 'Connect the local Agendex server to open source files.',
      });
      return;
    }

    let cancelled = false;
    let hasLoaded = false;
    let requestId = 0;

    const validate = (clearFirst: boolean) => {
      const id = ++requestId;
      if (clearFirst) {
        dispatchValidation({ type: 'loading', planId: plan.id });
      }
      void checkPlanPathsBatched(localPlanId, plan.filePath, paths)
        .then((nextResults) => {
          if (cancelled || id !== requestId) return;
          hasLoaded = true;
          dispatchValidation({ type: 'ready', planId: plan.id, results: nextResults });
        })
        .catch((error: unknown) => {
          if (cancelled || id !== requestId) return;
          if (hasRemoteTargets) {
            if (clearFirst) {
              dispatchValidation({ type: 'ready', planId: plan.id, results: EMPTY_PATH_RESULTS });
            }
            return;
          }
          dispatchValidation({
            type: 'unavailable',
            planId: plan.id,
            message:
              error instanceof Error && error.message === 'local plan source not found'
                ? 'This cloud plan is not indexed by the local Agendex server.'
                : 'The local Agendex server could not validate source files.',
          });
        });
    };

    validate(true);

    const refreshQuietly = () => {
      if (document.visibilityState === 'hidden') return;
      validate(false);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && hasLoaded) refreshQuietly();
    };

    window.addEventListener('focus', refreshQuietly);
    document.addEventListener('visibilitychange', onVisibility);
    const intervalId = window.setInterval(refreshQuietly, PATH_VALIDATION_REFRESH_MS);

    return () => {
      cancelled = true;
      window.removeEventListener('focus', refreshQuietly);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(intervalId);
    };
  }, [
    hasLocalCandidates,
    hasRemoteTargets,
    localEnabled,
    localPlanId,
    plan.filePath,
    plan.id,
    paths,
  ]);

  useEffect(() => {
    if (!localEnabled) return;
    let cancelled = false;
    void fetchOpenInApps().then((detected) => {
      if (cancelled) return;
      setApps(detected);
      setPreferredAppId(getPreferredOpenInApp(detected));
    });
    return () => {
      cancelled = true;
    };
  }, [localEnabled]);

  const openPath = useCallback(
    async (path: string, line?: number, appId?: string): Promise<PlanPathOpenResult> => {
      const targetApp = appId ?? getPreferredOpenInApp(apps);
      try {
        const response = await api.openPlanPath(localPlanId, path, line, targetApp, plan.filePath);
        if (response.ok) {
          setPreferredOpenInApp(targetApp);
          setPreferredAppId(targetApp);
        }
        return response;
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Failed to open path' };
      }
    },
    [apps, localPlanId, plan.filePath],
  );

  return useMemo(() => {
    if (!contextEnabled) return null;
    return {
      planId: plan.id,
      results,
      remoteTargets,
      apps,
      preferredAppId,
      openPath,
      status: currentState.status,
      statusMessage: currentState.statusMessage,
    };
  }, [
    apps,
    contextEnabled,
    currentState.status,
    currentState.statusMessage,
    openPath,
    plan.id,
    preferredAppId,
    remoteTargets,
    results,
  ]);
}
