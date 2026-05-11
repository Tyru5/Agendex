import { loadConfig } from '@agendex/shared';
import { fetchCliPreferences } from './api.ts';
import { shouldCollectLocalIpAddress } from './network.ts';

export async function shouldIncludeLocalIpAddressInSync(): Promise<boolean> {
  if (!shouldCollectLocalIpAddress()) return false;

  const prefs = await fetchCliPreferences();
  if (prefs) return prefs.collectLocalIpAddress;

  return loadConfig()?.collectLocalIpAddress ?? true;
}
