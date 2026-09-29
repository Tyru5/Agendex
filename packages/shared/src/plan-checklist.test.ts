import { expect, test } from 'bun:test';
import { extractPlanChecklist } from './plan-checklist.ts';

test('extractPlanChecklist reads markdown tasks and cleans the next step', () => {
  expect(
    extractPlanChecklist(`
- [x] Inspect the existing flow
- [ ] Implement \`retryRequest\`
1. [ ] Add [coverage](https://example.com)
* [X] Ship the docs
`),
  ).toEqual({
    total: 4,
    completed: 2,
    remaining: 2,
    nextStep: 'Implement retryRequest',
  });
});
