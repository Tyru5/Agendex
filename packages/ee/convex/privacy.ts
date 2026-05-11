const SYNC_METADATA_KEY = 'agendexSync';
const LOCAL_IP_KEY = 'ipAddress';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function stripLocalIpFromMetadata(metadata: unknown): {
  metadata: unknown;
  changed: boolean;
} {
  if (!isRecord(metadata)) return { metadata, changed: false };

  const syncMetadata = metadata[SYNC_METADATA_KEY];
  if (!isRecord(syncMetadata) || !(LOCAL_IP_KEY in syncMetadata)) {
    return { metadata, changed: false };
  }

  const { [LOCAL_IP_KEY]: _ipAddress, ...syncWithoutLocalIp } = syncMetadata;
  const nextMetadata = { ...metadata };

  if (Object.keys(syncWithoutLocalIp).length > 0) {
    nextMetadata[SYNC_METADATA_KEY] = syncWithoutLocalIp;
  } else {
    delete nextMetadata[SYNC_METADATA_KEY];
  }

  return { metadata: nextMetadata, changed: true };
}
