import { NuqsAdapter } from 'nuqs/adapters/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ThemeProvider } from '@agendex/web';
import './index.css';

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <NuqsAdapter>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </NuqsAdapter>
  </StrictMode>,
);
