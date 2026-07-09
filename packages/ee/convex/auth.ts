import { createClient, type GenericCtx } from '@convex-dev/better-auth';
import { convex, crossDomain } from '@convex-dev/better-auth/plugins';
import { betterAuth } from 'better-auth/minimal';
import { bearer } from 'better-auth/plugins';
import { components } from './_generated/api';
import type { DataModel } from './_generated/dataModel';
import { query } from './_generated/server';
import authConfig from './auth.config';
import { buildTrustedOrigins } from './auth-origins';

export const authComponent = createClient<DataModel>(components.betterAuth);

export { LOCAL_DEV_CORS_ORIGINS, buildTrustedOrigins, isLocalDevOrigin } from './auth-origins';

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  const siteUrl = process.env.SITE_URL ?? '';
  const appUrl = process.env.APP_URL ?? '';
  if (!appUrl && siteUrl) {
    console.warn('APP_URL not set — crossDomain plugin falling back to SITE_URL');
  }
  const convexSiteUrl = process.env.CONVEX_SITE_URL ?? '';
  const githubClientId = process.env.GITHUB_CLIENT_ID;
  const githubClientSecret = process.env.GITHUB_CLIENT_SECRET;
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

  return betterAuth({
    baseURL: convexSiteUrl,
    secret: process.env.BETTER_AUTH_SECRET,
    // Function form so each CORS preflight can reflect Electron's ephemeral
    // `http://localhost:<port>` origin into the exact-match allowlist.
    trustedOrigins: (request) =>
      buildTrustedOrigins({
        siteUrl,
        appUrl,
        requestOrigin: request?.headers.get('origin'),
      }),
    database: authComponent.adapter(ctx),
    socialProviders: {
      ...(githubClientId && githubClientSecret
        ? {
            github: {
              clientId: githubClientId,
              clientSecret: githubClientSecret,
            },
          }
        : {}),
      ...(googleClientId && googleClientSecret
        ? {
            google: {
              clientId: googleClientId,
              clientSecret: googleClientSecret,
              overrideUserInfoOnSignIn: true,
            },
          }
        : {}),
    },
    plugins: [crossDomain({ siteUrl: appUrl || siteUrl }), convex({ authConfig }), bearer()],
  });
};

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    return authComponent.safeGetAuthUser(ctx);
  },
});
