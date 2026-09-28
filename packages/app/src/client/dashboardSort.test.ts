import { expect, test } from 'bun:test';
import { sortFromSearch } from './dashboardSort.ts';

test('prefetch uses the same sort the dashboard will read from the URL', () => {
  expect(sortFromSearch('')).toBe('updatedAt');
  expect(sortFromSearch('?sort=title')).toBe('title');
  expect(sortFromSearch('?plan=abc&sort=createdAt')).toBe('createdAt');
  expect(sortFromSearch('?sort=bogus')).toBe('updatedAt');
});
