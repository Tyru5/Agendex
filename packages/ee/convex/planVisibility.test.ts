import { expect, test } from 'bun:test';
import { hasLowValueMetadata, mergePlanMetadata } from './planVisibility.ts';

test('mergePlanMetadata clears stale lowValue when incoming metadata is missing', () => {
  const merged = mergePlanMetadata({ lowValue: true, deviceId: 'dev-1' }, undefined);
  expect(merged).toEqual({ deviceId: 'dev-1' });
  expect(hasLowValueMetadata(merged)).toBe(false);
});

test('mergePlanMetadata clears stale lowValue when incoming metadata is not an object', () => {
  const merged = mergePlanMetadata({ lowValue: true, hostname: 'laptop' }, 'invalid');
  expect(merged).toEqual({ hostname: 'laptop' });
  expect(hasLowValueMetadata(merged)).toBe(false);
});

test('mergePlanMetadata clears stale lowValue when incoming object omits low-value fields', () => {
  const merged = mergePlanMetadata({ lowValue: true, deviceId: 'dev-1' }, { deviceId: 'dev-2' });
  expect(merged).toEqual({ deviceId: 'dev-2' });
  expect(hasLowValueMetadata(merged)).toBe(false);
});

test('mergePlanMetadata preserves explicit lowValue on incoming object metadata', () => {
  const merged = mergePlanMetadata(
    { deviceId: 'dev-1' },
    { lowValue: true, lowValueReasons: ['heading-only'] },
  );
  expect(merged).toEqual({ deviceId: 'dev-1', lowValue: true, lowValueReasons: ['heading-only'] });
  expect(hasLowValueMetadata(merged)).toBe(true);
});

test('mergePlanMetadata still merges object metadata and honors userCreated', () => {
  const merged = mergePlanMetadata(
    { lowValue: true, deviceId: 'dev-1' },
    { userCreated: true, title: 'My plan' },
  );
  expect(merged).toEqual({ deviceId: 'dev-1', userCreated: true, title: 'My plan' });
  expect(hasLowValueMetadata(merged)).toBe(false);
});
