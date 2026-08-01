// Feed location and opt-outs for remote UI bundles.
//
// Mirrors the AGENDEX_SITE_URL override pattern in cloud-auth.ts: a baked
// default with an env escape hatch, so a local static server can stand in for
// the real feed during testing without a rebuild.

/**
 * Assets live on a fixed rolling tag rather than a per-release one, so the URL
 * is stable and each publish clobbers the previous assets in place.
 */
const DEFAULT_FEED_URL =
  'https://github.com/Tyru5/Agendex/releases/download/desktop-ui-channel/ui-manifest.json';

export function getUiFeedUrl(env: Record<string, string | undefined> = process.env): string {
  const override = env.AGENDEX_UI_FEED_URL;
  return typeof override === 'string' && override.trim() !== '' ? override : DEFAULT_FEED_URL;
}

/** The detached signature always sits next to the manifest. */
export function getUiSignatureUrl(manifestUrl: string): string {
  return `${manifestUrl}.sig`;
}

export function isUiUpdateDisabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.AGENDEX_UI_UPDATE_DISABLED === 'true';
}

/** Refuse absurd downloads before spending time hashing them. */
export const MAX_BUNDLE_BYTES = 128 * 1024 * 1024;
