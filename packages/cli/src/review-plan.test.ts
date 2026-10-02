import { expect, test } from 'bun:test';
import { readHookInput } from './review-plan.ts';

test('hook input preserves UTF-8 characters split between chunks', async () => {
  const text = JSON.stringify({ plan: '# café 🚀' });
  const bytes = Buffer.from(text);
  for (let split = 1; split < bytes.length; split++) {
    async function* input() {
      yield bytes.subarray(0, split);
      yield bytes.subarray(split);
    }
    expect(await readHookInput(input())).toBe(text);
  }
});

test('hook input enforces its byte limit across chunks', async () => {
  async function* input() {
    yield Buffer.alloc(1_100_000);
    yield Buffer.from('x');
  }
  await expect(readHookInput(input())).rejects.toThrow('Hook input is too large');
});
