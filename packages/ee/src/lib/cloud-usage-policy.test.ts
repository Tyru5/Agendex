import { expect, test } from 'bun:test';
import {
  cloudUsageUnavailableReason,
  ENCRYPTED_CLOUD_USAGE_UNAVAILABLE,
} from './cloud-usage-policy.ts';

test('cloud usage is denied until policy is known', () => {
  expect(cloudUsageUnavailableReason(undefined)).toBeDefined();
  expect(cloudUsageUnavailableReason(null)).toBeDefined();
});

test('every encrypted lifecycle state disables cloud usage', () => {
  for (const state of ['preparing', 'sealing', 'sealed', 'rotating', 'failed']) {
    expect(cloudUsageUnavailableReason({ settings: { state } })).toBe(
      ENCRYPTED_CLOUD_USAGE_UNAVAILABLE,
    );
  }
});

test('known unencrypted workspaces retain cloud usage', () => {
  expect(cloudUsageUnavailableReason({ settings: null })).toBeUndefined();
  expect(cloudUsageUnavailableReason({ settings: { state: 'disabled' } })).toBeUndefined();
});
