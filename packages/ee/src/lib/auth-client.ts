import { convexClient, crossDomainClient } from '@convex-dev/better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

export const APP_URL = (
  import.meta.env.VITE_APP_URL || (typeof window !== 'undefined' ? window.location.origin : '')
).replace(/\/$/, '');

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_CONVEX_SITE_URL as string,
  plugins: [convexClient(), crossDomainClient()],
});
