import { expect, test } from 'bun:test';
import type { Id } from './_generated/dataModel';
import { toSharedPlanDto } from './sharedPlanDto';

const SHARED_PLAN_FIELDS = ['_id', 'agent', 'content', 'createdAt', 'format', 'title'];

test('shared plan DTO returns only the public allowlist', () => {
  const rawPlan = {
    _id: 'plan-1' as Id<'plans'>,
    agent: 'claude-code',
    title: 'Safe plan',
    content: '# Plan\n\nPublic content',
    format: 'markdown',
    createdAt: 1_700_000_000_000,
    ownerId: 'owner-secret',
    localPlanId: 'local-secret',
    filePath: '/Users/alice/private/project/plan.md',
    workspace: '/Users/alice/private/project',
    metadata: { hostname: 'alice-macbook', deviceId: 'device-secret' },
    plannotatorContinuityKey: 'continuity-secret',
    syncIdentityKey: 'sync-secret',
    contentHash: 'hash-secret',
    identityVersion: 1,
    identityStrength: 'strong',
    version: 7,
    updatedAt: 1_700_000_100_000,
    _creationTime: 1_700_000_000_000,
  };
  const dto = toSharedPlanDto(rawPlan);
  expect(Object.keys(dto).sort()).toEqual(SHARED_PLAN_FIELDS);
  expect(dto).toEqual({
    _id: 'plan-1',
    agent: 'claude-code',
    title: 'Safe plan',
    content: '# Plan\n\nPublic content',
    format: 'markdown',
    createdAt: 1_700_000_000_000,
  });
});
