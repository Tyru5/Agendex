import { defineApp } from 'convex/server';
import betterAuth from '@convex-dev/better-auth/convex.config';
import stripe from '@convex-dev/stripe/convex.config';

const app = defineApp();
app.use(betterAuth);
app.use(stripe);
export default app;
