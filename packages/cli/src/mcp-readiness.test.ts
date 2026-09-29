import { expect, test } from 'bun:test';
import { createRetryableReadiness } from './mcp-readiness.ts';

test('concurrent callers share failure, then retry successfully without restarting', async () => {
  let attempts = 0;
  const ready = createRetryableReadiness(async () => {
    if (++attempts === 1) throw new Error('transient scan failure');
  });
  const first = ready();
  expect(ready()).toBe(first);
  await expect(first).rejects.toThrow('transient scan failure');
  const retry = ready();
  expect(ready()).toBe(retry);
  await retry;
  await ready();
  expect(attempts).toBe(2);
});
