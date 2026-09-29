import { expect, test } from 'bun:test';
import type { Doc, Id } from './_generated/dataModel';
import { toPlanListItemDto } from './validators';

function makePlan(content: string): Doc<'plans'> {
  return {
    _id: 'plan-1' as Id<'plans'>,
    _creationTime: 1_700_000_000_000,
    ownerId: 'owner-1',
    agent: 'codex-cli',
    title: 'Retry API requests',
    content,
    format: 'md',
    version: 1,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_100_000,
  } as Doc<'plans'>;
}

test('list item DTO strips content but keeps checklist progress', () => {
  const dto = toPlanListItemDto(makePlan('- [x] Reproduce\n- [ ] Add `backoff`\n- [ ] Test'));
  expect('content' in dto).toBe(false);
  expect(dto.checklist).toEqual({ total: 3, completed: 1, nextStep: 'Add backoff' });
});

test('list item DTO omits next step for a completed checklist', () => {
  expect(toPlanListItemDto(makePlan('- [x] Implement\n- [x] Test')).checklist).toEqual({
    total: 2,
    completed: 2,
  });
});

test('list item DTO omits the checklist when the plan has no tasks', () => {
  expect('checklist' in toPlanListItemDto(makePlan('# Plan\n\nJust prose.'))).toBe(false);
});
