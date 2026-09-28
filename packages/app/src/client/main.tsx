import { NuqsAdapter } from 'nuqs/adapters/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import AppRoutes, { preloadRoute } from './AppRoutes.tsx';
import { ThemeProvider } from '@agendex/web';
import './index.css';

// Fetch the current page's chunks before the first render so it paints
// directly instead of flashing a Suspense fallback first.
void preloadRoute().then(() => {
  createRoot(document.getElementById('root') as HTMLElement).render(
    <StrictMode>
      <NuqsAdapter>
        <ThemeProvider>
          <AppRoutes />
        </ThemeProvider>
      </NuqsAdapter>
    </StrictMode>,
  );
});
