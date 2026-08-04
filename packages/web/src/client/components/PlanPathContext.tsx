import { createContext, useContext } from 'react';
import type { OpenInAppInfo, PathExistsApiResult } from '../lib/api.ts';

export interface PlanPathOpenResult {
  ok: boolean;
  error?: string;
}

export interface PlanPathContextValue {
  planId: string;
  /** Validation results keyed by cleaned candidate path. */
  results: Record<string, PathExistsApiResult>;
  apps: OpenInAppInfo[];
  preferredAppId: string;
  openPath: (path: string, line?: number, appId?: string) => Promise<PlanPathOpenResult>;
}

/** Null outside local plan viewing (cloud/shared) — paths render as plain code. */
export const PlanPathContext = createContext<PlanPathContextValue | null>(null);

export function usePlanPathContext(): PlanPathContextValue | null {
  return useContext(PlanPathContext);
}
