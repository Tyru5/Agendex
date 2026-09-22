import type { ReactNode } from 'react';
import { GitHubIcon } from './OAuthIcons.tsx';
import {
  Body,
  NumberedList,
  SubpageHeader,
  SubpageSection,
  SubpageShell,
} from './landing/SubpageShell.tsx';

export interface DownloadPageProps {
  /** Called when the user activates the back link in the header. */
  onBack?: () => void;
  /** Path the brand mark + back affordance link to. Defaults to "/". */
  homeHref?: string;
}

/**
 * Latest stable desktop release advertised on /download.
 * Update with `scripts/prepare-desktop-release.mjs --write` before tagging a
 * stable release (see `docs/desktop-release.md`). Asset names follow
 * `Agendex-<version>-universal.{dmg,zip}` and `Agendex-<version>-x64-{Setup,Portable}.exe`
 * from electron-builder.
 */
const DESKTOP_VERSION = '1.7.27';
const DESKTOP_TAG = `desktop-v${DESKTOP_VERSION}`;
const GITHUB_RELEASES_URL = 'https://github.com/Tyru5/Agendex/releases';
const GITHUB_RELEASE_URL = `${GITHUB_RELEASES_URL}/tag/${DESKTOP_TAG}`;

function releaseAssetUrl(filename: string): string {
  return `https://github.com/Tyru5/Agendex/releases/download/${DESKTOP_TAG}/${filename}`;
}

const MAC_DMG_URL = releaseAssetUrl(`Agendex-${DESKTOP_VERSION}-universal.dmg`);
const MAC_ZIP_URL = releaseAssetUrl(`Agendex-${DESKTOP_VERSION}-universal.zip`);
const WIN_SETUP_URL = releaseAssetUrl(`Agendex-${DESKTOP_VERSION}-x64-Setup.exe`);
const WIN_PORTABLE_URL = releaseAssetUrl(`Agendex-${DESKTOP_VERSION}-x64-Portable.exe`);

const KEYCHAIN_PROMPT_IMAGE = '/desktop-keychain-prompt.png';

function DownloadButton({
  href,
  primary,
  children,
}: {
  href: string;
  primary?: boolean;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className={
        primary
          ? 'landing-action landing-action--primary inline-flex min-h-[44px] items-center justify-center gap-2 px-5 no-underline'
          : 'landing-action landing-action--secondary inline-flex min-h-[44px] items-center justify-center gap-2 px-5 no-underline'
      }
    >
      {children}
    </a>
  );
}

function AppleIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  );
}

function WindowsIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3 5.6l7.5-1.03v7.24H3V5.6zm0 12.8l7.5 1.03v-7.15H3v6.12zM11.33 19.55L21 20.88V12.7h-9.67v6.85zm0-15.1v7.35H21V3.12l-9.67 1.33z" />
    </svg>
  );
}

/**
 * Marketing + install page for Agendex Desktop. Includes plain-language
 * explanations of the two OS prompts first-run users hit: the macOS Keychain
 * password request, and the Windows SmartScreen warning on the unsigned build.
 */
export function DownloadPage({ onBack, homeHref = '/' }: DownloadPageProps) {
  return (
    <SubpageShell pageClass="download-page" onBack={onBack} homeHref={homeHref}>
      <SubpageHeader
        title="Download Agendex Desktop"
        lede="A native desktop shell for Cloud Pro: local plan index, system-browser sign-in, and encrypted session storage on your machine. Available for macOS as a universal build (Apple Silicon + Intel) and for Windows on x64."
        meta={
          <>
            Latest release{' '}
            <span className="font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace] text-[var(--landing-text)]">
              v{DESKTOP_VERSION}
            </span>
          </>
        }
      />

      <SubpageSection id="get-the-app" title="Get the app">
        <div className="grid gap-4 rounded-[10px] border border-[var(--landing-border)] bg-[var(--landing-surface)] p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 max-w-[48ch]">
              <h3 className="m-0 flex items-center gap-2 text-[16px] font-bold text-[var(--landing-text)]">
                <AppleIcon size={18} />
                macOS
              </h3>
              <p className="mt-2 mb-0 text-[13.5px] leading-[1.65] text-[var(--landing-muted)]">
                Universal build for Apple Silicon and Intel. Prefer the DMG for a standard install;
                use the ZIP if you want a portable app bundle.
              </p>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <DownloadButton href={MAC_DMG_URL} primary>
                Download .dmg
              </DownloadButton>
              <DownloadButton href={MAC_ZIP_URL}>Download .zip</DownloadButton>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--landing-border-subtle)] pt-4 text-[12.5px] text-[var(--landing-muted)]">
            <span>Requires macOS 12+</span>
            <span aria-hidden="true" className="max-sm:hidden">
              ·
            </span>
            <a
              href={GITHUB_RELEASE_URL}
              className="inline-flex items-center gap-1.5 font-semibold text-[var(--landing-text)] no-underline hover:text-[var(--landing-accent)]"
            >
              <GitHubIcon size={13} />
              Release notes on GitHub
            </a>
            <span aria-hidden="true" className="max-sm:hidden">
              ·
            </span>
            <a
              href={GITHUB_RELEASES_URL}
              className="font-semibold text-[var(--landing-text)] no-underline hover:text-[var(--landing-accent)]"
            >
              All releases
            </a>
          </div>
        </div>

        <div className="grid gap-4 rounded-[10px] border border-[var(--landing-border)] bg-[var(--landing-surface)] p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 max-w-[48ch]">
              <h3 className="m-0 flex items-center gap-2 text-[16px] font-bold text-[var(--landing-text)]">
                <WindowsIcon size={16} />
                Windows
              </h3>
              <p className="mt-2 mb-0 text-[13.5px] leading-[1.65] text-[var(--landing-muted)]">
                64-bit build for Windows 10 and later. The installer adds shortcuts and keeps itself
                up to date; the portable build runs from a single file and is updated by
                re-downloading.
              </p>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <DownloadButton href={WIN_SETUP_URL} primary>
                Download installer
              </DownloadButton>
              <DownloadButton href={WIN_PORTABLE_URL}>Download portable</DownloadButton>
            </div>
          </div>
          <div className="rounded-[8px] border border-[var(--landing-border)] bg-[color-mix(in_oklch,var(--landing-bg)_60%,transparent)] px-4 py-3 text-[13px] leading-[1.65] text-[var(--landing-muted)]">
            <strong className="text-[var(--landing-text)]">Not code-signed yet</strong> — a signing
            certificate is planned, and until it lands Windows warns that the publisher is unknown.
            Choose <strong className="text-[var(--landing-text)]">More info</strong>, then{' '}
            <strong className="text-[var(--landing-text)]">Run anyway</strong>;{' '}
            <a
              href="#smartscreen-warning"
              className="font-semibold text-[var(--landing-text)] no-underline hover:text-[var(--landing-accent)]"
            >
              here is what that means
            </a>
            .
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--landing-border-subtle)] pt-4 text-[12.5px] text-[var(--landing-muted)]">
            <span>Requires Windows 10+ (x64)</span>
            <span aria-hidden="true" className="max-sm:hidden">
              ·
            </span>
            <a
              href={GITHUB_RELEASE_URL}
              className="inline-flex items-center gap-1.5 font-semibold text-[var(--landing-text)] no-underline hover:text-[var(--landing-accent)]"
            >
              <GitHubIcon size={13} />
              Release notes on GitHub
            </a>
          </div>
        </div>
      </SubpageSection>

      <SubpageSection id="after-install" title="After you install">
        <NumberedList
          items={[
            'Open Agendex from Applications on macOS, or the Start menu on Windows.',
            'Sign in with GitHub or Google — the flow opens in your system browser, not inside the app.',
            'If macOS asks for your login keychain password, or Windows warns about an unknown publisher, that is expected — see below.',
          ]}
        />
      </SubpageSection>

      <SubpageSection id="smartscreen-warning" title="Why Windows warns about this download">
        <Body>
          The first time you run the Windows installer, Microsoft Defender SmartScreen shows a blue
          dialog:{' '}
          <em>
            “Windows protected your PC — Microsoft Defender SmartScreen prevented an unrecognized
            app from starting.”
          </em>{' '}
          Click <strong className="text-[var(--landing-text)]">More info</strong>, then{' '}
          <strong className="text-[var(--landing-text)]">Run anyway</strong>.
        </Body>

        <div className="grid max-w-[68ch] gap-4">
          <div>
            <h3 className="m-0 text-[15px] font-bold text-[var(--landing-text)]">
              What the warning actually means
            </h3>
            <Body>
              The Windows build is not Authenticode code-signed. That needs a paid certificate from
              a Microsoft-approved authority, billed yearly — it is on the roadmap, not in this
              release. Without one Windows cannot name a publisher, so it calls the app
              unrecognized. That is a statement about the certificate, not about what the app does:
              the macOS build is fully signed and notarized, and both come from the same public
              source and the same GitHub Actions workflow.
            </Body>
          </div>

          <div>
            <h3 className="m-0 text-[15px] font-bold text-[var(--landing-text)]">
              How to check what you downloaded
            </h3>
            <Body>
              Download only from this page or the{' '}
              <a
                href={GITHUB_RELEASE_URL}
                className="font-semibold text-[var(--landing-text)] no-underline hover:text-[var(--landing-accent)]"
              >
                GitHub release
              </a>{' '}
              — both point at the same files, published by the release workflow. Every release also
              ships a <code className="text-[var(--landing-text)]">latest.yml</code> holding the
              installer&apos;s SHA-512. To confirm your copy matches it, run this in PowerShell and
              compare the output to the <code className="text-[var(--landing-text)]">sha512:</code>{' '}
              line in that file:
            </Body>
            <pre className="mt-3 mb-0 overflow-x-auto rounded-[8px] border border-[var(--landing-border)] bg-[color-mix(in_oklch,var(--landing-bg)_78%,transparent)] px-4 py-3 text-[12.5px] leading-[1.6] text-[var(--landing-muted)]">
              <code className="font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace]">
                {`$bytes = [IO.File]::ReadAllBytes("$PWD\\Agendex-${DESKTOP_VERSION}-x64-Setup.exe")\n[Convert]::ToBase64String([Security.Cryptography.SHA512]::Create().ComputeHash($bytes))`}
              </code>
            </pre>
          </div>

          <div className="rounded-[8px] border border-[var(--landing-border)] bg-[var(--landing-surface)] px-4 py-3 text-[13px] leading-[1.65] text-[var(--landing-muted)]">
            Updates use the same feed as macOS: the installer checks for new releases in the
            background and applies them in place. The portable build cannot update itself — download
            the newer file from this page when you want to update.
          </div>
        </div>
      </SubpageSection>

      <SubpageSection id="keychain-prompt" title="Why macOS asks for your keychain password">
        <Body>
          On first launch — and again when Agendex needs to read a saved cloud session — macOS may
          show a dialog like this:
        </Body>

        <figure className="m-0 max-w-[560px] overflow-hidden rounded-[12px] border border-[var(--landing-border)] bg-[var(--landing-surface)] p-3 sm:p-4">
          <img
            src={KEYCHAIN_PROMPT_IMAGE}
            alt="macOS dialog: “Agendex wants to use your confidential information stored in Safe Storage in your keychain. To allow this, enter the login keychain password.” with Always Allow, Deny, and Allow buttons."
            width={996}
            height={460}
            className="block h-auto w-full rounded-[8px]"
            loading="lazy"
            decoding="async"
          />
          <figcaption className="mt-3 text-[12px] leading-[1.55] text-[var(--landing-faint)]">
            Example Keychain Access prompt on macOS when Agendex encrypts or decrypts your cloud
            session.
          </figcaption>
        </figure>

        <div className="grid max-w-[68ch] gap-4">
          <div>
            <h3 className="m-0 text-[15px] font-bold text-[var(--landing-text)]">
              What Agendex is storing
            </h3>
            <Body>
              After you sign in, Agendex keeps a session token so you stay signed in between
              launches. That token is a long-lived credential for your Cloud Pro account — not your
              GitHub or Google password, and not other passwords in your keychain.
            </Body>
          </div>

          <div>
            <h3 className="m-0 text-[15px] font-bold text-[var(--landing-text)]">
              Why the Keychain is involved
            </h3>
            <Body>
              The token is encrypted with the operating system&apos;s secure storage (Electron{' '}
              <code className="font-['SF_Mono','JetBrains_Mono',ui-monospace,monospace] text-[12.5px] text-[var(--landing-text)]">
                safeStorage
              </code>
              ). On macOS that uses the login keychain. The OS is asking you to unlock{' '}
              <em>Agendex&apos;s own</em> encrypted item so the app can restore your session —
              nothing else in Keychain Access is shared with Agendex.
            </Body>
          </div>

          <div>
            <h3 className="m-0 text-[15px] font-bold text-[var(--landing-text)]">What to click</h3>
            <ul className="m-0 grid max-w-[68ch] list-none gap-2 p-0 text-[13.5px] leading-[1.65] text-[var(--landing-muted)]">
              <li>
                <strong className="text-[var(--landing-text)]">Allow</strong> — unlocks the item for
                this launch.
              </li>
              <li>
                <strong className="text-[var(--landing-text)]">Always Allow</strong> — remembers the
                choice for Agendex so you are not prompted every time (recommended if you trust this
                install).
              </li>
              <li>
                <strong className="text-[var(--landing-text)]">Deny</strong> — Agendex cannot read a
                saved session and will show the sign-in screen again.
              </li>
            </ul>
          </div>

          <div className="rounded-[8px] border border-[var(--landing-border)] bg-[var(--landing-surface)] px-4 py-3 text-[13px] leading-[1.65] text-[var(--landing-muted)]">
            Agendex never stores your cloud session token in plaintext on disk. If secure storage is
            unavailable, it refuses to save the session rather than writing an unprotected
            credential.
          </div>
        </div>
      </SubpageSection>

      <SubpageSection id="also-available" title="Prefer the CLI or browser?">
        <Body>
          You do not need the desktop app to use Agendex. The CLI and web dashboard remain fully
          supported.
        </Body>
        <div className="flex flex-wrap gap-2.5">
          <DownloadButton href="/docs#installation">CLI install docs</DownloadButton>
          <DownloadButton href="/docs">Full documentation</DownloadButton>
          <DownloadButton href="/changelog">Changelog</DownloadButton>
          <DownloadButton href="/tools">Stack</DownloadButton>
        </div>
      </SubpageSection>
    </SubpageShell>
  );
}
