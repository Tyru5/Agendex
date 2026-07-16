import { basename, resolve } from 'node:path';
import { computePlanSyncIdentity, hashPath, type Plan } from '@agendex/shared';
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

export interface FileUploadParseResult {
  title: string;
  agent: string;
  /** Body content with any leading YAML frontmatter stripped. */
  body: string;
}

/**
 * Parse a standalone Markdown plan file the same way the shared generic-markdown
 * adapter does: title from the first `# heading` (else filename), agent from
 * `agent:` frontmatter when no override is provided (else the override, else `uploaded`).
 */
export function parseUploadFile(
  filePath: string,
  content: string,
  agentOverride?: string,
): FileUploadParseResult {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);

  const override = agentOverride?.trim();
  let agent = override || 'uploaded';
  if (!override && fmMatch) {
    const agentLine = fmMatch[1]?.match(/^agent:\s*(.+)$/m);
    if (agentLine?.[1]) agent = agentLine[1].trim();
  }

  const body = fmMatch ? content.slice(fmMatch[0].length) : content;
  const titleMatch = body.match(/^#\s+(.+)/m);
  const title = titleMatch?.[1]?.trim() || basename(filePath).replace(/\.md$/i, '') || 'Untitled';

  return { title, agent, body };
}

export interface FileToSyncPayloadOptions {
  agentOverride?: string;
  deviceId?: string;
  hostname?: string;
  ipAddress?: string;
  createdAt?: number;
  updatedAt?: number;
}

/**
 * Build a sync payload for a single standalone Markdown file (the `upload`
 * command). The localPlanId is a hash of the absolute file path so that
 * re-uploading the same file upserts the same cloud plan instead of duplicating.
 */
export function fileToSyncPayload(
  filePath: string,
  content: string,
  options: FileToSyncPayloadOptions = {},
): SyncPlanPayload {
  const absolutePath = resolve(filePath);
  const { title, agent, body } = parseUploadFile(absolutePath, content, options.agentOverride);
  const now = Date.now();

  const localPlanId = hashPath(absolutePath);
  const metadata = { uploaded: true, userCreated: true, planValueOverride: 'manual' };
  const identity = computePlanSyncIdentity({
    agent,
    title,
    content: body,
    format: 'md',
    filePath: absolutePath,
    metadata,
  });

  return {
    localPlanId,
    agent,
    title,
    content: body,
    format: 'md',
    filePath: absolutePath,
    metadata: withSyncDeviceMetadata(
      metadata,
      options.deviceId,
      options.hostname,
      options.ipAddress,
    ),
    createdAt: options.createdAt ?? now,
    updatedAt: options.updatedAt ?? now,
    ...identity,
  };
}

export function planToSyncPayload(
  plan: Plan,
  deviceId?: string,
  hostname?: string,
  ipAddress?: string,
): SyncPlanPayload {
  const identity = computePlanSyncIdentity({
    agent: plan.agent,
    title: plan.title,
    content: plan.content,
    format: plan.format,
    filePath: plan.filePath,
    workspace: plan.workspace,
    metadata: plan.metadata,
  });

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
    ...identity,
  };
}
