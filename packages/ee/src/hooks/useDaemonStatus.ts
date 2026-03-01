import { api } from '@convex/_generated/api';
import { useQuery } from 'convex/react';

export type DaemonStatus = 'alive' | 'stale' | 'unknown';

export function useDaemonStatus(): DaemonStatus {
  const result = useQuery(api.cli.getDaemonStatus);
  if (result === undefined) return 'unknown';
  return result.alive ? 'alive' : 'stale';
}
