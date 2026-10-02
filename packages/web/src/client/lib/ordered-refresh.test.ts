import { expect, test } from 'bun:test';
import { createOrderedRefresh } from './ordered-refresh.ts';

function deferred() {
  let resolve!: (value: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture() {
  const requests: ReturnType<typeof deferred>[] = [];
  const values: string[] = [];
  const errors: unknown[] = [];
  const refresh = createOrderedRefresh(
    () => {
      const request = deferred();
      requests.push(request);
      return request.promise;
    },
    (value) => values.push(value),
    (error) => errors.push(error),
  );
  return { ...refresh, requests, values, errors };
}

test('slow reads display even when another polling request has started', async () => {
  const queue = fixture();
  const first = queue.refresh();
  const second = queue.refresh();
  queue.requests[0]?.resolve('pending');
  await first;
  expect(queue.values).toEqual(['pending']);
  queue.requests[1]?.resolve('approved');
  await second;
  expect(queue.values).toEqual(['pending', 'approved']);
});
test('delayed polls and errors cannot overwrite a newer decision refresh', async () => {
  for (const oldError of [false, true]) {
    const queue = fixture();
    const poll = queue.refresh();
    const decision = queue.refresh();
    queue.requests[1]?.resolve('approved');
    await decision;
    if (oldError) queue.requests[0]?.reject(new Error('old poll failed'));
    else queue.requests[0]?.resolve('pending');
    await poll;
    expect(queue.values).toEqual(['approved']);
    expect(queue.errors).toEqual([]);
  }
});
test('closing a queue discards pending reads and allows reads after reopening', async () => {
  const queue = fixture();
  const previous = queue.refresh();
  queue.invalidate();
  queue.requests[0]?.resolve('pending');
  await previous;
  expect(queue.values).toEqual([]);
  const reopened = queue.refresh();
  queue.requests[1]?.resolve('approved');
  await reopened;
  expect(queue.values).toEqual(['approved']);
});
