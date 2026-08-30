import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ACCOUNT_DELETION_BATCH_SIZE,
  ACCOUNT_DELETION_PHASES,
  accountDeletionPhaseAfterBatch,
  accountDeletionRetryDelayMs,
  isStripeSubscriptionAlreadyCanceled,
  nextAccountDeletionPhase,
} from './accountDeletionState';
import {
  nextPlanDeletionPhase,
  PLAN_DELETION_PHASES,
  planDeletionPhaseAfterBatch,
} from './planDeletion';

test('every account deletion phase is restart-safe and advances only after it drains', () => {
  for (const phase of ACCOUNT_DELETION_PHASES) {
    if (phase === 'authUser') {
      expect(nextAccountDeletionPhase(phase)).toBeNull();
      continue;
    }

    const interrupted = accountDeletionPhaseAfterBatch(phase, ACCOUNT_DELETION_BATCH_SIZE);
    expect(interrupted).toBe(phase);

    const retriedWithRemainingRows = accountDeletionPhaseAfterBatch(interrupted, 1);
    expect(retriedWithRemainingRows).toBe(phase);

    const drained = accountDeletionPhaseAfterBatch(retriedWithRemainingRows, 0);
    expect(drained).toBe(nextAccountDeletionPhase(phase));
  }
});

test('every per-plan phase resumes after interruption before the plan can be deleted', () => {
  for (const phase of PLAN_DELETION_PHASES) {
    const interrupted = planDeletionPhaseAfterBatch(phase, ACCOUNT_DELETION_BATCH_SIZE);
    expect(interrupted).toBe(phase);
    expect(planDeletionPhaseAfterBatch(interrupted, 1)).toBe(phase);
    expect(planDeletionPhaseAfterBatch(interrupted, 0)).toBe(nextPlanDeletionPhase(phase));
  }
  expect(nextPlanDeletionPhase(PLAN_DELETION_PHASES.at(-1)!)).toBeNull();
});

test('Stripe cancellation treats already-gone subscriptions as retry success only', () => {
  expect(isStripeSubscriptionAlreadyCanceled({ code: 'resource_missing' })).toBe(true);
  expect(isStripeSubscriptionAlreadyCanceled({ statusCode: 404 })).toBe(true);
  expect(isStripeSubscriptionAlreadyCanceled({ message: 'No such subscription: sub_123' })).toBe(
    true,
  );
  expect(isStripeSubscriptionAlreadyCanceled({ message: 'Subscription already canceled' })).toBe(
    true,
  );
  expect(isStripeSubscriptionAlreadyCanceled({ statusCode: 429, message: 'rate limited' })).toBe(
    false,
  );
});

test('phase failures use bounded exponential retry delays', () => {
  expect(accountDeletionRetryDelayMs(0)).toBe(5_000);
  expect(accountDeletionRetryDelayMs(1)).toBe(10_000);
  expect(accountDeletionRetryDelayMs(8)).toBe(15 * 60 * 1_000);
  expect(accountDeletionRetryDelayMs(100)).toBe(15 * 60 * 1_000);
});

test('deletion marks state before Stripe and leaves Better Auth until product data drains', () => {
  const source = readFileSync(join(import.meta.dir, 'account.ts'), 'utf8');
  const insertJob = source.indexOf("ctx.db.insert('accountDeletionJobs'");
  const stripeCancel = source.indexOf('stripeClient.subscriptions.cancel');
  expect(insertJob).toBeGreaterThan(-1);
  expect(stripeCancel).toBeGreaterThan(insertJob);

  const productEnd = ACCOUNT_DELETION_PHASES.indexOf('accountPreferences');
  expect(ACCOUNT_DELETION_PHASES.indexOf('authSessions')).toBeGreaterThan(productEnd);
  expect(ACCOUNT_DELETION_PHASES.indexOf('authAccounts')).toBeGreaterThan(productEnd);
  expect(ACCOUNT_DELETION_PHASES.at(-1)).toBe('authUser');
});

test('account deletion batches all owned storage-backed and relational data', () => {
  const accountSource = readFileSync(join(import.meta.dir, 'account.ts'), 'utf8');
  const planDeletionSource = readFileSync(join(import.meta.dir, 'planDeletion.ts'), 'utf8');
  const batchPlanDeletionSource = planDeletionSource.slice(
    0,
    planDeletionSource.indexOf('export async function deletePlanRelatedData('),
  );

  expect(accountSource).not.toContain('.collect()');
  expect(accountSource).not.toContain('.filter(');
  expect(batchPlanDeletionSource).not.toContain('.collect()');
  expect(batchPlanDeletionSource).toContain('.take(batchSize)');

  for (const table of [
    'plans',
    'comments',
    'planAnnotations',
    'shareLinks',
    'planVersions',
    'planLinks',
    'plannotatorWritebacks',
    'planTags',
    'planPreferences',
    'collectionPlans',
    'tags',
    'collections',
    'pendingUploads',
    'commentUploadReservations',
    'agentAvatars',
    'agentAvatarUploadReservations',
    'dataExports',
    'workspaceMembers',
    'workspaceInvites',
    'daemonHeartbeats',
    'subscriptions',
    'accountPreferences',
  ]) {
    expect(accountSource.includes(`'${table}'`) || planDeletionSource.includes(`'${table}'`)).toBe(
      true,
    );
  }

  expect(accountSource).toContain('deleteStorageObjectIfPresent(ctx, row.storageId)');
  expect(accountSource).toContain('components.betterAuth.adapter.deleteOne');
});

test('in-flight exports cannot recreate a blob after their deletion job is removed', () => {
  const source = readFileSync(join(import.meta.dir, 'dataExport.ts'), 'utf8');
  const deletionGuard = source.indexOf("query('accountDeletionJobs')");
  const exportInsert = source.indexOf("ctx.db.insert('dataExports'");
  expect(deletionGuard).toBeGreaterThan(-1);
  expect(exportInsert).toBeGreaterThan(deletionGuard);

  const missingJobCleanup = source.slice(source.indexOf('export const markExportReady'));
  expect(missingJobCleanup).toContain("job.status !== 'building'");
  expect(missingJobCleanup).toContain('job.buildToken !== args.buildToken');
  expect(missingJobCleanup).toContain('ctx.db.system.get(args.storageId)');
  expect(missingJobCleanup).toContain('ctx.storage.delete(args.storageId)');
});
