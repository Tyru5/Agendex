import { expect, test } from 'bun:test';
import { decryptPlanBody, decryptPlanSummary, encryptPlanWrite } from './plan.ts';

test('encrypts plan summary, body, history, and keyed identities independently', () => {
  const workspaceKey = new Uint8Array(32).fill(11);
  const encrypted = encryptPlanWrite({
    workspaceKey,
    workspaceOwnerId: 'owner-1',
    keyEpoch: 3,
    stableCryptoId: 'plan-stable',
    versionStableCryptoId: 'version-stable',
    plan: {
      localPlanId: '/private/project/plan.md',
      agent: 'codex',
      title: 'Private plan',
      content: '# Secret\nDo the thing.',
      format: 'markdown',
      filePath: '/private/project/plan.md',
      workspace: '/private/project',
      metadata: { git: { branch: 'secret-branch' } },
      syncIdentity: 'sync-private',
      continuityIdentity: 'continuity-private',
      lowValue: false,
    },
  });

  expect(encrypted.title).toBe('');
  expect(encrypted.content).toBe('');
  expect(encrypted.localPlanId).toBe('');
  expect(encrypted.contentToken).not.toContain('Private');
  expect(encrypted.syncIdentityToken).not.toContain('private');
  expect(
    decryptPlanSummary({
      workspaceKey,
      workspaceOwnerId: 'owner-1',
      stableCryptoId: 'plan-stable',
      keyEpoch: 3,
      envelope: encrypted.encryptedSummary,
    }),
  ).toEqual({
    localPlanId: '/private/project/plan.md',
    title: 'Private plan',
    filePath: '/private/project/plan.md',
    workspace: '/private/project',
    metadata: { git: { branch: 'secret-branch' } },
  });
  expect(
    decryptPlanBody({
      workspaceKey,
      workspaceOwnerId: 'owner-1',
      stableCryptoId: 'plan-stable',
      keyEpoch: 3,
      envelope: encrypted.encryptedBody,
    }),
  ).toBe('# Secret\nDo the thing.');
  expect(
    decryptPlanBody({
      workspaceKey,
      workspaceOwnerId: 'owner-1',
      stableCryptoId: 'version-stable',
      keyEpoch: 3,
      envelope: encrypted.encryptedVersionBody,
      table: 'planVersions',
    }),
  ).toBe('# Secret\nDo the thing.');
});
