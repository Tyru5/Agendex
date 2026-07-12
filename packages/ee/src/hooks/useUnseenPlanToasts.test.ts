import { describe, expect, test } from 'bun:test';
import {
  clearAllPlanToasts,
  getActivePlanToastCount,
  registerClearAllPlanToasts,
  setActivePlanToastCount,
} from './plan-toast-store.ts';
import {
  maxVisibleToasts,
  planToastId,
  shouldShowClearAll,
  shouldShowPlanToast,
  truncateTitle,
  unseenPlanKey,
} from './unseen-plan-toast-utils.ts';

describe('useUnseenPlanToasts helpers', () => {
  test('truncateTitle leaves short titles unchanged', () => {
    expect(truncateTitle('Short plan')).toBe('Short plan');
  });

  test('truncateTitle truncates long titles', () => {
    const long = 'a'.repeat(70);
    expect(truncateTitle(long)).toBe(`${'a'.repeat(59)}…`);
    expect(truncateTitle(long).length).toBe(60);
  });

  test('unseenPlanKey combines id and updatedAt', () => {
    expect(unseenPlanKey('plan-1', '2026-01-01T00:00:00.000Z')).toBe(
      'plan-1:2026-01-01T00:00:00.000Z',
    );
  });

  test('planToastId is stable per plan', () => {
    expect(planToastId('plan-1')).toBe('plan-toast:plan-1');
    expect(planToastId('plan-1')).toBe(planToastId('plan-1'));
  });

  test('shouldShowPlanToast skips exact duplicate updatedAt', () => {
    expect(shouldShowPlanToast('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')).toBe(false);
  });

  test('shouldShowPlanToast allows first notify and newer updatedAt', () => {
    expect(shouldShowPlanToast(undefined, '2026-01-01T00:00:00.000Z')).toBe(true);
    expect(shouldShowPlanToast('2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z')).toBe(true);
  });

  test('shouldShowClearAll only when multiple toasts', () => {
    expect(shouldShowClearAll(0)).toBe(false);
    expect(shouldShowClearAll(1)).toBe(false);
    expect(shouldShowClearAll(2)).toBe(true);
    expect(shouldShowClearAll(5)).toBe(true);
  });

  test('maxVisibleToasts never drops below 1', () => {
    expect(maxVisibleToasts(0)).toBe(1);
    expect(maxVisibleToasts(-10)).toBe(1);
    expect(maxVisibleToasts(50)).toBe(1);
  });

  test('maxVisibleToasts grows with viewport height', () => {
    const short = maxVisibleToasts(400);
    const tall = maxVisibleToasts(1200);
    expect(tall).toBeGreaterThan(short);
    expect(tall).toBeGreaterThan(3);
  });
});

describe('plan-toast-store', () => {
  test('tracks active count and clear-all handler', () => {
    setActivePlanToastCount(0);
    registerClearAllPlanToasts(null);

    setActivePlanToastCount(3);
    expect(getActivePlanToastCount()).toBe(3);
    expect(shouldShowClearAll(getActivePlanToastCount())).toBe(true);

    let cleared = false;
    registerClearAllPlanToasts(() => {
      cleared = true;
      setActivePlanToastCount(0);
    });
    clearAllPlanToasts();
    expect(cleared).toBe(true);
    expect(getActivePlanToastCount()).toBe(0);

    registerClearAllPlanToasts(null);
  });
});
