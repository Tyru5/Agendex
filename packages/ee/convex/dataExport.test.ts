import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildExportManifest,
  decideExportBuildClaim,
  EXPORT_INVENTORY_TABLES,
  EXPORT_MANIFEST_VERSION,
  isExportDownloadAvailable,
  redactConnectedAccount,
  redactShareLink,
  walkCursorPages,
} from './dataExportRedaction';

test('redactShareLink omits passwordHash and sets passwordProtected', () => {
  expect(
    redactShareLink({
      _id: 'sl1',
      planId: 'plan1',
      token: 'tok',
      createdBy: 'user1',
      createdAt: 1,
      passwordHash: 'secret-hash',
    }),
  ).toEqual({
    _id: 'sl1',
    planId: 'plan1',
    token: 'tok',
    createdBy: 'user1',
    createdAt: 1,
    passwordProtected: true,
  });

  expect(
    redactShareLink({
      _id: 'sl2',
      planId: 'plan1',
      token: 'tok2',
      createdBy: 'user1',
      createdAt: 2,
    }),
  ).toEqual({
    _id: 'sl2',
    planId: 'plan1',
    token: 'tok2',
    createdBy: 'user1',
    createdAt: 2,
    passwordProtected: false,
  });
});

test('redactConnectedAccount strips OAuth secrets and passwords', () => {
  expect(
    redactConnectedAccount({
      _id: 'acc1',
      userId: 'user1',
      providerId: 'github',
      accountId: '123',
      accessToken: 'access',
      refreshToken: 'refresh',
      idToken: 'id',
      password: 'pwd',
      passwordHash: 'hash',
      createdAt: 1,
    }),
  ).toEqual({
    _id: 'acc1',
    userId: 'user1',
    providerId: 'github',
    accountId: '123',
    createdAt: 1,
  });
});

test('isExportDownloadAvailable respects ready status and expiresAt', () => {
  const now = 1_000_000;
  expect(
    isExportDownloadAvailable({
      status: 'ready',
      storageId: 'storage1',
      expiresAt: now + 1,
      now,
    }),
  ).toBe(true);
  expect(
    isExportDownloadAvailable({
      status: 'ready',
      storageId: 'storage1',
      expiresAt: now,
      now,
    }),
  ).toBe(false);
  expect(
    isExportDownloadAvailable({
      status: 'building',
      storageId: 'storage1',
      expiresAt: now + 1,
      now,
    }),
  ).toBe(false);
  expect(
    isExportDownloadAvailable({
      status: 'ready',
      storageId: null,
      expiresAt: now + 1,
      now,
    }),
  ).toBe(false);
});

test('buildExportManifest includes inventory and redaction notes', () => {
  const manifest = buildExportManifest({
    ownerId: 'user1',
    createdAt: 42,
    exportId: 'export1',
  });
  expect(manifest.version).toBe(EXPORT_MANIFEST_VERSION);
  expect(manifest.ownerId).toBe('user1');
  expect(manifest.exportId).toBe('export1');
  expect(manifest.createdAt).toBe(42);
  expect(manifest.inventory).toEqual([...EXPORT_INVENTORY_TABLES]);
  expect(manifest.redactions.length).toBeGreaterThan(0);
  expect(manifest.archiveLayout).toBe('streamed-single-zip');
  expect(manifest.collectionsLayout).toBe('collections-and-memberships');
});

test('walkCursorPages processes large exports without retaining an unbounded page', async () => {
  const totalRows = 10_005;
  const pageSize = 50;
  let visited = 0;
  let largestPage = 0;
  let calls = 0;

  await walkCursorPages(
    async (cursor) => {
      calls += 1;
      const start = cursor === null ? 0 : Number(cursor);
      const end = Math.min(start + pageSize, totalRows);
      const page = Array.from({ length: end - start }, (_, index) => start + index);
      return {
        page,
        isDone: end === totalRows,
        continueCursor: String(end),
      };
    },
    (page) => {
      visited += page.length;
      largestPage = Math.max(largestPage, page.length);
    },
  );

  expect(visited).toBe(totalRows);
  expect(largestPage).toBe(pageSize);
  expect(calls).toBe(Math.ceil(totalRows / pageSize));
});

test('export build claims are idempotent across duplicate and expired retries', () => {
  expect(
    decideExportBuildClaim({
      status: 'pending',
      proposedToken: 'attempt-a',
      now: 1_000,
    }),
  ).toBe('acquire');
  expect(
    decideExportBuildClaim({
      status: 'building',
      currentToken: 'attempt-a',
      leaseExpiresAt: 2_000,
      proposedToken: 'attempt-b',
      now: 1_000,
    }),
  ).toBe('retry');
  expect(
    decideExportBuildClaim({
      status: 'building',
      currentToken: 'attempt-a',
      leaseExpiresAt: 999,
      proposedToken: 'attempt-b',
      now: 1_000,
    }),
  ).toBe('acquire');
  expect(
    decideExportBuildClaim({
      status: 'ready',
      currentToken: 'attempt-a',
      leaseExpiresAt: 2_000,
      proposedToken: 'attempt-b',
      now: 1_000,
    }),
  ).toBe('terminal');
});

test('export implementation uses indexed cursor pages and a file-backed streaming archive', () => {
  const exportSource = readFileSync(join(import.meta.dir, 'dataExport.ts'), 'utf8');
  const actionSource = readFileSync(join(import.meta.dir, 'dataExportActions.ts'), 'utf8');
  const schemaSource = readFileSync(join(import.meta.dir, 'schema.ts'), 'utf8');

  expect(exportSource).not.toContain('.collect()');
  expect(exportSource).not.toContain(".query('comments')\n      .filter(");
  expect(exportSource).toContain(".withIndex('by_author'");
  expect(exportSource).toContain(".withIndex('by_owner'");
  expect(schemaSource).toContain(".index('by_author', ['authorId'])");
  expect(schemaSource).toContain(".index('by_owner', ['ownerId'])");
  expect(actionSource).toContain('generateNodeStream');
  expect(actionSource).toContain('streamFiles: true');
  expect(actionSource).toContain('openAsBlob');
  expect(actionSource).not.toContain('generateAsync');
  expect(actionSource).not.toContain('arrayBuffer()');
});

test('export inventory covers tables touched by purgeUserData and planDeletion', () => {
  const accountSource = readFileSync(join(import.meta.dir, 'account.ts'), 'utf8');
  const planDeletionSource = readFileSync(join(import.meta.dir, 'planDeletion.ts'), 'utf8');
  const commentsSource = readFileSync(join(import.meta.dir, 'comments.ts'), 'utf8');
  const agentAvatarsSource = readFileSync(join(import.meta.dir, 'agentAvatars.ts'), 'utf8');
  const combined = `${accountSource}\n${planDeletionSource}\n${commentsSource}\n${agentAvatarsSource}`;

  const required = [
    'plans',
    'planVersions',
    'planAnnotations',
    'comments',
    'commentAttachmentClaims',
    'pendingUploads',
    'commentUploadReservations',
    'shareLinks',
    'planLinks',
    'planTags',
    'tags',
    'collections',
    'collectionPlans',
    'planPreferences',
    'subscriptions',
    'accountPreferences',
    'workspaceMembers',
    'workspaceInvites',
    'daemonHeartbeats',
    'plannotatorWritebacks',
    'agentAvatars',
    'agentAvatarUploadReservations',
  ] as const;

  for (const table of required) {
    expect(EXPORT_INVENTORY_TABLES).toContain(table);
    expect(combined.includes(`'${table}'`) || combined.includes(`"${table}"`)).toBe(true);
  }

  const exportSource = readFileSync(join(import.meta.dir, 'dataExport.ts'), 'utf8');
  const actionSource = readFileSync(join(import.meta.dir, 'dataExportActions.ts'), 'utf8');
  expect(exportSource).toContain("query('commentAttachmentClaims')");
  expect(exportSource).toContain("query('agentAvatarUploadReservations')");
  expect(actionSource).toContain("'avatarUploadReservations'");
});
