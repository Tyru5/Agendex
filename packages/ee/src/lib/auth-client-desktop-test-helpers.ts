import type { AgendexDesktopBridge } from './desktop.ts';

type TestLocation = {
  reload: () => void;
};

type TestDesktopWindow = {
  readonly agendexDesktop: AgendexDesktopBridge;
  readonly location: TestLocation;
};

export function installDesktopWindow(bridge: Partial<AgendexDesktopBridge> = {}) {
  let reloadCount = 0;
  let logoutCount = 0;
  let cloudToken = bridge.cloudToken ?? null;
  let convexSiteUrl = bridge.convexSiteUrl ?? null;
  const desktop: AgendexDesktopBridge = {
    isDesktop: true,
    get cloudToken() {
      return cloudToken;
    },
    get convexSiteUrl() {
      return convexSiteUrl;
    },
    login: bridge.login ?? (async () => false),
    logout: async () => {
      logoutCount += 1;
      cloudToken = null;
      convexSiteUrl = null;
      return true;
    },
    setModePref: bridge.setModePref ?? (async () => true),
    refreshCloudSession: bridge.refreshCloudSession ?? (async () => null),
    getConvexAuthToken: bridge.getConvexAuthToken ?? (async () => null),
    authFetch:
      bridge.authFetch ??
      (async (url, init) => {
        const headers = new Headers();
        for (const [name, value] of init.headers) {
          headers.append(name, value);
        }
        const response = await fetch(url, {
          body: init.body ?? undefined,
          headers,
          method: init.method,
        });
        return {
          body: await response.text(),
          headers: Array.from(response.headers.entries()),
          status: response.status,
          statusText: response.statusText,
        };
      }),
  };

  if (bridge.logout) {
    const override = bridge.logout;
    desktop.logout = async () => {
      logoutCount += 1;
      return override();
    };
  }

  const desktopWindow: TestDesktopWindow = {
    agendexDesktop: desktop,
    location: {
      reload: () => {
        reloadCount += 1;
      },
    },
  };

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: desktopWindow,
  });

  return {
    desktop,
    getReloadCount: () => reloadCount,
    getLogoutCount: () => logoutCount,
  };
}

export function uninstallDesktopWindow() {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: undefined,
  });
}

export function createTestFetch(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return Object.assign(handler, { preconnect: globalThis.fetch.preconnect });
}

export function authorizationFromFetchArgs(
  input: RequestInfo | URL,
  init?: RequestInit,
): string | null {
  if (input instanceof Request) return input.headers.get('Authorization');
  return new Headers(init?.headers).get('Authorization');
}

export async function bodyFromFetchArgs(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<string | null> {
  if (input instanceof Request) {
    try {
      return await input.text();
    } catch {
      return null;
    }
  }
  if (typeof init?.body === 'string') return init.body;
  return null;
}
