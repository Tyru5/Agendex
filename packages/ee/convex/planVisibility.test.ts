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

test('mergePlanMetadata still merges object metadata and honors userCreated', () => {
  const merged = mergePlanMetadata(
    { lowValue: true, deviceId: 'dev-1' },
    { userCreated: true, title: 'My plan' },
  );
  expect(merged).toEqual({ deviceId: 'dev-1', userCreated: true, title: 'My plan' });
  expect(hasLowValueMetadata(merged)).toBe(false);
});
