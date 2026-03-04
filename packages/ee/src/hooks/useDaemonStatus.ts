import { useEffect, useState } from 'react';
import { api } from '@convex/_generated/api';
import { useQuery } from 'convex/react';

const HEARTBEAT_STALE_MS = 90_000;
const POLL_INTERVAL_MS = 15_000;

export type DaemonStatus = 'alive' | 'stale' | 'unknown';

export function useDaemonStatus(): DaemonStatus {
  const result = useQuery(api.cli.getDaemonStatus);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  console.log('[daemon-status] result:', JSON.stringify(result), 'now:', now);
  if (result === undefined) return 'unknown';
  if (!result.lastSeenAt) return 'stale';
  const age = now - result.lastSeenAt;
  const status = age < HEARTBEAT_STALE_MS ? 'alive' : 'stale';
  console.log('[daemon-status]', { age, status });
  return status;
}
