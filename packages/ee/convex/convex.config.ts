import betterAuth from '@convex-dev/better-auth/convex.config';
import stripe from '@convex-dev/stripe/convex.config.js';
import { defineApp } from 'convex/server';

const app = defineApp();
app.use(betterAuth);
app.use(stripe);
export default app;
