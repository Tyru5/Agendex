export type AuthProvider = 'github' | 'google';

const DEFAULT_AUTH_PROVIDERS: readonly AuthProvider[] = ['github', 'google'];

function configuredAuthProviders(): readonly AuthProvider[] {
  const configured = (import.meta.env.VITE_AUTH_PROVIDERS as string | undefined)
    ?.split(',')
    .map((provider) => provider.trim())
    .filter((provider): provider is AuthProvider => provider === 'github' || provider === 'google');

  return configured?.length ? [...new Set(configured)] : DEFAULT_AUTH_PROVIDERS;
}

export const AUTH_PROVIDERS = configuredAuthProviders();
