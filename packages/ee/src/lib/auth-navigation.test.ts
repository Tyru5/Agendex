import { expect, test } from 'bun:test';
import {
  externalAuthUrl,
  isEmbeddedBrowser,
  requestedAuthProvider,
  shouldOpenAuthExternally,
} from './auth-navigation.ts';

test('embedded auth is detected from the browsing context', () => {
  const currentWindow = {};
  expect(isEmbeddedBrowser(currentWindow, currentWindow)).toBe(false);
  expect(isEmbeddedBrowser(currentWindow, {})).toBe(true);
});

test('Orb auth can force an external tab from a top-level webview', () => {
  const currentWindow = {};
  expect(shouldOpenAuthExternally(currentWindow, currentWindow, false)).toBe(false);
  expect(shouldOpenAuthExternally(currentWindow, currentWindow, true)).toBe(true);
});

test('OAuth continuation accepts only supported providers', () => {
  expect(requestedAuthProvider('?oauth=google')).toBe('google');
  expect(requestedAuthProvider('?oauth=github')).toBe('github');
  expect(requestedAuthProvider('?oauth=unknown')).toBeNull();
  expect(requestedAuthProvider('')).toBeNull();
});

test('external OAuth continues from the public login page', () => {
  expect(externalAuthUrl('https://agendex.example', 'google')).toBe(
    'https://agendex.example/login?oauth=google',
  );
});
