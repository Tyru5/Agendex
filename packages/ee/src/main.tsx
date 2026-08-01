if (import.meta.env.DEV) {
  import('react-grab');
}

import { ThemeProvider } from '@agendex/web';
import { Analytics } from '@vercel/analytics/react';
import './index.css';
import { NuqsAdapter } from 'nuqs/adapters/react';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { PlanToaster } from './components/PlanToaster.tsx';
import { isDesktop, signalDesktopUiReady } from './lib/desktop.ts';

const desktop = isDesktop();

if (desktop) {
  document.documentElement.dataset.agendexDesktop = 'true';
}

/**
 * Confirms to the desktop shell that this UI bundle rendered.
 *
 * Deliberately an effect rather than a call after render(): effects only run
 * once React has committed, so a bundle that throws while rendering never
 * signals and the shell rolls back to the UI it shipped with. Rendered last so
 * it fires only after App's own effects have run.
 */
function DesktopUiReadySignal() {
  useEffect(() => {
    signalDesktopUiReady();
  }, []);
  return null;
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <NuqsAdapter>
      <ThemeProvider>
        <App />
        <PlanToaster />
        {/* Vercel Analytics is hosted-web only. In the desktop shell the local
            static server SPA-fallback returns index.html for
            /_vercel/insights/script.js, which throws SyntaxError and spams
            the console — skip it entirely offline/desktop. */}
        {!desktop && <Analytics />}
        {desktop && <DesktopUiReadySignal />}
      </ThemeProvider>
    </NuqsAdapter>
  </StrictMode>,
);
