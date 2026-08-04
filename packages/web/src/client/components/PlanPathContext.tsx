import { createContext, useContext } from 'react';
import type { OpenInAppInfo, PathExistsApiResult } from '../lib/api.ts';
import type { PlanPathRemoteTarget } from '../lib/plan-path-targets.ts';

export interface PlanPathOpenResult {
  ok: boolean;
  error?: string;
}

export interface PlanPathContextValue {
  planId: string;
  /** Validation results keyed by cleaned candidate path. */
  results: Record<string, PathExistsApiResult>;
  /** Git-forge targets keyed by path + line range. */
  remoteTargets: Record<string, PlanPathRemoteTarget>;
  apps: OpenInAppInfo[];
  preferredAppId: string;
  openPath: (path: string, line?: number, appId?: string) => Promise<PlanPathOpenResult>;
}

/** Null when neither local validation nor a safe Git-forge target is available. */
export const PlanPathContext = createContext<PlanPathContextValue | null>(null);

export function usePlanPathContext(): PlanPathContextValue | null {
  return useContext(PlanPathContext);
}
