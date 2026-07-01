import { describe, expect, test } from 'bun:test';
import {
  DESKTOP_AUTH_CALLBACK_URL,
  buildDesktopAuthRedirectUrl,
  parseDesktopAuthRequest,
  redactDesktopAuthUrl,
} from './desktop-auth-flow.ts';

describe('desktop auth browser flow', () => {
  test('parses a valid desktop auth request when callback state and provider are valid', () => {
    // Given
    const url =
      'http://agendex.localhost:5174/auth/desktop?callback=agendex%3A%2F%2Fauth%2Fcallback&state=qa-state&provider=github';

    // When
    const result = parseDesktopAuthRequest(url);

    // Then
    expect(result).toEqual({
      ok: true,
      callbackUrl: DESKTOP_AUTH_CALLBACK_URL,
      state: 'qa-state',
      provider: 'github',
    });
  });

  test('rejects desktop auth when state is missing', () => {
    // Given
    const url =
      'http://agendex.localhost:5174/auth/desktop?callback=agendex%3A%2F%2Fauth%2Fcallback&provider=github';

    // When
    const result = parseDesktopAuthRequest(url);

    // Then
    expect(result).toEqual({ ok: false, reason: 'missing-state' });
  });

  test('rejects desktop auth when provider is unsupported', () => {
    // Given
    const url =
      'http://agendex.localhost:5174/auth/desktop?callback=agendex%3A%2F%2Fauth%2Fcallback&state=qa-state&provider=gitlab';

    // When
    const result = parseDesktopAuthRequest(url);

    // Then
    expect(result).toEqual({ ok: false, reason: 'bad-provider' });
  });

  test('rejects desktop auth when callback is not the exact desktop protocol target', () => {
    // Given
    const url =
      'http://agendex.localhost:5174/auth/desktop?callback=agendex%3A%2F%2Fauth%2Fevil&state=qa-state&provider=google';

    // When
    const result = parseDesktopAuthRequest(url);

    // Then
    expect(result).toEqual({ ok: false, reason: 'bad-callback' });
  });

  test('preserves state provider and callback when building the desktop protocol redirect', () => {
    // Given
    const request = parseDesktopAuthRequest(
      'http://agendex.localhost:5174/auth/desktop?callback=agendex%3A%2F%2Fauth%2Fcallback&state=stale-state&provider=google&next=https%3A%2F%2Fevil.example',
    );

    if (!request.ok) throw new Error('expected valid request');

    // When
    const redirect = buildDesktopAuthRedirectUrl({
      request,
      sessionToken: 'session-secret',
      convexSiteUrl: 'http://127.0.0.1:3211',
    });

    // Then
    expect(redirect).toBe(
      'agendex://auth/callback?state=stale-state&provider=google&token=session-secret&convexUrl=http%3A%2F%2F127.0.0.1%3A3211',
    );
  });

  test('does not expose raw token values in redacted helper output', () => {
    // Given
    const url =
      'agendex://auth/callback?state=qa-state&provider=github&token=session-secret&convexUrl=http%3A%2F%2F127.0.0.1%3A3211';

    // When
    const redacted = redactDesktopAuthUrl(url);

    // Then
    expect(redacted).not.toContain('session-secret');
    expect(redacted).toContain('token=<redacted>');
  });
});
