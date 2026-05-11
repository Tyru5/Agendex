import { expect, test } from 'bun:test';
import type { Plan } from '@agendex/shared';
import { planToSyncPayload } from './payload.ts';

test('planToSyncPayload preserves metadata and records the syncing daemon device', () => {
  const plan: Plan = {
    id: 'local-1',
    agent: 'plannotator',
    title: 'Plan',
    content: '# Plan',
    filePath: '/tmp/plan.md',
    format: 'md',
    createdAt: new Date(1000),
    updatedAt: new Date(2000),
    metadata: {
      source: 'plannotator',
      agendexSync: { previous: true },
    },
  };

  const payload = planToSyncPayload(plan, 'device-1', 'my-laptop', '192.168.1.42');

  expect(payload.metadata).toEqual({
    source: 'plannotator',
    agendexSync: {
      previous: true,
      deviceId: 'device-1',
      hostname: 'my-laptop',
      ipAddress: '192.168.1.42',
    },
  });
  expect(plan.metadata).toEqual({
    source: 'plannotator',
    agendexSync: { previous: true },
  });
});

test('planToSyncPayload omits sync metadata when no provenance fields provided', () => {
  const plan: Plan = {
    id: 'local-2',
    agent: 'plannotator',
    title: 'Plan',
    content: '# Plan',
    filePath: '/tmp/plan.md',
    format: 'md',
    createdAt: new Date(1000),
    updatedAt: new Date(2000),
    metadata: { source: 'plannotator' },
  };

  const payload = planToSyncPayload(plan);

  expect(payload.metadata).toEqual({ source: 'plannotator' });
});

test('planToSyncPayload records ipAddress even when hostname/deviceId are absent', () => {
  const plan: Plan = {
    id: 'local-3',
    agent: 'plannotator',
    title: 'Plan',
    content: '# Plan',
    filePath: '/tmp/plan.md',
    format: 'md',
    createdAt: new Date(1000),
    updatedAt: new Date(2000),
    metadata: {},
  };

  const payload = planToSyncPayload(plan, undefined, undefined, '10.0.0.5');

  expect(payload.metadata).toEqual({
    agendexSync: { ipAddress: '10.0.0.5' },
  });
});
