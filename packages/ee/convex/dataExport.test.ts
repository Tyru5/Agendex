import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildExportManifest,
  EXPORT_INVENTORY_TABLES,
  EXPORT_MANIFEST_VERSION,
  isExportDownloadAvailable,
  redactConnectedAccount,
  redactShareLink,
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
  expect(exportSource).toContain("query('commentAttachmentClaims')");
});
