import { describe, expect, test } from 'bun:test';
import { isProductTourPending, PRODUCT_TOUR_VERSION } from './productTour.ts';

const noop = () => {};

describe('isProductTourPending', () => {
  test('never auto-starts while the persisted state is still loading', () => {
    expect(isProductTourPending({ completedVersion: undefined, markCompleted: noop })).toBe(false);
  });

  test('starts for users who have never completed a tour', () => {
    expect(isProductTourPending({ completedVersion: null, markCompleted: noop })).toBe(true);
  });

  test('re-runs when the completed version is older than the current tour', () => {
    expect(
      isProductTourPending({ completedVersion: PRODUCT_TOUR_VERSION - 1, markCompleted: noop }),
    ).toBe(true);
  });

  test('stays quiet once the current or a newer version is completed', () => {
    expect(
      isProductTourPending({ completedVersion: PRODUCT_TOUR_VERSION, markCompleted: noop }),
    ).toBe(false);
    expect(
      isProductTourPending({ completedVersion: PRODUCT_TOUR_VERSION + 1, markCompleted: noop }),
    ).toBe(false);
  });
});
