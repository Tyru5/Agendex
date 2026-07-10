import { type AdapterId, type AgendexConfig, getDefaultAdapterIds } from '@agendex/shared';

const PLANNOTATOR_ADAPTER_ID = 'plannotator' as AdapterId;

function envFlag(name: string): boolean | undefined {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return undefined;
  if (value === '1' || value === 'true' || value === 'yes' || value === 'on') return true;
  if (value === '0' || value === 'false' || value === 'no' || value === 'off') return false;
  return undefined;
}

export function shouldEnablePlannotatorSync(
  config: AgendexConfig,
  cloudConfigured = Boolean(config.cloudToken && config.convexUrl),
): boolean {
  const explicit = envFlag('AGENDEX_PLANNOTATOR_SYNC');
  if (explicit !== undefined) return explicit;

  // Plannotator sync is an EE/Pro daemon concern. The OSS local app only uses
  // the persisted enabledAdapters list; CLI sync/daemon can auto-enable this
  // adapter once the user has a cloud login target configured.
  return cloudConfigured;
}

export function resolveCliAdapterIds(
  config: AgendexConfig,
  cloudConfigured = Boolean(config.cloudToken && config.convexUrl),
): AdapterId[] {
  const ids =
    config.enabledAdapters.length > 0 ? [...config.enabledAdapters] : getDefaultAdapterIds();
  if (
    shouldEnablePlannotatorSync(config, cloudConfigured) &&
    !ids.includes(PLANNOTATOR_ADAPTER_ID)
  ) {
    ids.push(PLANNOTATOR_ADAPTER_ID);
  }
  return ids;
}
