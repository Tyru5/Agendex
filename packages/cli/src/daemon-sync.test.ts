import { expect, test } from 'bun:test';
import type { SyncPlanPayload } from './api.ts';
import { computePayloadHash } from './sync-cache.ts';
import {
  createSyncPayloadOrder,
  dedupeSyncPayloads,
  filterPayloadsNeedingSync,
  nextRetryDelayMs,
  parseEnvMs,
  payloadNeedsSync,
} from './daemon-sync.ts';

function payload(overrides: Partial<SyncPlanPayload> = {}): SyncPlanPayload {
  return {
    localPlanId: 'plan-1',
    agent: 'cursor',
    title: 'Plan',
    content: '# Plan',
    format: 'md',
    ...overrides,
  };
}

test('dedupeSyncPayloads keeps the latest payload per localPlanId', () => {
  const first = payload({ content: '# v1' });
  const second = payload({ content: '# v2' });
  const third = payload({ localPlanId: 'plan-2', content: '# other' });

  const deduped = dedupeSyncPayloads([first, second, third]);
  expect(deduped).toHaveLength(2);
  expect(deduped.find((p) => p.localPlanId === 'plan-1')?.content).toBe('# v2');
});

test('filterPayloadsNeedingSync skips unchanged hashes', () => {
  const current = payload({ content: '# unchanged' });
  const changed = payload({ localPlanId: 'plan-2', content: '# changed' });
  const cache = {
    [current.localPlanId]: computePayloadHash(current),
  };

  const needingSync = filterPayloadsNeedingSync([current, changed], cache);
  expect(needingSync).toHaveLength(1);
  expect(needingSync[0]?.localPlanId).toBe('plan-2');
  expect(payloadNeedsSync(current, cache)).toBe(false);
  expect(payloadNeedsSync(changed, cache)).toBe(true);
});

test('parseEnvMs reads positive integers and falls back on invalid values', () => {
  const key = 'AGENDEX_TEST_SYNC_MS';

  delete process.env[key];
  expect(parseEnvMs(key, 1234)).toBe(1234);

  process.env[key] = '5000';
  expect(parseEnvMs(key, 1234)).toBe(5000);

  process.env[key] = '-1';
  expect(parseEnvMs(key, 1234)).toBe(1234);

  process.env[key] = 'nope';
  expect(parseEnvMs(key, 1234)).toBe(1234);

  delete process.env[key];
});

test('nextRetryDelayMs returns backoff steps then undefined', () => {
  expect(nextRetryDelayMs(0)).toBe(2000);
  expect(nextRetryDelayMs(1)).toBe(8000);
  expect(nextRetryDelayMs(2)).toBe(30000);
  expect(nextRetryDelayMs(3)).toBeUndefined();
});

test('sync order lets metadata-only changes with the same updatedAt supersede older payloads', () => {
  const order = createSyncPayloadOrder();
  const synced = payload({ updatedAt: 100, metadata: { planValue: 'low' } });
  const restored = payload({ updatedAt: 100, metadata: { planValueOverride: 'manual' } });
  const syncedRef = { updatedAt: 100, sequence: order.sequenceOf(synced) };
  order.sequenceOf(restored);
  expect(order.isSuperseded(restored, syncedRef)).toBe(false);
  expect(order.isSuperseded(synced, syncedRef)).toBe(true);
  const restoredRef = { updatedAt: 100, sequence: order.sequenceOf(restored) };
  expect(order.isSuperseded(synced, restoredRef)).toBe(true);
  expect(order.isSuperseded(payload({ updatedAt: 99 }), restoredRef)).toBe(true);
  expect(order.isSuperseded(payload({ updatedAt: 101 }), restoredRef)).toBe(false);
  expect(order.isSuperseded(restored, undefined)).toBe(false);
});
