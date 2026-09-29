import { expect, test } from 'bun:test';
import { formatShareLinkExpiry } from './formatTime.ts';

const HOUR = 60 * 60 * 1000;
const now = 1_000_000_000_000;

test('formatShareLinkExpiry labels remaining lifetime at unit boundaries', () => {
  expect(formatShareLinkExpiry(undefined, now)).toBe('No expiry');
  expect(formatShareLinkExpiry(now + 7 * 24 * HOUR - 1, now)).toBe('Expires in 6 days');
  expect(formatShareLinkExpiry(now + 24 * HOUR, now)).toBe('Expires in 1 day');
  expect(formatShareLinkExpiry(now + 23 * HOUR - 1, now)).toBe('Expires in 23 hours');
  expect(formatShareLinkExpiry(now + 10, now)).toBe('Expires in 1 hour');
  expect(formatShareLinkExpiry(now, now)).toBe('Expired');
});
