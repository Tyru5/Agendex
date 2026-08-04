import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PlanPathContextValue, PlanPathOpenResult } from '../components/PlanPathContext.tsx';
import {
  api,
  hasToken,
  type OpenInAppInfo,
  type PathExistsApiResult,
  type Plan,
} from '../lib/api.ts';
import { candidatePathsForValidation, extractCandidateCodePaths } from '../lib/plan-paths.ts';

const OPEN_IN_APP_STORAGE_KEY = 'agendex_open_in_app';
/** Soft re-check while a plan stays open so newly created files can link up. */
const PATH_VALIDATION_REFRESH_MS = 30_000;
/** Must match PATH_EXISTS_BATCH_LIMIT in @agendex/shared. */
const PATH_EXISTS_BATCH_LIMIT = 500;

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
  paths: readonly string[],
): Promise<Record<string, PathExistsApiResult>> {
  const merged: Record<string, PathExistsApiResult> = {};
  for (let offset = 0; offset < paths.length; offset += PATH_EXISTS_BATCH_LIMIT) {
    const chunk = paths.slice(offset, offset + PATH_EXISTS_BATCH_LIMIT);
    const response = await api.checkPlanPaths(planId, chunk);
    Object.assign(merged, response.results);
  }
  return merged;
}

/**
 * Validate code-path candidates in a plan against its workspace via the
 * local API. Returns null when validation is unavailable (no token, no
 * workspace, or no candidates) so paths stay plain inline code.
 */
export function useValidatedPlanPaths(
  plan: Pick<Plan, 'id' | 'workspace'>,
  content: string,
): PlanPathContextValue | null {
  const [resultsState, setResultsState] = useState<{
    planId: string;
    results: Record<string, PathExistsApiResult>;
  }>({ planId: plan.id, results: {} });
  const [apps, setApps] = useState<OpenInAppInfo[]>([]);
  const [preferredAppId, setPreferredAppId] = useState('reveal');

  const paths = useMemo(
    () => candidatePathsForValidation(extractCandidateCodePaths(content)),
    [content],
  );

  // Drop prior-plan results immediately on switch so overlapping path strings
  // cannot briefly render/open with the previous workspace resolution.
  const results = resultsState.planId === plan.id ? resultsState.results : {};

  const enabled = Boolean(plan.workspace) && paths.length > 0 && hasToken();

  useEffect(() => {
    if (!enabled) {
      setResultsState({ planId: plan.id, results: {} });
      return;
    }

    let cancelled = false;
    let hasLoaded = false;
    let requestId = 0;

    const validate = (clearFirst: boolean) => {
      const id = ++requestId;
      if (clearFirst) setResultsState({ planId: plan.id, results: {} });
      void checkPlanPathsBatched(plan.id, paths)
        .then((nextResults) => {
          if (cancelled || id !== requestId) return;
          hasLoaded = true;
          setResultsState((current) => {
            if (current.planId === plan.id && pathResultsEqual(current.results, nextResults)) {
              return current;
            }
            return { planId: plan.id, results: nextResults };
          });
        })
        .catch(() => {
          // Cloud/shared viewers or offline: leave paths as plain code.
          if (cancelled || id !== requestId) return;
          if (clearFirst) setResultsState({ planId: plan.id, results: {} });
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
  }, [enabled, plan.id, paths]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void fetchOpenInApps().then((detected) => {
      if (cancelled) return;
      setApps(detected);
      setPreferredAppId(getPreferredOpenInApp(detected));
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const openPath = useCallback(
    async (path: string, line?: number, appId?: string): Promise<PlanPathOpenResult> => {
      const targetApp = appId ?? getPreferredOpenInApp(apps);
      try {
        const response = await api.openPlanPath(plan.id, path, line, targetApp);
        if (response.ok) {
          setPreferredOpenInApp(targetApp);
          setPreferredAppId(targetApp);
        }
        return response;
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Failed to open path' };
      }
    },
    [apps, plan.id],
  );

  return useMemo(() => {
    if (!enabled) return null;
    return { planId: plan.id, results, apps, preferredAppId, openPath };
  }, [enabled, plan.id, results, apps, preferredAppId, openPath]);
}
