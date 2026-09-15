import betterAuth from '@convex-dev/better-auth/convex.config';
import migrations from '@convex-dev/migrations/convex.config.js';
import stripe from '@convex-dev/stripe/convex.config.js';
import { defineApp } from 'convex/server';
import { v } from 'convex/values';

const app = defineApp({
  env: {
    APP_URL: v.optional(v.string()),
    BETTER_AUTH_BASE_URL: v.optional(v.string()),
    BETTER_AUTH_ENVIRONMENT: v.optional(v.string()),
    BETTER_AUTH_SECRET: v.optional(v.string()),
    BETTER_AUTH_TRUSTED_ORIGINS: v.optional(v.string()),
    GITHUB_CLIENT_ID: v.optional(v.string()),
    GITHUB_CLIENT_SECRET: v.optional(v.string()),
    GOOGLE_CLIENT_ID: v.optional(v.string()),
    GOOGLE_CLIENT_SECRET: v.optional(v.string()),
    SITE_URL: v.optional(v.string()),
  },
});
app.use(betterAuth);
app.use(migrations);
app.use(stripe);
export default app;
