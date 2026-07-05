import { describe, expect, test } from 'bun:test';
import {
  shouldOpenNavigationExternally,
  shouldOpenWindowExternally,
} from './desktop-navigation.ts';

describe('desktop external navigation policy', () => {
  test('keeps same-origin dashboard navigations inside Electron', () => {
    expect(
      shouldOpenNavigationExternally(
        'http://localhost:4890/dashboard',
        'http://localhost:4890/dashboard/plans',
      ),
    ).toBe(false);
  });

  test('opens OAuth provider redirects outside Electron', () => {
    expect(
      shouldOpenNavigationExternally(
        'http://localhost:4890/dashboard',
        'https://accounts.google.com/o/oauth2/v2/auth',
      ),
    ).toBe(true);
  });

  test('opens popup URLs outside Electron', () => {
    expect(shouldOpenWindowExternally('https://github.com/login/oauth/authorize')).toBe(true);
  });
});
