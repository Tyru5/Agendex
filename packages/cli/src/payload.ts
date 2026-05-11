import type { Plan } from '@agendex/shared';
import type { SyncPlanPayload } from './api.ts';

const SYNC_METADATA_KEY = 'agendexSync';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function withSyncDeviceMetadata(
  metadata: Record<string, unknown>,
  deviceId: string | undefined,
  hostname: string | undefined,
  ipAddress: string | undefined,
): Record<string, unknown> {
  if (!deviceId && !hostname && !ipAddress) return metadata;
  const existing = isRecord(metadata[SYNC_METADATA_KEY]) ? metadata[SYNC_METADATA_KEY] : {};
  return {
    ...metadata,
    [SYNC_METADATA_KEY]: {
      ...existing,
      ...(deviceId !== undefined && { deviceId }),
      ...(hostname !== undefined && { hostname }),
      ...(ipAddress !== undefined && { ipAddress }),
    },
  };
}

export function planToSyncPayload(
  plan: Plan,
  deviceId?: string,
  hostname?: string,
  ipAddress?: string,
): SyncPlanPayload {
  return {
    localPlanId: plan.id,
    agent: plan.agent,
    title: plan.title,
    content: plan.content,
    format: plan.format,
    filePath: plan.filePath,
    workspace: plan.workspace,
    metadata: withSyncDeviceMetadata(plan.metadata, deviceId, hostname, ipAddress),
    createdAt: plan.createdAt.getTime(),
    updatedAt: plan.updatedAt.getTime(),
  };
}
