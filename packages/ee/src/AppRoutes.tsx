import {
  lazyWithPreload,
  preloadComponents,
  preloadPlanViewer,
  startViewTransition,
  whenIdle,
} from '@agendex/web';
import { type ReactNode, Suspense, useEffect } from 'react';
import { Redirect, Route, Switch, useLocation } from 'wouter';
import { BootLoadingView } from './components/BootLoadingView.tsx';
import { parseCliAuthCallback } from './lib/cli-auth-callback.ts';
import { isDesktop, signalDesktopUiReady } from './lib/desktop.ts';
import { parseDesktopAuthRequest } from './lib/desktop-auth-flow.ts';

// Every route is its own chunk, so a visitor downloads only the page they
// open: marketing pages skip the dashboard, Convex and the auth client, and
// the dashboard skips the marketing pages.

const AuthRuntime = lazyWithPreload(() =>
  import('./components/AuthRuntime.tsx').then((m) => m.AuthRuntime),
);
const PlanToaster = lazyWithPreload(() =>
  import('./components/PlanToaster.tsx').then((m) => m.PlanToaster),
);
const DashboardRoute = lazyWithPreload(() => import('./App.tsx').then((m) => m.DashboardRoute));
const AuthCheckRoute = lazyWithPreload(() => import('./App.tsx').then((m) => m.AuthCheckRoute));
const AuthPage = lazyWithPreload(() => import('./components/AuthPage.tsx').then((m) => m.AuthPage));
const CliAuthPage = lazyWithPreload(() =>
  import('./components/CliAuthPage.tsx').then((m) => m.CliAuthPage),
);
const DesktopAuthPage = lazyWithPreload(() =>
  import('./components/DesktopAuthPage.tsx').then((m) => m.DesktopAuthPage),
);
const SharedPlanView = lazyWithPreload(() =>
  import('./components/SharedPlanView.tsx').then((m) => m.SharedPlanView),
);
const OnboardingRoute = lazyWithPreload(() =>
  import('./components/OnboardingRoute.tsx').then((m) => m.OnboardingRoute),
);
const WelcomeScreen = lazyWithPreload(() =>
  import('./components/WelcomeScreen.tsx').then((m) => m.WelcomeScreen),
);
const AcceptInvitePage = lazyWithPreload(() =>
  import('./components/AcceptInvitePage.tsx').then((m) => m.AcceptInvitePage),
);
const SettingsPage = lazyWithPreload(() =>
  import('./components/SettingsPage.tsx').then((m) => m.SettingsPage),
);

const LandingRoute = lazyWithPreload(() =>
  import('./components/LandingRoute.tsx').then((m) => m.LandingRoute),
);
const AboutMePage = lazyWithPreload(() =>
  import('./components/AboutMePage.tsx').then((m) => m.AboutMePage),
);
const ChangelogPage = lazyWithPreload(() =>
  import('@agendex/web/components/ChangelogPage.tsx').then((m) => m.ChangelogPage),
);
const DocsPage = lazyWithPreload(() =>
  import('@agendex/web/components/DocsPage.tsx').then((m) => m.DocsPage),
);
const DownloadPage = lazyWithPreload(() =>
  import('@agendex/web/components/DownloadPage.tsx').then((m) => m.DownloadPage),
);
const ToolsUsedPage = lazyWithPreload(() =>
  import('@agendex/web/components/ToolsUsedPage.tsx').then((m) => m.ToolsUsedPage),
);
const TermsOfServicePage = lazyWithPreload(() =>
  import('@agendex/web/components/LegalPage.tsx').then((m) => m.TermsOfServicePage),
);
const PrivacyPolicyPage = lazyWithPreload(() =>
  import('@agendex/web/components/LegalPage.tsx').then((m) => m.PrivacyPolicyPage),
);

type Chunk = { preload: () => Promise<unknown> };
type RouteChunks = {
  pattern: string;
  /** Cloud routes render inside the Convex/Better Auth runtime. */
  authed: boolean;
  /** Chunks the route renders; awaited before the first paint of a direct visit. */
  render: readonly Chunk[];
  /** Chunks the route will likely need soon; fetched alongside, never awaited. */
  prefetch?: readonly Chunk[];
  /**
   * Routes a visitor is likely to open next, fetched once the page is idle.
   * An in-app navigation to a route that is not loaded yet shows a Suspense
   * fallback, and React then holds the new page back for up to 300ms.
   */
  next?: readonly Chunk[];
};

// Mirrors the <Switch> below. A path missing here still works; its chunks
// just load on render instead of ahead of it.
const PLAN_VIEWER: Chunk = { preload: preloadPlanViewer };
const TO_LANDING: readonly Chunk[] = [LandingRoute];
const TO_DASHBOARD: readonly Chunk[] = [AuthRuntime, PlanToaster, DashboardRoute];

const ROUTE_CHUNKS: readonly RouteChunks[] = [
  {
    pattern: '/',
    authed: false,
    render: [LandingRoute],
    next: [
      AuthRuntime,
      PlanToaster,
      AuthPage,
      DocsPage,
      ChangelogPage,
      DownloadPage,
      ToolsUsedPage,
      AboutMePage,
    ],
  },
  { pattern: '/about-me', authed: false, render: [AboutMePage], next: TO_LANDING },
  { pattern: '/changelog', authed: false, render: [ChangelogPage], next: TO_LANDING },
  { pattern: '/docs', authed: false, render: [DocsPage], next: TO_LANDING },
  { pattern: '/download', authed: false, render: [DownloadPage], next: TO_LANDING },
  { pattern: '/tools', authed: false, render: [ToolsUsedPage], next: TO_LANDING },
  { pattern: '/terms', authed: false, render: [TermsOfServicePage], next: TO_LANDING },
  { pattern: '/privacy', authed: false, render: [PrivacyPolicyPage], next: TO_LANDING },
  { pattern: '/auth/check', authed: true, render: [AuthCheckRoute] },
  { pattern: '/auth/cli', authed: true, render: [CliAuthPage] },
  { pattern: '/auth/desktop', authed: true, render: [DesktopAuthPage] },
  { pattern: '/login', authed: true, render: [AuthPage], next: TO_DASHBOARD },
  { pattern: '/signup', authed: true, render: [AuthPage], next: TO_DASHBOARD },
  { pattern: '/shared/:token', authed: true, render: [SharedPlanView] },
  {
    pattern: '/welcome',
    authed: true,
    render: [OnboardingRoute, WelcomeScreen],
    next: TO_DASHBOARD,
  },
  { pattern: '/invite/:token', authed: true, render: [AcceptInvitePage], next: TO_DASHBOARD },
  { pattern: '/settings', authed: true, render: [SettingsPage], next: TO_DASHBOARD },
  {
    pattern: '/dashboard',
    authed: true,
    render: [DashboardRoute],
    // Signed-out visitors are redirected straight to the login page.
    prefetch: [PLAN_VIEWER, AuthPage],
    next: [SettingsPage],
  },
];

/** Same shape of match as wouter's default parser: whole path, `:param` segments. */
function matchesPattern(pattern: string, pathname: string): boolean {
  const want = pattern.split('/');
  const got = (pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname).split('/');
  return (
    want.length === got.length &&
    want.every((segment, i) =>
      segment.startsWith(':') ? got[i] !== '' : segment.toLowerCase() === got[i]?.toLowerCase(),
    )
  );
}

/**
 * Fetches every chunk the route at `pathname` renders, in parallel. main.tsx
 * awaits this before the first render so a direct visit paints the page
 * without flashing a Suspense fallback (which React would then hold on screen
 * for up to 300ms). Never rejects: a failed chunk is retried by the render.
 */
function findRoute(pathname: string): RouteChunks | undefined {
  return ROUTE_CHUNKS.find((candidate) => matchesPattern(candidate.pattern, pathname));
}

export function preloadRoute(pathname: string): Promise<unknown> {
  const route = findRoute(pathname);
  if (!route) return Promise.resolve();
  preloadComponents(route.prefetch ?? []);
  const render = route.authed ? [AuthRuntime, PlanToaster, ...route.render] : route.render;
  return Promise.all(render.map((chunk) => chunk.preload())).catch(() => undefined);
}

/**
 * Confirms to the desktop shell that this UI bundle rendered.
 *
 * Deliberately an effect rather than a call after render(): effects only run
 * once React has committed, so a bundle that throws while rendering never
 * signals and the shell rolls back to the UI it shipped with. It sits in the
 * same Suspense boundary as the route's page, so it only commits once that
 * page's chunk has loaded and rendered, and fires after the page's effects.
 */
function DesktopUiReadySignal() {
  useEffect(() => {
    signalDesktopUiReady();
  }, []);
  return null;
}

/**
 * Wraps a cloud route in the Convex/Better Auth runtime. The runtime and the
 * route's pages are separate chunks; requesting them all here downloads them
 * in parallel instead of one after another. The element shape is identical for
 * every cloud route, so navigating between them keeps the runtime mounted.
 */
function Authed({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  const [location] = useLocation();
  void preloadRoute(location);
  return (
    <Suspense fallback={fallback}>
      <AuthRuntime>
        <Suspense fallback={fallback}>
          {children}
          {isDesktop() && <DesktopUiReadySignal />}
        </Suspense>
      </AuthRuntime>
      <Suspense fallback={null}>
        <PlanToaster />
      </Suspense>
    </Suspense>
  );
}

function ChangelogRoute() {
  const [, navigate] = useLocation();
  return <ChangelogPage onBack={() => startViewTransition(() => navigate('/'))} />;
}

function DocsRoute() {
  const [, navigate] = useLocation();
  return <DocsPage onBack={() => startViewTransition(() => navigate('/'))} />;
}

function DownloadRoute() {
  const [, navigate] = useLocation();
  return <DownloadPage onBack={() => startViewTransition(() => navigate('/'))} />;
}

function ToolsUsedRoute() {
  const [, navigate] = useLocation();
  return <ToolsUsedPage onBack={() => startViewTransition(() => navigate('/'))} />;
}

function TermsRoute() {
  const [, navigate] = useLocation();
  return <TermsOfServicePage onBack={() => startViewTransition(() => navigate('/'))} />;
}

function PrivacyRoute() {
  const [, navigate] = useLocation();
  return <PrivacyPolicyPage onBack={() => startViewTransition(() => navigate('/'))} />;
}

/** Once the current page is idle, warms the routes a visitor is likely to open next. */
function usePrefetchNextRoutes() {
  const [location] = useLocation();
  useEffect(() => {
    const next = findRoute(location)?.next;
    if (!next?.length) return;
    return whenIdle(() => preloadComponents(next));
  }, [location]);
}

function CliAuthRoute() {
  const callback = new URLSearchParams(window.location.search).get('callback');
  if (!callback) return <Redirect to="/" />;
  const cliCallback = parseCliAuthCallback(callback);
  if (!cliCallback.ok) return <AuthCallbackError title="Invalid CLI callback" />;
  return <CliAuthPage callbackUrl={cliCallback.callbackUrl} />;
}

function DesktopAuthRoute() {
  const authRequest = parseDesktopAuthRequest(window.location.href);
  if (!authRequest.ok) return <AuthCallbackError title="Invalid desktop callback" />;
  return <DesktopAuthPage authRequest={authRequest} />;
}

function AuthCallbackError({ title }: { readonly title: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="text-center space-y-2 max-w-[320px] w-full px-5">
        <h1 className="font-semibold text-[16px] text-text">{title}</h1>
        <p className="text-[13px] text-[#ef4444]">This authorization link is not supported.</p>
      </div>
    </div>
  );
}

export default function AppRoutes() {
  usePrefetchNextRoutes();
  return (
    <Suspense fallback={null}>
      <Switch>
        <Route path="/auth/check">
          {() => (
            <Authed fallback={<BootLoadingView />}>
              <AuthCheckRoute />
            </Authed>
          )}
        </Route>
        <Route path="/auth/cli">
          {() => (
            <Authed>
              <CliAuthRoute />
            </Authed>
          )}
        </Route>
        <Route path="/auth/desktop">
          {() => (
            <Authed>
              <DesktopAuthRoute />
            </Authed>
          )}
        </Route>
        <Route path="/login">
          {() => (
            <Authed>
              <AuthPage mode="login" />
            </Authed>
          )}
        </Route>
        <Route path="/signup">
          {() => (
            <Authed>
              <AuthPage mode="signup" />
            </Authed>
          )}
        </Route>
        <Route path="/shared/:token">
          {({ token }) => (
            <Authed>
              <SharedPlanView token={token} />
            </Authed>
          )}
        </Route>
        <Route path="/about-me" component={AboutMePage} />
        <Route path="/changelog" component={ChangelogRoute} />
        <Route path="/docs" component={DocsRoute} />
        <Route path="/download" component={DownloadRoute} />
        <Route path="/tools" component={ToolsUsedRoute} />
        <Route path="/terms" component={TermsRoute} />
        <Route path="/privacy" component={PrivacyRoute} />
        <Route path="/welcome">
          <Authed>
            <OnboardingRoute>
              <WelcomeScreen />
            </OnboardingRoute>
          </Authed>
        </Route>
        <Route path="/invite/:token">
          {({ token }) => (
            <Authed>
              <AcceptInvitePage token={token} />
            </Authed>
          )}
        </Route>
        <Route path="/settings">
          {() => (
            <Authed>
              <SettingsPage />
            </Authed>
          )}
        </Route>
        <Route path="/dashboard">
          {() => (
            <Authed fallback={<BootLoadingView />}>
              <DashboardRoute />
            </Authed>
          )}
        </Route>
        <Route path="/" component={LandingRoute} />
      </Switch>
    </Suspense>
  );
}
