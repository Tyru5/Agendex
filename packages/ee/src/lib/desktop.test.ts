import { expect, test } from 'bun:test';
import {
  type AgendexDesktopBridge,
  type DesktopAuthProvider,
  desktopLogin,
  getDesktopConvexAuthToken,
  normalizeDesktopAuthProvider,
} from './desktop.ts';

type TestLocation = {
  readonly origin: string;
  readonly pathname: string;
  href: string;
  reload: () => void;
};

type TestDesktopWindow = {
  readonly agendexDesktop: AgendexDesktopBridge;
  readonly location: TestLocation;
};

function installDesktopWindow(login: AgendexDesktopBridge['login']) {
  let reloadCount = 0;
  let loginProvider: DesktopAuthProvider | undefined;

  const bridge: AgendexDesktopBridge = {
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
    getLoginProvider: () => loginProvider,
    getReloadCount: () => reloadCount,
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
  installDesktopWindow(async () => true);
  (window as unknown as TestDesktopWindow).agendexDesktop.cloudToken = 'desktop-cloud-token';
  (window as unknown as TestDesktopWindow).agendexDesktop.convexSiteUrl =
    'https://enduring-eagle-295.convex.site';
  (window as unknown as TestDesktopWindow).agendexDesktop.getConvexAuthToken = async () =>
    'convex-jwt';

  try {
    // When
    const token = await getDesktopConvexAuthToken();

    // Then
    expect(token).toBe('convex-jwt');
  } finally {
    uninstallDesktopWindow();
  }
});
