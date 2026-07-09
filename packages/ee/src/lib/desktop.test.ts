import { expect, test } from 'bun:test';
import {
  type AgendexDesktopBridge,
  type DesktopAuthProvider,
  clearDesktopCloudSession,
  desktopLogin,
  desktopLogout,
  getDesktopConvexAuthToken,
  normalizeDesktopAuthProvider,
} from './desktop.ts';

type TestLocation = {
  readonly origin: string;
  readonly pathname: string;
  href: string;
  reload: () => void;
};

/** Mutable test double — production Electron freezes these fields via contextBridge. */
type MutableTestBridge = {
  -readonly [K in keyof AgendexDesktopBridge]: AgendexDesktopBridge[K];
};

type TestDesktopWindow = {
  readonly agendexDesktop: MutableTestBridge;
  readonly location: TestLocation;
};

function installDesktopWindow(login: AgendexDesktopBridge['login']) {
  let reloadCount = 0;
  let loginProvider: DesktopAuthProvider | undefined;

  const bridge: MutableTestBridge = {
    isDesktop: true,
    cloudToken: null,
    convexSiteUrl: null,
    login: async (provider?: DesktopAuthProvider) => {
      loginProvider = provider;
      return login(provider);
    },
    logout: async () => true,
    setModePref: async () => true,
    refreshCloudSession: async () => null,
    getConvexAuthToken: async () => null,
  };

  const desktopWindow: TestDesktopWindow = {
    agendexDesktop: bridge,
    location: {
      origin: 'http://app.agendex.localhost:5174',
      pathname: '/dashboard',
      href: 'http://app.agendex.localhost:5174/dashboard',
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
    bridge,
    getLoginProvider: () => loginProvider,
    getReloadCount: () => reloadCount,
    getHref: () => desktopWindow.location.href,
  };
}

function uninstallDesktopWindow() {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: undefined,
  });
}

test('keeps supported desktop auth providers', () => {
  expect(normalizeDesktopAuthProvider('github')).toBe('github');
  expect(normalizeDesktopAuthProvider('google')).toBe('google');
});

test('ignores unsupported desktop auth providers', () => {
  expect(normalizeDesktopAuthProvider('apple')).toBeUndefined();
  expect(normalizeDesktopAuthProvider(undefined)).toBeUndefined();
});

test('desktopLogin returns false without reloading when preload login resolves false', async () => {
  // Given
  const runtime = installDesktopWindow(async () => false);

  try {
    // When
    const ok = await desktopLogin('github');

    // Then
    expect(ok).toBe(false);
    expect(runtime.getReloadCount()).toBe(0);
    expect(runtime.getLoginProvider()).toBe('github');
  } finally {
    uninstallDesktopWindow();
  }
});

test('desktopLogin reloads exactly once when preload login resolves true', async () => {
  // Given
  const runtime = installDesktopWindow(async () => true);

  try {
    // When
    const ok = await desktopLogin('google');

    // Then
    expect(ok).toBe(true);
    expect(runtime.getReloadCount()).toBe(1);
    expect(runtime.getLoginProvider()).toBe('google');
  } finally {
    uninstallDesktopWindow();
  }
});

test('desktopLogin surfaces rejected preload login as false without reloading', async () => {
  // Given
  const runtime = installDesktopWindow(async () => {
    throw new Error('native browser did not open');
  });

  try {
    // When
    const ok = await desktopLogin('github');

    // Then
    expect(ok).toBe(false);
    expect(runtime.getReloadCount()).toBe(0);
    expect(runtime.getLoginProvider()).toBe('github');
  } finally {
    uninstallDesktopWindow();
  }
});

test('desktop Convex auth token is requested through the preload bridge', async () => {
  // Given
  const runtime = installDesktopWindow(async () => true);
  runtime.bridge.cloudToken = 'desktop-cloud-token';
  runtime.bridge.convexSiteUrl = 'https://enduring-eagle-295.convex.site';
  runtime.bridge.getConvexAuthToken = async () => 'convex-jwt';

  try {
    // When
    const token = await getDesktopConvexAuthToken();

    // Then
    expect(token).toBe('convex-jwt');
  } finally {
    uninstallDesktopWindow();
  }
});

test('clearDesktopCloudSession only calls logout and does not assign frozen bridge fields', async () => {
  let logoutCount = 0;
  const session = {
    cloudToken: 'tok' as string | null,
    convexSiteUrl: 'https://x.convex.site' as string | null,
  };

  // Mimic contextBridge: readable getters, assignment throws (read-only).
  const bridge = {
    isDesktop: true as const,
    get cloudToken() {
      return session.cloudToken;
    },
    get convexSiteUrl() {
      return session.convexSiteUrl;
    },
    login: async () => false,
    logout: async () => {
      logoutCount += 1;
      session.cloudToken = null;
      session.convexSiteUrl = null;
      return true;
    },
    setModePref: async () => true,
    refreshCloudSession: async () => null,
    getConvexAuthToken: async () => null,
  };

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      agendexDesktop: bridge,
      location: {
        origin: 'http://localhost:57352',
        pathname: '/dashboard',
        href: 'http://localhost:57352/dashboard',
        reload: () => {},
      },
    },
  });

  try {
    await clearDesktopCloudSession();
    expect(logoutCount).toBe(1);
    expect(bridge.cloudToken).toBeNull();
    expect(bridge.convexSiteUrl).toBeNull();
  } finally {
    uninstallDesktopWindow();
  }
});

test('desktopLogout reloads dashboard after clearing session without throwing on read-only fields', async () => {
  let logoutCount = 0;
  let reloadCount = 0;
  const session = {
    cloudToken: 'tok' as string | null,
    convexSiteUrl: 'https://x.convex.site' as string | null,
  };

  const bridge = {
    isDesktop: true as const,
    get cloudToken() {
      return session.cloudToken;
    },
    get convexSiteUrl() {
      return session.convexSiteUrl;
    },
    login: async () => false,
    logout: async () => {
      logoutCount += 1;
      session.cloudToken = null;
      session.convexSiteUrl = null;
      return true;
    },
    setModePref: async () => true,
    refreshCloudSession: async () => null,
    getConvexAuthToken: async () => null,
  };

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      agendexDesktop: bridge,
      location: {
        origin: 'http://localhost:57352',
        pathname: '/dashboard',
        href: 'http://localhost:57352/dashboard',
        reload: () => {
          reloadCount += 1;
        },
      },
    },
  });

  try {
    await desktopLogout();
    expect(logoutCount).toBe(1);
    expect(reloadCount).toBe(1);
  } finally {
    uninstallDesktopWindow();
  }
});
