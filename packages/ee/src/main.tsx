import { ThemeProvider } from '@agendex/web';
import { ConvexBetterAuthProvider } from '@convex-dev/better-auth/react';
import '@agendex/web/styles';
import { NuqsAdapter } from 'nuqs/adapters/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { authClient } from './lib/auth-client.ts';
import { convex } from './lib/convex-client.ts';

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <NuqsAdapter>
      <ConvexBetterAuthProvider client={convex} authClient={authClient}>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </ConvexBetterAuthProvider>
    </NuqsAdapter>
  </StrictMode>,
);
