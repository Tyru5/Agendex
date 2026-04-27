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

  const payload = planToSyncPayload(plan, 'device-1');

  expect(payload.metadata).toEqual({
    source: 'plannotator',
    agendexSync: { previous: true, deviceId: 'device-1' },
  });
  expect(plan.metadata).toEqual({
    source: 'plannotator',
    agendexSync: { previous: true },
  });
});
