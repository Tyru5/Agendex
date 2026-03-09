import {
  CLI_DAEMON_STALE_AFTER_MS,
  CLI_DAEMON_STATUS_TICK_MS,
} from '@agendex/shared/daemon-status';
import { api } from '@convex/_generated/api';
import { useQuery } from 'convex/react';
import { useEffect, useState } from 'react';

export type DaemonStatus = 'alive' | 'stale' | 'unknown';

export function useDaemonStatus(): DaemonStatus {
  const result = useQuery(api.cli.getDaemonStatus);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CLI_DAEMON_STATUS_TICK_MS);
    return () => clearInterval(id);
  }, []);

  if (result === undefined) return 'unknown';
  if (!result.lastSeenAt) return 'stale';
  const age = now - result.lastSeenAt;
  return age < CLI_DAEMON_STALE_AFTER_MS ? 'alive' : 'stale';
}
