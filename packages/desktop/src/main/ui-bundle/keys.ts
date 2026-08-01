// Trust anchor for remote UI bundles.
//
// Downloaded bundles execute in a window that holds the cloud session token and
// the privileged `agendexDesktop` bridge, so TLS alone is not enough: anyone who
// can write to the release assets could otherwise run code inside the app. Every
// manifest carries a detached Ed25519 signature made by CI, and the shell
// refuses to install anything that does not verify against this key.
//
// To provision (once):
//   openssl genpkey -algorithm ed25519 -out ui-signing-key.pem
//   openssl pkey -in ui-signing-key.pem -pubout
// Paste the public block below; store the private key as the
// UI_BUNDLE_SIGNING_KEY repo secret and delete your local copy.

/**
 * Empty until the key pair is provisioned. Verification fails closed on an
 * empty key, so an unprovisioned build simply never takes a remote bundle and
 * keeps serving the UI it shipped with — it does not fall back to trusting the
 * feed.
 */
const BAKED_PUBLIC_KEY_PEM = '';

/**
 * Test override. Points a locally built shell at a throwaway key so the
 * download/verify/activate path can be exercised end to end without the
 * production secret. Accepts a PEM block or its base64 form (easier to pass
 * through a shell without mangling newlines).
 */
function readOverride(env: Record<string, string | undefined>): string | null {
  const raw = env.AGENDEX_UI_PUBLIC_KEY;
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  if (raw.includes('-----BEGIN')) return raw.replace(/\\n/g, '\n');
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    return decoded.includes('-----BEGIN') ? decoded : null;
  } catch {
    return null;
  }
}

export function getUiBundlePublicKey(
  env: Record<string, string | undefined> = process.env,
): string {
  return readOverride(env) ?? BAKED_PUBLIC_KEY_PEM;
}

export function hasUiBundlePublicKey(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return getUiBundlePublicKey(env).trim() !== '';
}
