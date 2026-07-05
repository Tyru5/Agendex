if (import.meta.env.DEV) {
  import('react-grab');
}

import { ThemeProvider } from '@agendex/web';
import { Analytics } from '@vercel/analytics/react';
import './index.css';
import { NuqsAdapter } from 'nuqs/adapters/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { isDesktop } from './lib/desktop.ts';

if (isDesktop()) {
  document.documentElement.dataset.agendexDesktop = 'true';
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <NuqsAdapter>
      <ThemeProvider>
        <App />
        <Analytics />
      </ThemeProvider>
    </NuqsAdapter>
  </StrictMode>,
);
