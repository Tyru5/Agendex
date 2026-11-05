import { expect, test } from 'bun:test';
import { isStalePlanSelection } from './planSelection.ts';

test('Given the plan list is not ready When a deep link selects a plan Then the selection is kept', () => {
  // Covers both an in-flight first load and a failed load while the backend is down.
  expect(isStalePlanSelection('plan-1', false, new Map())).toBe(false);
});

test('Given plans have loaded When the selected plan is missing Then the selection is stale', () => {
  expect(isStalePlanSelection('plan-1', true, new Map())).toBe(true);
  expect(isStalePlanSelection('plan-1', true, new Map([['plan-1', {}]]))).toBe(false);
});

test('Given no selection When plans load Then nothing is cleared', () => {
  expect(isStalePlanSelection(null, true, new Map())).toBe(false);
});
