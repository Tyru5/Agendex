# Code Signing and Notarization Guide

Agendex Desktop ships macOS and Windows Electron apps with `electron-builder`.

- **macOS signing and notarization are required.** Gatekeeper rejects unsigned builds on other Macs, so the release job fails fast when the secrets are missing.
- **Windows Authenticode signing is optional and currently not configured.** Without a certificate, electron-builder publishes an unsigned installer: SmartScreen shows "Windows protected your PC" and users continue through **More info → Run anyway**. Adding the secrets below turns signing on with no other change.

The signed production paths on GitHub are:

- **Release Desktop** (`.github/workflows/desktop-release.yml`) for native installers
- **Release Desktop UI** (`.github/workflows/ui-release.yml`) for signed remote UI channel manifests

Routine checks and unsigned release-readiness validation run locally with `bun run ci:local`.

Release publishing uses the built-in `GITHUB_TOKEN`; you do not need a separate GitHub PAT for uploading release assets.

## Secret Layout

| Secret                        | Used by                               | Value                                                     |
| ----------------------------- | ------------------------------------- | --------------------------------------------------------- |
| `CSC_LINK`                    | macOS release job                     | Base64 of the Apple Developer ID `.p12`                   |
| `CSC_KEY_PASSWORD`            | macOS release job                     | Password for the Apple Developer ID `.p12`                |
| `APPLE_API_KEY`               | macOS release job                     | Base64 of the App Store Connect `.p8` key                 |
| `APPLE_API_KEY_ID`            | macOS release job                     | App Store Connect API key ID                              |
| `APPLE_API_ISSUER`            | macOS release job                     | App Store Connect issuer ID                               |
| `APPLE_ID`                    | macOS release job (optional fallback) | Apple ID email                                            |
| `APPLE_APP_SPECIFIC_PASSWORD` | macOS release job (optional fallback) | App-specific password                                     |
| `APPLE_TEAM_ID`               | macOS release job (optional)          | Apple Developer team ID                                   |
| `WIN_CSC_LINK`                | Windows release job (optional)        | Base64 of the Authenticode `.pfx`/`.p12`                  |
| `WIN_CSC_KEY_PASSWORD`        | Windows release job (optional)        | Password for that certificate                             |
| `UI_BUNDLE_SIGNING_KEY`       | UI release workflow                   | Ed25519 private key PEM used to sign UI channel manifests |

Windows certificate secrets stay under their own `WIN_CSC_*` names and are mapped to `CSC_LINK` / `CSC_KEY_PASSWORD` only inside the Windows packaging step. Never point `CSC_LINK` at the Apple Developer ID `.p12` for Windows — the two are different certificate types issued by different authorities.

## macOS: Developer ID and Notarization

### Requirements

- Apple Developer Program membership
- Xcode installed on any machine doing local signing
- An Apple Developer ID Application certificate
- An App Store Connect API key for notarization

### 1. Create the Developer ID Application certificate

1. Open **Keychain Access**.
2. Select **Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority**.
3. Save the CSR file locally.
4. In the Apple Developer portal, create a **Developer ID Application** certificate.
5. Upload the CSR, download the `.cer`, and double-click it to install.
6. In Keychain Access, confirm the certificate appears under **My Certificates** (certificate + private key).
7. Export it as a `.p12` with a strong password.

### 2. Add macOS signing secrets

Encode the `.p12` without line breaks:

```bash
base64 -i /path/to/DeveloperID.p12 | tr -d '\n' | pbcopy
```

Set these GitHub repository secrets:

- `CSC_LINK` — base64 output from the Developer ID `.p12`
- `CSC_KEY_PASSWORD` — the `.p12` password

### 3. Create the notarization API key

In App Store Connect:

1. Go to **Users and Access → Integrations → App Store Connect API**.
2. Create an API key and download the `.p8` file.
3. Note the **Key ID** and **Issuer ID**.

Encode the `.p8` without line breaks:

```bash
base64 -i /path/to/AuthKey_XXXXXXXXXX.p8 | tr -d '\n' | pbcopy
```

Set these GitHub repository secrets:

- `APPLE_API_KEY` — base64 output from the `.p8`
- `APPLE_API_KEY_ID` — the key ID
- `APPLE_API_ISSUER` — the issuer ID

The release workflow decodes `APPLE_API_KEY` back to a temporary `.p8` file and passes that file path to electron-builder.

## Running the signed release workflow

After the required secrets are configured:

1. Open **GitHub Actions**.
2. Select **Release Desktop**.
3. Click **Run workflow**.
4. Use a version such as `1.0.0` or a prerelease such as `1.0.1-beta.1`.

Or push a tag:

```bash
git tag desktop-v1.0.0
git push origin desktop-v1.0.0
```

The release workflow checks for macOS signing secrets before packaging. Expected macOS artifacts:

- `.dmg`
- `.zip`
- `.blockmap`
- `latest-mac.yml`

Expected Windows artifacts:

- `Agendex-<version>-x64-Setup.exe`
- `Agendex-<version>-x64-Portable.exe`
- `.blockmap`
- `latest.yml`

## Local builds

### Local macOS signing

Install the Developer ID `.p12` into your login keychain and confirm a valid identity:

```bash
security find-identity -v -p codesigning
```

Then build and package:

```bash
bun run desktop:build
bun run --cwd packages/desktop dist -- --mac --universal
```

For local notarization, `APPLE_API_KEY` must be the **path** to the `.p8` file, not the base64 GitHub-secret value:

```bash
export APPLE_API_KEY=/path/to/AuthKey_XXXXXXXXXX.p8
export APPLE_API_KEY_ID=<key id>
export APPLE_API_ISSUER=<issuer id>
bun run release:desktop:mac -- 1.0.0 --skip-upload
```

### Unsigned local packaging

```bash
bash scripts/build-test-desktop.sh
```

## Verification

After mounting the DMG or copying the app to `/Applications`:

```bash
codesign --verify --deep --strict --verbose=2 "/Applications/Agendex.app"
codesign -dv --verbose=4 "/Applications/Agendex.app"
spctl -a -vv "/Applications/Agendex.app"
xcrun stapler validate "/Applications/Agendex.app"
```

`codesign` proves the app is signed. `spctl` and `stapler` prove notarization is accepted and stapled.

## Common pitfalls

- Exporting a certificate without its private key — it must appear under **My Certificates** in Keychain Access.
- Setting local `APPLE_API_KEY` to a base64 value — locally it must be a `.p8` file path.
- Assuming a successful `codesign` check means notarization passed — Gatekeeper acceptance requires notarization too.
- Using CLI release tags (`v1.2.3`) for desktop — desktop releases use `desktop-v1.2.3` to avoid colliding with npm CLI tags.

## Windows: shipping unsigned, and turning signing on later

### What unsigned means today

`Agendex-<version>-x64-Setup.exe` carries no Authenticode signature, so Windows cannot name a publisher. On first run SmartScreen shows "Windows protected your PC — Microsoft Defender SmartScreen prevented an unrecognized app from starting"; **More info → Run anyway** proceeds. `/download` documents this, the release notes repeat it, and the app itself shows a **Code signing: Not signed yet** row under **Settings → Updates**.

That in-app row is derived, not hardcoded. `resolveDesktopBuildInfo` (`packages/desktop/src/main/desktop-build-info.ts`) reads the packaged `app-update.yml` and looks for `publisherName`, which electron-builder writes only when a certificate was configured at package time. So the notice clears itself on the first signed release — there is no copy to remember to delete. It is only ever shown for packaged Windows builds; every other case resolves to "unknown" and renders nothing.

Auto-update is unaffected. electron-builder only writes `publisherName` into `app-update.yml` when a certificate is present, and electron-updater skips its Authenticode verification when that field is absent — so unsigned installs still update themselves in place.

The portable exe never self-updates regardless of signing; see the auto-update notes in [`docs/desktop-release.md`](./desktop-release.md).

### Turning signing on

No workflow change is needed — the Windows packaging step already branches on the secrets:

1. Buy an **OV or EV code-signing certificate** from a Microsoft-approved CA. EV certificates (hardware token or cloud HSM) clear SmartScreen reputation immediately; OV certificates build reputation over time and downloads may still be flagged at first.
2. Export it as a password-protected `.pfx`, then encode it without line breaks:

   ```bash
   base64 -i /path/to/codesign.pfx | tr -d '\n'
   ```

3. Set repository secrets `WIN_CSC_LINK` (the base64 output) and `WIN_CSC_KEY_PASSWORD` (the export password). Set **both** — the job fails deliberately on a partial pair rather than silently shipping unsigned.
4. Re-run **Release Desktop**. The step logs "Windows signing credentials found; packaging a signed installer," and the in-app "Not signed yet" row stops appearing for that build.

EV certificates held on a hardware token cannot be exported as a `.pfx` and do not work with `WIN_CSC_LINK`. Those need a cloud signing service (for example Azure Trusted Signing, which electron-builder supports through `win.azureSignOptions`) or a self-hosted runner with the token attached.

Once signed builds ship, keep them signed: `publisherName` lands in `app-update.yml`, and reverting to unsigned would fail electron-updater's signature check on already-installed clients.

### Empty-secret pitfall

Do not pass `CSC_LINK: ${{ secrets.WIN_CSC_LINK }}` directly through a job `env:` block. GitHub Actions injects an empty string for a missing secret, and electron-builder then treats `""` as a certificate path, resolves it against the project directory, and fails with `Env WIN_CSC_LINK is not correct, cannot resolve: ... not a file`. The workflow instead exports the variables inside the step only when both are non-empty, and unsets them otherwise.
