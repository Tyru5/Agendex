import { expect, test } from 'bun:test';
import { decryptPlanBody, decryptPlanSummary, encryptPlanWrite } from '@agendex/shared/crypto';
import { buildEncryptedPlanContentEdit, buildEncryptedPlanRename } from './cloud-plan-edits';

const workspaceKey = new Uint8Array(32).fill(7);
const workspaceOwnerId = 'edit-owner';
const keyEpoch = 2;

function fixture() {
  const original = {
    localPlanId: 'local-plan',
    agent: 'claude',
    title: 'Private title',
    content: '# Private plan\nOriginal steps',
    format: 'markdown',
    filePath: '/workspace/private/plan.md',
    workspace: 'private workspace',
    metadata: { custom: 'private metadata' },
    lowValue: false,
  };
  const encrypted = encryptPlanWrite({ workspaceKey, workspaceOwnerId, keyEpoch, plan: original });
  return {
    original,
    context: {
      workspaceKey,
      workspaceOwnerId,
      keyEpoch,
      plan: { ...encrypted, ownerId: workspaceOwnerId },
    },
  };
}

test('encrypted rename preserves private identity and metadata without sending plaintext', () => {
  const { context, original } = fixture();
  const args = buildEncryptedPlanRename({ ...context, title: 'Renamed private title' });
  expect(args.title).toBe('');
  const summary = decryptPlanSummary({
    ...context,
    stableCryptoId: context.plan.stableCryptoId,
    envelope: args.encryptedSummary,
  });
  expect(summary).toEqual({
    localPlanId: original.localPlanId,
    title: 'Renamed private title',
    filePath: original.filePath,
    workspace: original.workspace,
    metadata: original.metadata,
  });
  expect(JSON.stringify(args)).not.toContain('private');
});

test('encrypted edits seal live and history content under their own record identities', () => {
  const { context, original } = fixture();
  const content = '# Changed private plan\n1. Implement\n2. Test';
  const args = buildEncryptedPlanContentEdit({ ...context, title: original.title, content });
  expect(args.title).toBe('');
  expect(args.content).toBe('');
  expect(JSON.stringify(args)).not.toContain('private');
  expect(
    decryptPlanBody({
      ...context,
      stableCryptoId: context.plan.stableCryptoId,
      envelope: args.encryptedBody,
    }),
  ).toBe(content);
  expect(
    decryptPlanBody({
      ...context,
      stableCryptoId: args.versionStableCryptoId,
      table: 'planVersions',
      envelope: args.encryptedVersionBody,
    }),
  ).toBe(content);
  expect(() =>
    decryptPlanBody({
      ...context,
      stableCryptoId: args.versionStableCryptoId,
      envelope: args.encryptedVersionBody,
    }),
  ).toThrow();
  const summary = decryptPlanSummary({
    ...context,
    stableCryptoId: args.versionStableCryptoId,
    table: 'planVersions',
    envelope: args.encryptedVersionSummary,
  });
  expect(summary.localPlanId).toBe(original.localPlanId);
  expect(summary.filePath).toBe(original.filePath);
  expect(summary.metadata).toEqual(original.metadata);
});

test('plan edits reject stale epochs, another owner, and missing encrypted summaries', () => {
  const { context } = fixture();
  for (const plan of [
    { ...context.plan, keyEpoch: 1 },
    { ...context.plan, ownerId: 'another-owner' },
    { ...context.plan, encryptedSummary: undefined },
  ]) {
    expect(() => buildEncryptedPlanRename({ ...context, plan, title: 'change' })).toThrow('Reload');
    expect(() =>
      buildEncryptedPlanContentEdit({ ...context, plan, title: 'change', content: 'body' }),
    ).toThrow('Reload');
  }
});
