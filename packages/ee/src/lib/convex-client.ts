import { ConvexReactClient } from 'convex/react';
import { getDesktopConvexCloudUrl } from './desktop.ts';

// Desktop derives the deployment URL from the Convex site URL captured at login,
// so no build-time env is required there. The placeholder keeps the client
// constructable before sign-in (no cloud queries run until authenticated).
const convexUrl =
  getDesktopConvexCloudUrl() ||
  (import.meta.env.VITE_CONVEX_URL as string) ||
  'https://placeholder.convex.cloud';

export const convex = new ConvexReactClient(convexUrl);
