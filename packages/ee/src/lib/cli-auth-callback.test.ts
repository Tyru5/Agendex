import { describe, expect, test } from 'bun:test';
import { parseCliAuthCallback } from './cli-auth-callback.ts';

describe('CLI auth callback guard', () => {
  test('accepts localhost loopback callback URLs', () => {
    // Given
    const callback = 'http://localhost:4890/callback';

    // When
    const result = parseCliAuthCallback(callback);

    // Then
    expect(result).toEqual({ ok: true, callbackUrl: callback });
  });

  test('accepts 127.0.0.1 loopback callback URLs', () => {
    // Given
    const callback = 'http://127.0.0.1:4890/callback';

    // When
    const result = parseCliAuthCallback(callback);

    // Then
    expect(result).toEqual({ ok: true, callbackUrl: callback });
  });

  test('rejects the desktop custom protocol callback URL', () => {
    // Given
    const callback = 'agendex://auth/callback';

    // When
    const result = parseCliAuthCallback(callback);

    // Then
    expect(result).toEqual({ ok: false, reason: 'non-loopback-callback' });
  });

  test('rejects hostile non-loopback callback URLs', () => {
    // Given
    const callback = 'https://evil.example/callback';

    // When
    const result = parseCliAuthCallback(callback);

    // Then
    expect(result).toEqual({ ok: false, reason: 'non-loopback-callback' });
  });
});
