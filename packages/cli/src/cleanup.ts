import { cancel, isCancel, multiselect } from '@clack/prompts';

export interface DaemonOption {
  deviceId: string;
  hostname: string;
  pid: number | null;
  status: 'alive' | 'stale';
}

export async function promptForDaemonCleanup(devices: DaemonOption[]): Promise<string[] | null> {
  const options = devices.map((d) => ({
    value: d.deviceId,
    label: d.hostname,
    hint: `pid: ${d.pid != null ? String(d.pid) : '~'} · ${d.status}`,
  }));

  const selected = await multiselect({
    message: 'Select daemons to remove',
    options,
    required: true,
  });

  if (isCancel(selected)) {
    cancel('Cleanup cancelled.');
    return null;
  }

  return selected as string[];
}
