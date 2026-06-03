import { expect, spyOn, test } from 'bun:test';
import { runHookReviewCommand } from './hooks.ts';

test('hook-native plan review fails closed until the review session server exists', async () => {
  const errorSpy = spyOn(console, 'error').mockImplementation(() => undefined);

  try {
    const result = await runHookReviewCommand(['review-plan', '--hook', '--agent', 'codex']);

    expect(result).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('not implemented yet'));
  } finally {
    errorSpy.mockRestore();
  }
});
