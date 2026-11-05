import { expect, test } from 'bun:test';
import { reconnectDelay } from './useSocket.ts';

test('Given repeated failures When computing reconnect delay Then the ceiling doubles up to 30s', () => {
  const max = () => 1;
  expect(reconnectDelay(0, max)).toBe(1000);
  expect(reconnectDelay(1, max)).toBe(2000);
  expect(reconnectDelay(3, max)).toBe(8000);
  expect(reconnectDelay(5, max)).toBe(30_000);
  expect(reconnectDelay(40, max)).toBe(30_000);
});

test('Given jitter When computing reconnect delay Then it never drops below the base delay', () => {
  expect(reconnectDelay(4, () => 0)).toBe(1000);
  expect(reconnectDelay(4, () => 0.5)).toBe(8000);
});
