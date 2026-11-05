import { expect, test } from 'bun:test';
import { isStalePlanSelection } from './planSelection.ts';

test('Given plans are still loading When a deep link selects a plan Then the selection is kept', () => {
  expect(isStalePlanSelection('plan-1', true, new Map())).toBe(false);
});

test('Given plans have loaded When the selected plan is missing Then the selection is stale', () => {
  expect(isStalePlanSelection('plan-1', false, new Map())).toBe(true);
  expect(isStalePlanSelection('plan-1', false, new Map([['plan-1', {}]]))).toBe(false);
});

test('Given no selection When plans load Then nothing is cleared', () => {
  expect(isStalePlanSelection(null, false, new Map())).toBe(false);
});
