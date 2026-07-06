export type PlanSyncIdentityStrength = 'strong' | 'path' | 'content';

export interface PlanSyncIdentityInput {
  agent: string;
  title: string;
  content: string;
  format: string;
  filePath?: string;
  workspace?: string;
  metadata?: unknown;
}

export interface PlanSyncIdentity {
  syncIdentityKey?: string;
  contentHash: string;
  identityVersion: number;
  identityStrength: PlanSyncIdentityStrength;
}

export const PLAN_SYNC_IDENTITY_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizeSyncPath(path: string): string {
  let normalized = path.trim().replace(/\\+/g, '/').replace(/\/+/g, '/');
  normalized = normalized.replace(
    /^([A-Z]):/,
    (_match, drive: string) => `${drive.toLowerCase()}:`,
  );
  if (normalized.length > 1) normalized = normalized.replace(/\/+$/, '');
  return normalized;
}

function removeLeadingDotSlash(path: string): string {
  return path.replace(/^\.\/+/, '').replace(/^\/+/, '');
}

export function relativeSyncPath(filePath?: string, workspace?: string): string | undefined {
  const normalizedFile = filePath ? normalizeSyncPath(filePath) : undefined;
  if (!normalizedFile) return undefined;

  if (workspace) {
    const normalizedWorkspace = normalizeSyncPath(workspace);
    if (normalizedFile === normalizedWorkspace) return undefined;
    if (normalizedFile.startsWith(`${normalizedWorkspace}/`)) {
      return removeLeadingDotSlash(normalizedFile.slice(normalizedWorkspace.length + 1));
    }
  }

  return undefined;
}

function relativePathFromMetadata(filePath: string | undefined, metadata: Record<string, unknown>) {
  const customDir = stringValue(metadata.customDir);
  if (customDir) return relativeSyncPath(filePath, customDir);

  const userPlansDir = stringValue(metadata.userPlansDir);
  if (userPlansDir) return relativeSyncPath(filePath, userPlansDir);

  return undefined;
}

function stableHash(input: string): string {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;

  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  const a = (h2 >>> 0).toString(16).padStart(8, '0');
  const b = (h1 >>> 0).toString(16).padStart(8, '0');
  return `${a}${b}`;
}

function normalizedContentForHash(
  input: Pick<PlanSyncIdentityInput, 'title' | 'content' | 'format'>,
) {
  return JSON.stringify({
    title: normalizeWhitespace(input.title),
    content: input.content.replace(/\r\n?/g, '\n').trimEnd(),
    format: input.format,
  });
}

export function computeContentHash(
  input: Pick<PlanSyncIdentityInput, 'title' | 'content' | 'format'>,
) {
  return stableHash(normalizedContentForHash(input));
}

function plannotatorIdentity(
  metadata: Record<string, unknown>,
  filePath?: string,
): string | undefined {
  const plannotator = isRecord(metadata.plannotator) ? metadata.plannotator : undefined;
  if (!plannotator) return undefined;

  const sourcePlanPath = stringValue(plannotator.sourcePlanPath);
  if (sourcePlanPath) return `plannotator:source:${normalizeSyncPath(sourcePlanPath)}`;

  const reviewId = stringValue(plannotator.reviewId);
  if (reviewId) return `plannotator:review:${reviewId}`;

  const project = stringValue(plannotator.project);
  const label = stringValue(plannotator.label);
  const mode = stringValue(plannotator.mode) ?? 'plan';
  if (project && label) return `plannotator:project:${project}:label:${label}:mode:${mode}`;

  const path = filePath ? normalizeSyncPath(filePath) : undefined;
  if (path) return `plannotator:path:${path}`;

  const sessionPath = stringValue(plannotator.sessionPath);
  if (sessionPath) return `plannotator:path:${normalizeSyncPath(sessionPath)}`;

  return undefined;
}

function stableMetadataId(agent: string, metadata: Record<string, unknown>): string | undefined {
  const keys = [
    'sessionId',
    'session_id',
    'conversationId',
    'conversation_id',
    'sourceId',
    'source_id',
    'planId',
    'plan_id',
  ];

  for (const key of keys) {
    const value = stringValue(metadata[key]);
    if (value) return `${agent}:metadata:${key}:${value}`;
  }

  return undefined;
}

export function computePlanSyncIdentity(input: PlanSyncIdentityInput): PlanSyncIdentity {
  const metadata = isRecord(input.metadata) ? input.metadata : {};
  const contentHash = computeContentHash(input);
  const agent = input.agent.trim() || 'unknown';

  const plannotatorKey = plannotatorIdentity(metadata, input.filePath);
  if (plannotatorKey) {
    return {
      syncIdentityKey: `v${PLAN_SYNC_IDENTITY_VERSION}:${plannotatorKey}`,
      contentHash,
      identityVersion: PLAN_SYNC_IDENTITY_VERSION,
      identityStrength: 'strong',
    };
  }

  const metadataId = stableMetadataId(agent, metadata);
  if (metadataId) {
    return {
      syncIdentityKey: `v${PLAN_SYNC_IDENTITY_VERSION}:${metadataId}`,
      contentHash,
      identityVersion: PLAN_SYNC_IDENTITY_VERSION,
      identityStrength: 'strong',
    };
  }

  const projectRelativePath = relativeSyncPath(input.filePath, input.workspace);
  if (projectRelativePath) {
    return {
      syncIdentityKey: `v${PLAN_SYNC_IDENTITY_VERSION}:${agent}:path:${projectRelativePath}`,
      contentHash,
      identityVersion: PLAN_SYNC_IDENTITY_VERSION,
      identityStrength: 'path',
    };
  }

  const metadataRelativePath = relativePathFromMetadata(input.filePath, metadata);
  if (metadataRelativePath) {
    const source = stringValue(metadata.source) ?? 'metadata-root';
    return {
      syncIdentityKey: `v${PLAN_SYNC_IDENTITY_VERSION}:${agent}:${source}:path:${metadataRelativePath}`,
      contentHash,
      identityVersion: PLAN_SYNC_IDENTITY_VERSION,
      identityStrength: 'path',
    };
  }

  return {
    contentHash,
    identityVersion: PLAN_SYNC_IDENTITY_VERSION,
    identityStrength: 'content',
  };
}

export function exactDuplicateKey(
  input: Pick<PlanSyncIdentityInput, 'agent' | 'title'> & { contentHash: string },
) {
  return `${input.agent.trim() || 'unknown'}:${normalizeWhitespace(input.title).toLowerCase()}:${input.contentHash}`;
}
