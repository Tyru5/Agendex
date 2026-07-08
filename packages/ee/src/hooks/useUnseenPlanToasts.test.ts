import { describe, expect, test } from 'bun:test';
import { truncateTitle, unseenPlanKey } from './unseen-plan-toast-utils.ts';

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
});
