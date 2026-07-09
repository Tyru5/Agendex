import { expect, test } from 'bun:test';
import {
  buildTrustedOrigins,
  isLocalDevOrigin,
  LOCAL_DEV_CORS_ORIGINS,
  LOCAL_ORIGIN_PATTERNS,
} from './auth-origins';

test('isLocalDevOrigin accepts loopback and agendex.localhost http origins', () => {
  expect(isLocalDevOrigin('http://localhost:57352')).toBe(true);
  expect(isLocalDevOrigin('http://127.0.0.1:4890')).toBe(true);
  expect(isLocalDevOrigin('http://agendex.localhost:5174')).toBe(true);
  expect(isLocalDevOrigin('http://app.agendex.localhost:5174')).toBe(true);
});

test('isLocalDevOrigin rejects non-local and non-http origins', () => {
  expect(isLocalDevOrigin('https://localhost:57352')).toBe(false);
  expect(isLocalDevOrigin('http://evil.example.com')).toBe(false);
  expect(isLocalDevOrigin('https://app.agendex.dev')).toBe(false);
  expect(isLocalDevOrigin('not-a-url')).toBe(false);
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
});

test('buildTrustedOrigins reflects Electron ephemeral localhost for CORS exact-match', () => {
  const electronOrigin = 'http://localhost:57352';
  const origins = buildTrustedOrigins({
    siteUrl: 'https://app.agendex.dev',
    appUrl: 'https://app.agendex.dev',
    requestOrigin: electronOrigin,
  });

  expect(origins).toContain(electronOrigin);
  // Static Vite origins remain available via LOCAL_DEV_CORS_ORIGINS append in http.ts
  expect(LOCAL_DEV_CORS_ORIGINS).toContain('http://localhost:5174');
});

test('buildTrustedOrigins does not reflect untrusted request origins', () => {
  const origins = buildTrustedOrigins({
    siteUrl: 'https://app.agendex.dev',
    appUrl: 'https://app.agendex.dev',
    requestOrigin: 'https://evil.example.com',
  });

  expect(origins).not.toContain('https://evil.example.com');
});

test('buildTrustedOrigins does not duplicate an already-listed request origin', () => {
  const origins = buildTrustedOrigins({
    siteUrl: 'http://localhost:57352',
    appUrl: '',
    requestOrigin: 'http://localhost:57352',
  });

  expect(origins.filter((o) => o === 'http://localhost:57352')).toHaveLength(1);
});
