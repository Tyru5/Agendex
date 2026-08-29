/** Tables covered by account purge / plan deletion — keep export inventory aligned. */
export const EXPORT_INVENTORY_TABLES = [
  'plans',
  'planVersions',
  'planAnnotations',
  'comments',
  'commentAttachmentClaims',
  'commentUploadReservations',
  'pendingUploads',
  'shareLinks',
  'planLinks',
  'planTags',
  'tags',
  'collections',
  'collectionPlans',
  'planPreferences',
  'agentAvatars',
  'agentAvatarUploadReservations',
  'accountPreferences',
  'daemonHeartbeats',
  'plannotatorWritebacks',
  'subscriptions',
  'workspaceMembers',
  'workspaceInvites',
] as const;

export const EXPORT_MANIFEST_VERSION = 1;

export const DATA_EXPORT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Ready exports only serve a download URL before expiresAt. */
export function isExportDownloadAvailable(args: {
  status: string;
  storageId: unknown;
  expiresAt: number;
  now?: number;
}): boolean {
  const now = args.now ?? Date.now();
  return args.status === 'ready' && args.storageId != null && args.expiresAt > now;
}

export const EXPORT_REDACTION_NOTES = [
  'OAuth accessToken, refreshToken, idToken, and password fields are omitted from connected accounts.',
  'Share-link passwordHash values are omitted; passwordProtected is set instead.',
] as const;

export type ShareLinkForExport = {
  _id: string;
  planId: string;
  token: string;
  createdBy: string;
  createdAt: number;
  passwordHash?: string;
};

export function redactShareLink(link: ShareLinkForExport) {
  const { passwordHash, ...rest } = link;
  return {
    ...rest,
    passwordProtected: typeof passwordHash === 'string' && passwordHash.length > 0,
  };
}

const CONNECTED_ACCOUNT_SECRET_KEYS = new Set([
  'accessToken',
  'refreshToken',
  'idToken',
  'password',
  'passwordHash',
]);

export function redactConnectedAccount(account: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(account)) {
    if (CONNECTED_ACCOUNT_SECRET_KEYS.has(key)) continue;
    redacted[key] = value;
  }
  return redacted;
}

export function buildExportManifest(args: {
  ownerId: string;
  createdAt: number;
  exportId: string;
}) {
  return {
    version: EXPORT_MANIFEST_VERSION,
    exportId: args.exportId,
    ownerId: args.ownerId,
    createdAt: args.createdAt,
    inventory: [...EXPORT_INVENTORY_TABLES],
    redactions: [...EXPORT_REDACTION_NOTES],
  };
}
