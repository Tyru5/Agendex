// Build identity surfaced to the renderer so the app can tell users, in the app
// itself, when they are running a build that is not code-signed.
//
// The signal is electron-builder's own: it writes `publisherName` into the
// packaged `app-update.yml` only when a Windows code-signing certificate was
// configured at package time (PublishManager reads it off the certificate
// subject). electron-updater uses the same field to decide whether to verify an
// installer's Authenticode signature.
//
// Deriving the notice from that file instead of hardcoding "Windows is
// unsigned" keeps it self-correcting: the first release packaged with
// WIN_CSC_LINK / WIN_CSC_KEY_PASSWORD set stops showing the notice on its own,
// with no code change to remember.

export interface DesktopBuildInfo {
  /** process.platform of the running app ('win32', 'darwin', ...). */
  platform: string;
  /**
   * Whether this build carries a code-signing certificate.
   * `null` when the answer is unknown: dev/unpackaged builds, and platforms
   * where `app-update.yml` carries no signing evidence either way (macOS
   * signing is enforced by the release workflow, not recorded in that file).
   */
  codeSigned: boolean | null;
}

export interface ResolveDesktopBuildInfoDeps {
  platform: string;
  isPackaged: boolean;
  /** Contents of `<resources>/app-update.yml`, or null when unreadable. */
  readAppUpdateConfig: () => string | null;
}

/**
 * True when `app-update.yml` declares a top-level `publisherName`, which
 * electron-builder emits only for signed Windows builds. The key may hold an
 * inline value or a YAML list, so only its presence is checked.
 */
export function hasUpdatePublisherName(appUpdateYml: string): boolean {
  return /^publisherName:/m.test(appUpdateYml);
}

export function resolveDesktopBuildInfo(deps: ResolveDesktopBuildInfoDeps): DesktopBuildInfo {
  const { platform, isPackaged, readAppUpdateConfig } = deps;

  if (!isPackaged || platform !== 'win32') {
    return { platform, codeSigned: null };
  }

  const config = readAppUpdateConfig();
  if (config === null) {
    return { platform, codeSigned: null };
  }

  return { platform, codeSigned: hasUpdatePublisherName(config) };
}
