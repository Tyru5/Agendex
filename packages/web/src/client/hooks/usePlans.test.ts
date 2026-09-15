import { expect, test } from 'bun:test';
import { getPlanRefreshPresentation } from './usePlans.ts';

test('Given an initial plan load When choosing refresh presentation Then loading remains visible', () => {
  expect(getPlanRefreshPresentation(false, 'manual')).toEqual({
    loading: true,
    refreshing: false,
  });
  expect(getPlanRefreshPresentation(false, 'realtime')).toEqual({
    loading: true,
    refreshing: false,
  });
});

test('Given loaded plans When a manual refresh starts Then the visible refresh indicator is enabled', () => {
  expect(getPlanRefreshPresentation(true, 'manual')).toEqual({
    loading: false,
    refreshing: true,
  });
});

test('Given loaded plans When a realtime event refreshes them Then the visible refresh indicator stays stable', () => {
  expect(getPlanRefreshPresentation(true, 'realtime')).toEqual({
    loading: false,
    refreshing: false,
  });
});
