import { expect, test } from 'bun:test';
import { deriveConvexDeploymentUrl, normalizeConvexSiteUrl } from './convex-url.ts';

test('normalizes production Convex site URLs when a callback includes a path', () => {
  const normalized = normalizeConvexSiteUrl('https://steady-otter-123.convex.site/api/auth');

  expect(normalized).toBe('https://steady-otter-123.convex.site');
});

test('normalizes local anonymous Convex site URLs when desktop sign-in runs in dev', () => {
  const normalized = normalizeConvexSiteUrl('http://127.0.0.1:3211/api/auth/callback/github');

  expect(normalized).toBe('http://127.0.0.1:3211');
});

test('rejects untrusted Convex site URLs when persisting desktop credentials', () => {
  expect(normalizeConvexSiteUrl('http://steady-otter-123.convex.site')).toBeNull();
  expect(normalizeConvexSiteUrl('http://127.0.0.1:4890')).toBeNull();
  expect(normalizeConvexSiteUrl('https://attacker.example')).toBeNull();
});

test('derives the Convex deployment URL when desktop stores a production site URL', () => {
  const deploymentUrl = deriveConvexDeploymentUrl('https://steady-otter-123.convex.site');

  expect(deploymentUrl).toBe('https://steady-otter-123.convex.cloud');
});

test('derives the local Convex deployment URL when desktop stores an anonymous site URL', () => {
  const deploymentUrl = deriveConvexDeploymentUrl('http://127.0.0.1:3211');

  expect(deploymentUrl).toBe('http://127.0.0.1:3210');
});
