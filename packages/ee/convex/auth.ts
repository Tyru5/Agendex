import { createClient, type GenericCtx } from '@convex-dev/better-auth';
import { convex, crossDomain } from '@convex-dev/better-auth/plugins';
import { betterAuth } from 'better-auth/minimal';
import { v } from 'convex/values';
import { bearer } from 'better-auth/plugins';
import { components } from './_generated/api';
import type { DataModel } from './_generated/dataModel';
import { env, query } from './_generated/server';
import authConfig from './auth.config';
import { authUserValidator } from './validators';

export const authComponent = createClient<DataModel>(components.betterAuth);

const LOCAL_DEVELOPMENT_AUTH_ORIGIN_ALLOWLIST: Readonly<Record<string, true>> = {
  'http://agendex.localhost:5174': true,
  'http://app.agendex.localhost:5174': true,
  'http://localhost:5174': true,
  'http://127.0.0.1:5174': true,
};

export const LOCAL_DEVELOPMENT_AUTH_ORIGINS = Object.freeze(
  Object.keys(LOCAL_DEVELOPMENT_AUTH_ORIGIN_ALLOWLIST),
);

type AuthOriginEnvironment = {
  APP_URL?: string;
  BETTER_AUTH_ENVIRONMENT?: string;
  BETTER_AUTH_TRUSTED_ORIGINS?: string;
  SITE_URL?: string;
};

type AuthBaseUrlEnvironment = {
  BETTER_AUTH_BASE_URL?: string;
  CONVEX_SITE_URL?: string;
};

function parseExactOrigin(value: string, source: string): string {
  const candidate = value.trim();
  if (!candidate) {
    throw new Error(`${source} contains an empty origin`);
  }
  if (candidate.includes('*')) {
    throw new Error(`${source} must contain exact origins; wildcards are not allowed`);
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(`${source} contains an invalid origin: ${candidate}`);
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${source} origin must use http or https: ${candidate}`);
  }
  if (
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.origin === 'null'
  ) {
    throw new Error(
      `${source} must contain origins without credentials, paths, queries, or hashes`,
    );
  }

  return url.origin;
}

function isLocalDevelopmentOrigin(origin: string): boolean {
  const hostname = new URL(origin).hostname;
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '0.0.0.0' ||
    hostname.endsWith('.localhost')
  );
}

export function resolveAuthTrustedOrigins(env: AuthOriginEnvironment): string[] {
  const environment = env.BETTER_AUTH_ENVIRONMENT?.trim() || 'production';
  if (environment !== 'production' && environment !== 'development') {
    throw new Error('BETTER_AUTH_ENVIRONMENT must be either "production" or "development"');
  }

  const explicitOriginValues =
    env.BETTER_AUTH_TRUSTED_ORIGINS?.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean) ?? [];
  if (environment === 'production' && explicitOriginValues.length === 0) {
    throw new Error(
      'BETTER_AUTH_TRUSTED_ORIGINS is required when BETTER_AUTH_ENVIRONMENT is production',
    );
  }

  const candidates = [
    ...(env.SITE_URL ? [{ value: env.SITE_URL, source: 'SITE_URL' }] : []),
    ...(env.APP_URL ? [{ value: env.APP_URL, source: 'APP_URL' }] : []),
    ...explicitOriginValues.map((value) => ({
      value,
      source: 'BETTER_AUTH_TRUSTED_ORIGINS',
    })),
    ...(environment === 'development'
      ? LOCAL_DEVELOPMENT_AUTH_ORIGINS.map((value) => ({
          value,
          source: 'development origin allowlist',
        }))
      : []),
  ];

  const origins = candidates.map(({ value, source }) => parseExactOrigin(value, source));
  for (const origin of origins) {
    if (!isLocalDevelopmentOrigin(origin)) continue;
    if (environment !== 'development') {
      throw new Error(`Local origin ${origin} is only allowed in development`);
    }
    if (!LOCAL_DEVELOPMENT_AUTH_ORIGIN_ALLOWLIST[origin]) {
      throw new Error(
        `Local development origin ${origin} is not in the exact development allowlist`,
      );
    }
  }

  return [...new Set(origins)];
}

export function resolveAuthBaseUrl(env: AuthBaseUrlEnvironment): string {
  const publicBaseUrl = env.BETTER_AUTH_BASE_URL?.trim();
  if (publicBaseUrl) return parseExactOrigin(publicBaseUrl, 'BETTER_AUTH_BASE_URL');
  return env.CONVEX_SITE_URL?.trim() ?? '';
}

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  const siteUrl = env.SITE_URL ?? '';
  const appUrl = env.APP_URL ?? '';
  if (!appUrl && siteUrl) {
    console.warn('APP_URL not set — crossDomain plugin falling back to SITE_URL');
  }
  const authBaseUrl = resolveAuthBaseUrl(env);
  const githubClientId = env.GITHUB_CLIENT_ID;
  const githubClientSecret = env.GITHUB_CLIENT_SECRET;
  const googleClientId = env.GOOGLE_CLIENT_ID;
  const googleClientSecret = env.GOOGLE_CLIENT_SECRET;

  return betterAuth({
    baseURL: authBaseUrl,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: resolveAuthTrustedOrigins(env),
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
  returns: v.union(authUserValidator, v.null()),
  handler: async (ctx) => {
    return (await authComponent.safeGetAuthUser(ctx)) ?? null;
  },
});
