if (import.meta.env.DEV) {
  import('react-grab');
}

import { ThemeProvider } from '@agendex/web';
import { Analytics } from '@vercel/analytics/react';
import './index.css';
import { NuqsAdapter } from 'nuqs/adapters/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import AppRoutes, { preloadRoute } from './AppRoutes.tsx';
import { isDesktop } from './lib/desktop.ts';

const desktop = isDesktop();

if (desktop) {
  document.documentElement.dataset.agendexDesktop = 'true';
}

// Fetch the current route's chunks before the first render so a direct visit
// paints the page itself, not a loading fallback that React then holds on
// screen for up to 300ms. Until then the document is as blank as it always was
// while the single bundle downloaded.
void preloadRoute(window.location.pathname).then(renderApp);

function renderApp() {
  createRoot(document.getElementById('root') as HTMLElement).render(
    <StrictMode>
      <NuqsAdapter>
        <ThemeProvider>
          {/* Routes also mount the plan toaster and the desktop UI-ready
            signal, so both load and fire with the page they belong to. */}
          <AppRoutes />
          {/* Vercel Analytics is hosted-web only. In the desktop shell the local
            static server SPA-fallback returns index.html for
            /_vercel/insights/script.js, which throws SyntaxError and spams
            the console — skip it entirely offline/desktop. */}
          {!desktop && <Analytics />}
        </ThemeProvider>
      </NuqsAdapter>
    </StrictMode>,
  );
}
