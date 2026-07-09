import { expect, test } from 'bun:test';
import {
  buildTrustedOrigins,
  isAgendexLocalOrigin,
  LOCAL_DEV_CORS_ORIGINS,
  LOCAL_ORIGIN_PATTERNS,
} from './auth-origins';

test('isAgendexLocalOrigin accepts only allowlisted product local hosts', () => {
  expect(isAgendexLocalOrigin('http://agendex.localhost:5174')).toBe(true);
  expect(isAgendexLocalOrigin('http://app.agendex.localhost:5174')).toBe(true);
  expect(isAgendexLocalOrigin('http://app.agendex.localhost:57352')).toBe(true);
});

test('isAgendexLocalOrigin rejects arbitrary agendex.localhost subdomains', () => {
  expect(isAgendexLocalOrigin('http://evil.agendex.localhost:3000')).toBe(false);
  expect(isAgendexLocalOrigin('http://anything.agendex.localhost:57352')).toBe(false);
  expect(isAgendexLocalOrigin('http://www.agendex.localhost:5174')).toBe(false);
});

test('isAgendexLocalOrigin rejects bare loopback and non-product origins', () => {
  expect(isAgendexLocalOrigin('http://localhost:57352')).toBe(false);
  expect(isAgendexLocalOrigin('http://127.0.0.1:4890')).toBe(false);
  expect(isAgendexLocalOrigin('https://app.agendex.localhost:5174')).toBe(false);
  expect(isAgendexLocalOrigin('http://evil.example.com')).toBe(false);
  expect(isAgendexLocalOrigin('https://app.agendex.dev')).toBe(false);
  expect(isAgendexLocalOrigin('not-a-url')).toBe(false);
});

test('buildTrustedOrigins includes site/app URLs and local patterns', () => {
  const origins = buildTrustedOrigins({
    siteUrl: 'https://app.agendex.dev',
    appUrl: 'https://app.agendex.dev',
  });

  expect(origins).toContain('https://app.agendex.dev');
  expect(origins).toContain('https://www.app.agendex.dev');
  expect(origins).toContain('https://*.vercel.app');
  for (const pattern of LOCAL_ORIGIN_PATTERNS) {
    expect(origins).toContain(pattern);
  }
  // No wildcard subdomain pattern — only exact product hosts with port wildcards.
  expect(origins).not.toContain('http://*.agendex.localhost:*');
});

test('buildTrustedOrigins reflects Electron ephemeral app.agendex.localhost for CORS', () => {
  const electronOrigin = 'http://app.agendex.localhost:57352';
  const origins = buildTrustedOrigins({
    siteUrl: 'https://app.agendex.dev',
    appUrl: 'https://app.agendex.dev',
    requestOrigin: electronOrigin,
  });

  expect(origins).toContain(electronOrigin);
  expect(LOCAL_DEV_CORS_ORIGINS).toContain('http://app.agendex.localhost:5174');
});

test('buildTrustedOrigins does not reflect arbitrary agendex.localhost subdomains', () => {
  const attackerOrigin = 'http://evil.agendex.localhost:3000';
  const origins = buildTrustedOrigins({
    siteUrl: 'https://app.agendex.dev',
    appUrl: 'https://app.agendex.dev',
    requestOrigin: attackerOrigin,
  });

  expect(origins).not.toContain(attackerOrigin);
});

test('buildTrustedOrigins does not reflect bare localhost (any local process)', () => {
  const origins = buildTrustedOrigins({
    siteUrl: 'https://app.agendex.dev',
    appUrl: 'https://app.agendex.dev',
    requestOrigin: 'http://localhost:57352',
  });

  expect(origins).not.toContain('http://localhost:57352');
});

test('buildTrustedOrigins does not reflect 127.0.0.1 request origins', () => {
  const origins = buildTrustedOrigins({
    siteUrl: 'https://app.agendex.dev',
    appUrl: 'https://app.agendex.dev',
    requestOrigin: 'http://127.0.0.1:4890',
  });

  expect(origins).not.toContain('http://127.0.0.1:4890');
});

test('buildTrustedOrigins does not reflect untrusted remote request origins', () => {
  const origins = buildTrustedOrigins({
    siteUrl: 'https://app.agendex.dev',
    appUrl: 'https://app.agendex.dev',
    requestOrigin: 'https://evil.example.com',
  });

  expect(origins).not.toContain('https://evil.example.com');
});

test('buildTrustedOrigins does not duplicate an already-listed request origin', () => {
  const electronOrigin = 'http://app.agendex.localhost:57352';
  const origins = buildTrustedOrigins({
    siteUrl: electronOrigin,
    appUrl: '',
    requestOrigin: electronOrigin,
  });

  expect(origins.filter((o) => o === electronOrigin)).toHaveLength(1);
});
