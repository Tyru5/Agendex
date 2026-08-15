import { expect, test } from 'bun:test';
import { formatPlanDownloadChoice, formatPlanDownloadRetry } from './download-prompt.ts';

test('formats numbered quick-select choices and a short retry command', () => {
  const match = {
    id: 'plan-1',
    agent: 'claude-code',
    title: 'Implement a very long download-plan name',
    updatedAt: '2026-08-02T00:00:00.000Z',
  };

  expect(formatPlanDownloadChoice(match, 1)).toBe(
    '[1] Implement a very long download-plan name  (claude-code)',
  );
  expect(formatPlanDownloadRetry(match)).toBe('      agendex download plan-1');
});
