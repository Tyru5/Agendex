import { afterEach, beforeEach, expect, test } from 'bun:test';
import { api } from './api.ts';

function createStorage(): Storage {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key) {
      return store.get(key) ?? null;
    },
    key(index) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key) {
      store.delete(key);
    },
    setItem(key, value) {
      store.set(key, value);
    },
  };
}

const originalFetch = globalThis.fetch;
const originalLocalStorage = globalThis.localStorage;

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: createStorage(),
    configurable: true,
  });
});

afterEach(() => {
  Object.defineProperty(globalThis, 'fetch', {
    value: originalFetch,
    configurable: true,
  });

  if (originalLocalStorage === undefined) {
    Reflect.deleteProperty(globalThis, 'localStorage');
    return;
  }

  Object.defineProperty(globalThis, 'localStorage', {
    value: originalLocalStorage,
    configurable: true,
  });
});

async function expectErrorMessage(call: () => Promise<unknown>, message: string) {
  try {
    await call();
    throw new Error('Expected request to throw');
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(message);
  }
}

for (const [name, call] of [
  ['addPlanSource', () => api.addPlanSource('/missing')],
  ['removePlanSource', () => api.removePlanSource('/missing')],
] as const) {
  test(`${name} surfaces JSON error messages from the server`, async () => {
    Object.defineProperty(globalThis, 'fetch', {
      value: async () =>
        new Response(JSON.stringify({ error: 'path does not exist: /missing' }), {
          status: 400,
          statusText: 'Bad Request',
          headers: { 'Content-Type': 'application/json' },
        }),
      configurable: true,
    });

    await expectErrorMessage(call, 'path does not exist: /missing');
  });
}
