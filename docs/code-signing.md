# Code Signing and Notarization Guide

Agendex Desktop ships a macOS Electron app with `electron-builder`. Signing and notarization are required for Gatekeeper acceptance on other Macs.

The signed production path is the **Release Desktop** GitHub Actions workflow (`.github/workflows/desktop-release.yml`). The separate **Build Desktop (CI)** workflow packages unsigned artifacts for validation and does not receive signing secrets.

Release publishing uses the built-in `GITHUB_TOKEN`; you do not need a separate GitHub PAT for uploading release assets.

Windows Authenticode signing is documented here for a future release but is **not** part of the current macOS-only workflow.

## Secret Layout

| Secret                        | Used by                               | Value                                      |
| ----------------------------- | ------------------------------------- | ------------------------------------------ |
| `CSC_LINK`                    | macOS release job                     | Base64 of the Apple Developer ID `.p12`    |
| `CSC_KEY_PASSWORD`            | macOS release job                     | Password for the Apple Developer ID `.p12` |
| `APPLE_API_KEY`               | macOS release job                     | Base64 of the App Store Connect `.p8` key  |
| `APPLE_API_KEY_ID`            | macOS release job                     | App Store Connect API key ID               |
| `APPLE_API_ISSUER`            | macOS release job                     | App Store Connect issuer ID                |
| `APPLE_ID`                    | macOS release job (optional fallback) | Apple ID email                             |
| `APPLE_APP_SPECIFIC_PASSWORD` | macOS release job (optional fallback) | App-specific password                      |
| `APPLE_TEAM_ID`               | macOS release job (optional)          | Apple Developer team ID                    |

When Windows signing is added later, keep Windows certificate secrets separate (for example `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`) and map them to `CSC_LINK` / `CSC_KEY_PASSWORD` only inside the Windows packaging job.

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

The release workflow checks for signing secrets before packaging. Expected macOS artifacts:

- `.dmg`
- `.zip`
- `.blockmap`
- `latest-mac.yml`

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

## Future: Windows signing

When Windows support ships, add a Windows release job with separate `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` secrets. Do not reuse the Apple Developer ID `.p12` for Windows Authenticode signing.
