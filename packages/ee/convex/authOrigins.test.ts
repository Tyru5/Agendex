import { expect, test } from 'bun:test';
import {
  LOCAL_DEVELOPMENT_AUTH_ORIGINS,
  resolveAuthBaseUrl,
  resolveAuthTrustedOrigins,
} from './auth';

test('public auth base URL overrides the private Convex site URL', () => {
  expect(
    resolveAuthBaseUrl({
      BETTER_AUTH_BASE_URL: 'https://agendex-ee--tiru5.onamp.dev',
      CONVEX_SITE_URL: 'http://127.0.0.1:3211',
    }),
  ).toBe('https://agendex-ee--tiru5.onamp.dev');
  expect(resolveAuthBaseUrl({ CONVEX_SITE_URL: 'http://127.0.0.1:3211' })).toBe(
    'http://127.0.0.1:3211',
  );
});

test('production resolves only canonical and explicitly configured exact origins', () => {
  const origins = resolveAuthTrustedOrigins({
    BETTER_AUTH_ENVIRONMENT: 'production',
    SITE_URL: 'https://www.agendex.dev',
    APP_URL: 'https://app.agendex.dev',
    BETTER_AUTH_TRUSTED_ORIGINS: 'https://admin.agendex.dev, https://preview.agendex.dev',
  });

  expect(origins).toEqual([
    'https://www.agendex.dev',
    'https://app.agendex.dev',
    'https://admin.agendex.dev',
    'https://preview.agendex.dev',
  ]);
  expect(origins).not.toContain('https://www-agendex-git-main-attacker.vercel.app');
  expect(origins).not.toContain('https://agendex.dev');
  expect(origins).not.toContain('http://localhost:5174');
});

test('production fails clearly when its explicit allowlist is missing', () => {
  expect(() =>
    resolveAuthTrustedOrigins({
      BETTER_AUTH_ENVIRONMENT: 'production',
      SITE_URL: 'https://agendex.dev',
      APP_URL: 'https://app.agendex.dev',
    }),
  ).toThrow('BETTER_AUTH_TRUSTED_ORIGINS is required');
});

test('production rejects wildcard and local origins even when configured', () => {
  expect(() =>
    resolveAuthTrustedOrigins({
      BETTER_AUTH_ENVIRONMENT: 'production',
      BETTER_AUTH_TRUSTED_ORIGINS: 'https://*.vercel.app',
    }),
  ).toThrow('wildcards are not allowed');

  expect(() =>
    resolveAuthTrustedOrigins({
      BETTER_AUTH_ENVIRONMENT: 'production',
      BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:5174',
    }),
  ).toThrow('only allowed in development');
});

test('development resolves only fixed local origins in explicit mode', () => {
  expect(
    resolveAuthTrustedOrigins({
      BETTER_AUTH_ENVIRONMENT: 'development',
      SITE_URL: 'http://agendex.localhost:5174',
      APP_URL: 'http://app.agendex.localhost:5174',
    }),
  ).toEqual([...LOCAL_DEVELOPMENT_AUTH_ORIGINS]);

  expect(() =>
    resolveAuthTrustedOrigins({
      BETTER_AUTH_ENVIRONMENT: 'development',
      SITE_URL: 'http://agendex.localhost:5175',
    }),
  ).toThrow('not in the exact development allowlist');

  expect(() =>
    resolveAuthTrustedOrigins({
      BETTER_AUTH_ENVIRONMENT: 'development',
      SITE_URL: 'http://attacker.agendex.localhost:5174',
    }),
  ).toThrow('not in the exact development allowlist');

  expect(() =>
    resolveAuthTrustedOrigins({
      SITE_URL: 'http://localhost:5174',
      BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:5174',
    }),
  ).toThrow('only allowed in development');
});
