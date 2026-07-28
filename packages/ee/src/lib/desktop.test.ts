import { expect, test } from 'bun:test';
import {
  type AgendexDesktopBridge,
  type DesktopAuthProvider,
  DESKTOP_PAGE_ZOOM_EVENT,
  desktopLogout,
  desktopLogin,
  getDesktopConvexAuthToken,
  getDesktopPageZoomFactor,
  normalizeDesktopAuthProvider,
  resetDesktopPageZoom,
  subscribeDesktopPageZoom,
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
  addEventListener: EventTarget['addEventListener'];
  removeEventListener: EventTarget['removeEventListener'];
  dispatchEvent: EventTarget['dispatchEvent'];
};

function installDesktopWindow(
  login: AgendexDesktopBridge['login'],
  bridgeOverrides: Partial<AgendexDesktopBridge> = {},
) {
  let reloadCount = 0;
  let loginProvider: DesktopAuthProvider | undefined;
  const cloudToken = bridgeOverrides.cloudToken ?? null;
  const convexSiteUrl = bridgeOverrides.convexSiteUrl ?? null;

  const bridge: AgendexDesktopBridge = {
    isDesktop: true,
    get cloudToken() {
      return cloudToken;
    },
    get convexSiteUrl() {
      return convexSiteUrl;
    },
    login: async (provider?: DesktopAuthProvider) => {
      loginProvider = provider;
      return login(provider);
    },
    logout: bridgeOverrides.logout ?? (async () => true),
    setModePref: bridgeOverrides.setModePref ?? (async () => true),
    refreshCloudSession: bridgeOverrides.refreshCloudSession ?? (async () => null),
    getConvexAuthToken: bridgeOverrides.getConvexAuthToken ?? (async () => null),
    authFetch:
      bridgeOverrides.authFetch ??
      (async () => ({
        body: null,
        headers: [],
        status: 204,
        statusText: 'No Content',
      })),
    checkForUpdates: bridgeOverrides.checkForUpdates ?? (async () => undefined),
    installUpdate: bridgeOverrides.installUpdate ?? (async () => undefined),
    getUpdateState:
      bridgeOverrides.getUpdateState ?? (async () => ({ status: 'unsupported' as const })),
    getAppVersion: bridgeOverrides.getAppVersion ?? (async () => '0.0.0-test'),
    getBuildInfo:
      bridgeOverrides.getBuildInfo ?? (async () => ({ platform: 'linux', codeSigned: null })),
    getPageZoomFactor: bridgeOverrides.getPageZoomFactor ?? (() => 1),
    resetPageZoom: bridgeOverrides.resetPageZoom ?? (() => undefined),
  };

  const events = new EventTarget();
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
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  };

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: desktopWindow,
  });

  return {
    bridge,
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
  installDesktopWindow(async () => true, {
    cloudToken: 'desktop-cloud-token',
    convexSiteUrl: 'https://enduring-eagle-295.convex.site',
    getConvexAuthToken: async () => 'convex-jwt',
  });

  try {
    // When
    const token = await getDesktopConvexAuthToken();

    // Then
    expect(token).toBe('convex-jwt');
  } finally {
    uninstallDesktopWindow();
  }
});

test('desktop page zoom reads and resets through the preload bridge', () => {
  // Given
  let resetCount = 0;
  installDesktopWindow(async () => true, {
    getPageZoomFactor: () => 1.25,
    resetPageZoom: () => {
      resetCount += 1;
    },
  });

  try {
    // When
    const factor = getDesktopPageZoomFactor();
    resetDesktopPageZoom();

    // Then
    expect(factor).toBe(1.25);
    expect(resetCount).toBe(1);
  } finally {
    uninstallDesktopWindow();
  }
});

test('subscribeDesktopPageZoom listens for preload page-zoom events', () => {
  // Given
  installDesktopWindow(async () => true, {
    getPageZoomFactor: () => 1.1,
  });
  const seen: number[] = [];

  try {
    // When
    const unsubscribe = subscribeDesktopPageZoom((factor) => {
      seen.push(factor);
    });
    window.dispatchEvent(new CustomEvent(DESKTOP_PAGE_ZOOM_EVENT, { detail: 1.5 }));
    unsubscribe();
    window.dispatchEvent(new CustomEvent(DESKTOP_PAGE_ZOOM_EVENT, { detail: 2 }));

    // Then
    expect(seen).toEqual([1.5]);
  } finally {
    uninstallDesktopWindow();
  }
});

test('desktopLogout does not mutate a frozen contextBridge object', async () => {
  // Given
  const runtime = installDesktopWindow(async () => true);
  const { bridge } = runtime;
  let logoutCount = 0;
  bridge.logout = async () => {
    logoutCount += 1;
    return true;
  };
  Object.freeze(bridge);

  try {
    // When
    await desktopLogout();

    // Then
    expect(logoutCount).toBe(1);
    expect(window.location.href).toBe('http://app.agendex.localhost:5174/dashboard');
  } finally {
    uninstallDesktopWindow();
  }
});
