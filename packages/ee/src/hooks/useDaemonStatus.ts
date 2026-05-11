import {
  CLI_DAEMON_STALE_AFTER_MS,
  CLI_DAEMON_STATUS_POLL_INTERVAL_MS,
} from '@agendex/shared/daemon-status';
import { api } from '@convex/_generated/api';
import { useQuery } from 'convex/react';
import { useEffect, useMemo, useState } from 'react';

export interface DaemonDeviceInfo {
  deviceId: string | null;
  hostname: string | null;
  ipAddress: string | null;
  startedAtMs: number | null;
  uptimeMs: number | null;
  lastSeenAt: number | null;
  status: 'alive' | 'stale';
}

export interface DaemonStatusResult {
  aggregateStatus: 'alive' | 'stale' | 'unknown';
  devices: DaemonDeviceInfo[];
}

export function useDaemonStatus(): DaemonStatusResult {
  const result = useQuery(api.cli.getDaemonStatus);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CLI_DAEMON_STATUS_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return useMemo(() => {
    if (result === undefined) return { aggregateStatus: 'unknown' as const, devices: [] };

    const devices: DaemonDeviceInfo[] = result.devices.map((d) => {
      const age = d.lastSeenAt ? now - d.lastSeenAt : Number.POSITIVE_INFINITY;
      const status = age < CLI_DAEMON_STALE_AFTER_MS ? ('alive' as const) : ('stale' as const);
      return {
        deviceId: d.deviceId ?? null,
        hostname: d.hostname ?? null,
        ipAddress: d.ipAddress ?? null,
        startedAtMs: d.startedAtMs ?? null,
        uptimeMs: d.startedAtMs != null ? now - d.startedAtMs : null,
        lastSeenAt: d.lastSeenAt ?? null,
        status,
      };
    });

    const aggregateStatus =
      devices.length === 0
        ? ('stale' as const)
        : devices.some((d) => d.status === 'alive')
          ? ('alive' as const)
          : ('stale' as const);

    return { aggregateStatus, devices };
  }, [result, now]);
}
