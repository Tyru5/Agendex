import { expect, test } from 'bun:test';
import { canUseCloudPlanMetadata, shouldQueryCloudPlanTags } from './cloud-query-mode.ts';

test('Given local mode with Pro tags selected When checking cloud tag query eligibility Then it is skipped', () => {
  expect(
    shouldQueryCloudPlanTags({
      mode: 'local',
      isPro: true,
      selectedTagCount: 1,
      planCount: 1,
    }),
  ).toBe(false);
});

test('Given cloud mode with Pro tags selected When checking cloud tag query eligibility Then it runs', () => {
  expect(
    shouldQueryCloudPlanTags({
      mode: 'cloud',
      isPro: true,
      selectedTagCount: 1,
      planCount: 1,
    }),
  ).toBe(true);
});

test('Given local Pro mode When checking cloud metadata eligibility Then cloud-only UI is disabled', () => {
  expect(canUseCloudPlanMetadata('local', true)).toBe(false);
  expect(canUseCloudPlanMetadata('cloud', true)).toBe(true);
});
