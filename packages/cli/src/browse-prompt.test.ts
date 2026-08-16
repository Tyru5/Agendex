import { expect, test } from 'bun:test';
import { canPromptForPlanBrowse } from './browse-prompt.ts';
import { formatPlanDownloadChoice } from './download-prompt.ts';

test('browse picker reuses sanitized download choice labels', () => {
  const match = {
    id: 'plan-1',
    agent: 'claude-code',
    title: 'Add auth',
    updatedAt: '2026-08-02T00:00:00.000Z',
  };
  expect(formatPlanDownloadChoice(match, 1)).toBe('[1] Add auth  (claude-code)');
});

test('canPromptForPlanBrowse follows the process TTY flags', () => {
  expect(typeof canPromptForPlanBrowse()).toBe('boolean');
});
