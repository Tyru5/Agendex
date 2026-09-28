import {
  hasToken,
  lazyWithPreload,
  preloadComponents,
  prefetchDashboardData,
  preloadPlanViewer,
  setToken,
  startViewTransition,
  whenIdle,
} from '@agendex/web';
import { type ComponentType, Suspense, useEffect, useState } from 'react';
import { sortFromSearch } from './dashboardSort.ts';

// Each page is its own chunk: the landing page no longer downloads the
// dashboard, and the dashboard no longer downloads the marketing pages.
const Dashboard = lazyWithPreload(() => import('./App.tsx').then((m) => m.Dashboard));
const LandingPage = lazyWithPreload(() =>
  import('@agendex/web/components/LandingPage.tsx').then((m) => m.LandingPage),
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

type Subpage = ComponentType<{ onBack?: () => void }> & { preload: () => Promise<unknown> };

/** Standalone pages, each reached with a full page load. */
const SUBPAGES: Record<string, Subpage | undefined> = {
  '/changelog': ChangelogPage,
  '/docs': DocsPage,
  '/download': DownloadPage,
  '/tools': ToolsUsedPage,
  '/terms': TermsOfServicePage,
  '/privacy': PrivacyPolicyPage,
};

function goTo(path: string) {
  startViewTransition(() => {
    window.location.href = path;
  });
}

/**
 * Fetches the chunks the current page renders. main.tsx awaits this before
 * the first render so the page paints directly, without a Suspense fallback
 * that React would then hold on screen for up to 300ms. Never rejects: a
 * failed chunk is retried by the render.
 */
export function preloadRoute(): Promise<unknown> {
  const subpage = SUBPAGES[window.location.pathname];
  if (subpage) return subpage.preload().catch(() => undefined);
  const signedIn = hasToken() || window.location.hash.startsWith('#token=');
  if (!signedIn) return LandingPage.preload().catch(() => undefined);
  // Start the plan list and the viewer alongside the dashboard's own chunk:
  // the list is the dashboard's slowest dependency, and the viewer is needed
  // as soon as a plan opens.
  prefetchDashboardData({ sort: sortFromSearch(window.location.search) });
  void preloadPlanViewer();
  return Dashboard.preload().catch(() => undefined);
}

/**
 * Once the landing page is idle, warm the dashboard (next stop after
 * connecting) and the pages the landing page links to.
 */
function LandingPrefetch() {
  useEffect(
    () =>
      whenIdle(() =>
        preloadComponents([Dashboard, DocsPage, ChangelogPage, DownloadPage, ToolsUsedPage]),
      ),
    [],
  );
  return null;
}

function SessionExpiredBanner() {
  const [visible, setVisible] = useState(() => {
    const expired = sessionStorage.getItem('agendex_session_expired');
    if (expired) {
      sessionStorage.removeItem('agendex_session_expired');
      return true;
    }
    return false;
  });

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => setVisible(false), 8000);
    return () => clearTimeout(timer);
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="session-expired-banner">
      <span className="session-expired-icon">
        <svg viewBox="0 0 16 16" fill="none" width="15" height="15">
          <path
            d="M8 1.33a6.67 6.67 0 1 0 0 13.34A6.67 6.67 0 0 0 8 1.33ZM8 5v3.33M8 10.67h.007"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span>Session expired — please log in again to continue.</span>
      <button className="session-expired-dismiss" onClick={() => setVisible(false)} type="button">
        <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
          <path
            d="M12 4L4 12M4 4l8 8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}

function Routes() {
  const Subpage = SUBPAGES[window.location.pathname];
  if (Subpage) return <Subpage onBack={() => goTo('/')} />;

  // Accept a one-time token from the URL fragment (e.g. /#token=abc) so setup
  // links can connect without pasting. Fragments never reach the server; the
  // hash is stripped immediately so the token doesn't linger in the URL.
  if (window.location.hash.startsWith('#token=')) {
    const token = window.location.hash.slice('#token='.length).trim();
    if (token) setToken(token);
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  if (!hasToken()) {
    return (
      <>
        <SessionExpiredBanner />
        <LandingPrefetch />
        <LandingPage
          onShowChangelog={() => goTo('/changelog')}
          onShowDocs={() => goTo('/docs')}
          onShowDownload={() => goTo('/download')}
          onShowTools={() => goTo('/tools')}
        />
      </>
    );
  }

  return <Dashboard />;
}

export default function AppRoutes() {
  return (
    <Suspense fallback={null}>
      <Routes />
    </Suspense>
  );
}
