import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.ts';
import {
  createPlanSourceSync,
  type PlanSourceSync,
  type PlanSourcesClient,
} from '../lib/plan-source-sync.ts';

/**
 * Keeps the configured custom plan sources in sync with the server. All reads and
 * removals share one serialized queue, so overlapping operations converge on the
 * server's latest snapshot instead of racing each other.
 */
export function useCustomPlanSources(enabled: boolean, client: PlanSourcesClient = api) {
  const [customPlanDirs, setCustomPlanDirs] = useState<string[]>([]);
  const syncRef = useRef<PlanSourceSync | null>(null);

  useEffect(() => {
    if (!enabled) {
      setCustomPlanDirs([]);
      return;
    }

    const sync = createPlanSourceSync(client, setCustomPlanDirs);
    syncRef.current = sync;
    sync.refresh().catch(reportSyncFailure);

    return () => {
      sync.dispose();
      syncRef.current = null;
    };
  }, [client, enabled]);

  const removeCustomDir = useCallback(async (dir: string) => {
    await syncRef.current?.remove(dir);
  }, []);

  const refreshCustomPlanDirs = useCallback(() => {
    syncRef.current?.refresh().catch(reportSyncFailure);
  }, []);

  return { customPlanDirs, removeCustomDir, refreshCustomPlanDirs };
}

function reportSyncFailure(error: unknown): void {
  console.error(
    'failed to fetch plan sources',
    error instanceof Error ? error : new Error(String(error)),
  );
}
