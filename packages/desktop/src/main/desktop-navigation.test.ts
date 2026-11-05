import { describe, expect, test } from 'bun:test';
import { resolveNavigationAction, shouldOpenWindowExternally } from './desktop-navigation.ts';

describe('desktop external navigation policy', () => {
  test('keeps same-origin dashboard navigations inside Electron', () => {
    expect(
      resolveNavigationAction(
        'http://localhost:4890/dashboard',
        'http://localhost:4890/dashboard/plans',
      ),
    ).toBe('allow');
  });

  test('opens OAuth provider redirects outside Electron', () => {
    expect(
      resolveNavigationAction(
        'http://localhost:4890/dashboard',
        'https://accounts.google.com/o/oauth2/v2/auth',
      ),
    ).toBe('open-externally');
    // Same host, different port is a different origin.
    expect(
      resolveNavigationAction('http://localhost:4890/dashboard', 'http://localhost:5000/'),
    ).toBe('open-externally');
  });

  test('blocks non-http(s) navigations', () => {
    for (const url of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'data:text/html,<p>hi</p>',
      'agendex://auth/callback?token=x',
      'not a url',
    ]) {
      expect(resolveNavigationAction('http://localhost:4890/dashboard', url)).toBe('block');
    }
  });

  test('opens popup URLs outside Electron', () => {
    expect(shouldOpenWindowExternally('https://github.com/login/oauth/authorize')).toBe(true);
  });
});
