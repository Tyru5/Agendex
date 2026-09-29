import { afterEach, beforeEach, expect, test } from 'bun:test';
import { api, prefetchDashboardData } from './api.ts';

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

test('updatePlanAnnotationStatus can send writeback without status', async () => {
  localStorage.setItem('agendex_token', 'token-1');

  let requestBody: unknown;
  Object.defineProperty(globalThis, 'fetch', {
    value: async (_url: string, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          id: 'annotation-1',
          type: 'comment',
          status: 'open',
          anchor: {},
          createdAt: 1,
          updatedAt: 2,
          writebackId: 'writeback-1',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    },
    configurable: true,
  });

  await api.updatePlanAnnotationStatus('plan-1', 'annotation-1', undefined, 'writeback-1');

  expect(requestBody).toEqual({ writebackId: 'writeback-1' });
});

test('the dashboard takes over prefetched plan and agent responses instead of refetching', async () => {
  localStorage.setItem('agendex_token', 'token-1');
  const requested: string[] = [];
  Object.defineProperty(globalThis, 'fetch', {
    value: async (url: string) => {
      requested.push(url);
      const body = url.startsWith('/api/v1/plans') ? { plans: [], total: 0 } : [];
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
    configurable: true,
  });

  prefetchDashboardData({ sort: 'updatedAt' });
  expect(requested).toEqual(['/api/v1/plans?sort=updatedAt&limit=10000', '/api/v1/agents']);

  await Promise.all([api.getPlans({ sort: 'updatedAt' }), api.getAgents()]);
  expect(requested).toHaveLength(2);

  // A prefetch is handed over once; later calls hit the network again.
  await api.getPlans({ sort: 'updatedAt' });
  expect(requested).toHaveLength(3);
});

/** Lets pending requests settle before the dashboard asks for them. */
function settle() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test('a prefetch that finished before the dashboard asked is not reused', async () => {
  localStorage.setItem('agendex_token', 'token-1');
  let planRequests = 0;
  Object.defineProperty(globalThis, 'fetch', {
    value: async (url: string) => {
      const body = url.startsWith('/api/v1/plans') ? { plans: [], total: ++planRequests } : [];
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
    configurable: true,
  });

  prefetchDashboardData({ sort: 'updatedAt' });
  await settle();

  const res = await api.getPlans({ sort: 'updatedAt' });
  expect(planRequests).toBe(2);
  expect(res.total).toBe(2);
});

test('a prefetch that failed before the dashboard asked is retried', async () => {
  localStorage.setItem('agendex_token', 'token-1');
  let planRequests = 0;
  Object.defineProperty(globalThis, 'fetch', {
    value: async (url: string) => {
      if (url.startsWith('/api/v1/plans') && ++planRequests === 1) {
        return new Response('backend starting', { status: 503, statusText: 'Unavailable' });
      }
      const body = url.startsWith('/api/v1/plans') ? { plans: [], total: planRequests } : [];
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
    configurable: true,
  });

  prefetchDashboardData({ sort: 'updatedAt' });
  await settle();

  const res = await api.getPlans({ sort: 'updatedAt' });
  expect(planRequests).toBe(2);
  expect(res.total).toBe(2);
});

test('dashboard data is not prefetched without a token', () => {
  const requested: string[] = [];
  Object.defineProperty(globalThis, 'fetch', {
    value: async (url: string) => {
      requested.push(url);
      return new Response('[]');
    },
    configurable: true,
  });

  prefetchDashboardData({ sort: 'updatedAt' });

  expect(requested).toEqual([]);
});

test('optional local CLI detection surfaces unauthorized without expiring or reloading cloud session', async () => {
  localStorage.setItem('agendex_token', 'expired-local-token');
  Object.defineProperty(globalThis, 'fetch', {
    value: async () => new Response('{}', { status: 401 }),
    configurable: true,
  });
  // No window/sessionStorage globals exist in this test; a reload or session-expiry write would throw.
  await expectErrorMessage(() => api.getHandoffClis(), 'Local Agendex authentication is required.');
  expect(localStorage.getItem('agendex_token')).toBe('expired-local-token');
});
