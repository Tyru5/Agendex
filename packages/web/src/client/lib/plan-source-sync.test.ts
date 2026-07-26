import { expect, test } from 'bun:test';
import { createPlanSourceSync, type PlanSourcesClient } from './plan-source-sync.ts';

type Deferred = {
  resolve: (dirs: string[]) => void;
  reject: (error: Error) => void;
  promise: Promise<{ customPlanDirs: string[] }>;
};

function deferred(): Deferred {
  let resolve!: (dirs: string[]) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ customPlanDirs: string[] }>((res, rej) => {
    resolve = (dirs) => res({ customPlanDirs: dirs });
    reject = rej;
  });
  return { resolve, reject, promise };
}

/** Lets queued microtasks run so issued-request assertions see the current state. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function trackingClient(responses: { get?: Deferred; remove?: Map<string, Deferred> } = {}) {
  const calls: string[] = [];
  const removals = responses.remove ?? new Map<string, Deferred>();
  const client: PlanSourcesClient = {
    getPlanSources: () => {
      calls.push('get');
      return responses.get?.promise ?? Promise.resolve({ customPlanDirs: [] });
    },
    removePlanSource: (path) => {
      calls.push(`remove:${path}`);
      const pending = removals.get(path);
      return pending?.promise ?? Promise.resolve({ customPlanDirs: [] });
    },
  };
  return { calls, client };
}

test('Given a pending initial fetch When a removal is requested Then the removal waits and its snapshot wins', async () => {
  const initial = deferred();
  const removal = deferred();
  const { calls, client } = trackingClient({
    get: initial,
    remove: new Map([['/a', removal]]),
  });
  const snapshots: string[][] = [];
  const sync = createPlanSourceSync(client, (dirs) => snapshots.push(dirs));

  const refreshed = sync.refresh();
  const removed = sync.remove('/a');
  await tick();
  expect(calls).toEqual(['get']);

  initial.resolve(['/a', '/b']);
  await refreshed;
  await tick();
  expect(calls).toEqual(['get', 'remove:/a']);

  removal.resolve(['/b']);
  await removed;

  expect(snapshots).toEqual([['/a', '/b'], ['/b']]);
});

test('Given overlapping removals When the second is requested first Then both removals are reflected in order', async () => {
  const first = deferred();
  const second = deferred();
  const { calls, client } = trackingClient({
    remove: new Map([
      ['/a', first],
      ['/b', second],
    ]),
  });
  const snapshots: string[][] = [];
  const sync = createPlanSourceSync(client, (dirs) => snapshots.push(dirs));

  const removedA = sync.remove('/a');
  const removedB = sync.remove('/b');
  await tick();
  expect(calls).toEqual(['remove:/a']);

  first.resolve(['/b', '/c']);
  await removedA;
  second.resolve(['/c']);
  await removedB;

  expect(snapshots).toEqual([['/b', '/c'], ['/c']]);
});

test('Given a failed removal When a later refresh runs Then the failure surfaces and the queue continues', async () => {
  const failing = deferred();
  const refetch = deferred();
  const { client } = trackingClient({
    get: refetch,
    remove: new Map([['/a', failing]]),
  });
  const snapshots: string[][] = [];
  const sync = createPlanSourceSync(client, (dirs) => snapshots.push(dirs));

  const removed = sync.remove('/a');
  const refreshed = sync.refresh();

  failing.reject(new Error('remove failed'));
  await expect(removed).rejects.toThrow('remove failed');

  refetch.resolve(['/a']);
  await refreshed;

  expect(snapshots).toEqual([['/a']]);
});

test('Given a disposed sync When an in-flight response arrives Then no snapshot is delivered', async () => {
  const pending = deferred();
  const { client } = trackingClient({ get: pending });
  const snapshots: string[][] = [];
  const sync = createPlanSourceSync(client, (dirs) => snapshots.push(dirs));

  const refreshed = sync.refresh();
  sync.dispose();
  pending.resolve(['/a']);
  await refreshed;

  expect(snapshots).toEqual([]);
});
