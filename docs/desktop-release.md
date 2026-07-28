# Desktop Release Runbook

Agendex Desktop ships via **GitHub Releases** for two platforms:

- **macOS** — universal (Apple Silicon + Intel), signed with a Developer ID certificate and notarized by Apple.
- **Windows** — x64 NSIS installer plus a portable exe. **Not code-signed**: SmartScreen warns on first run until a certificate is purchased.

There are two workflows:

- `.github/workflows/desktop-build.yml`: CI on PRs and `main`. Runs checks/tests and produces **unsigned** macOS and Windows packages for validation.
- `.github/workflows/desktop-release.yml`: Release workflow on `desktop-v*.*.*` tag pushes or manual dispatch. Builds each selected platform and publishes the artifacts to a GitHub Release.

This mirrors the release model used in [streamer.share](https://github.com/Tyru5/screenstream.live), adapted for Agendex paths and GitHub Releases instead of a CDN bucket.

## Workflow shape

1. **Preflight** resolves release metadata and target platforms, verifies the download page version for stable releases, and runs checks + desktop tests.
2. **Build macOS (signed)** packages, notarizes, and staples the universal artifacts, then uploads them as a workflow artifact.
3. **Build Windows x64** re-runs the daemon/PID suites on real Windows, packages the installer + portable exe, verifies `latest.yml` exists, smoke-tests the packaged Electron daemon, then uploads the artifacts.
4. **Publish GitHub release** downloads whatever the selected platforms produced and attaches everything to the `desktop-v<version>` release.

Publish runs only when every **selected** platform succeeded. Skipped platforms are fine; a failed selected build blocks publishing so a release never ships half its artifacts.

Single-platform runs attach to the existing release rather than replacing it, so Windows artifacts can join a tag that already shipped macOS. The release notes are composed from the assets the release ends up holding, not just the ones this run built.

## Triggering a release

### Tag push (all platforms)

Desktop releases use a `desktop-v` prefix so they do not collide with CLI tags (`v*` from the npm publish workflow):

```bash
node scripts/prepare-desktop-release.mjs 1.0.0 --write
git checkout -- packages/desktop/package.json
git add packages/web/src/client/components/DownloadPage.tsx
git commit -m "chore(web): bump desktop download version to 1.0.0"
git tag desktop-v1.0.0
git push origin desktop-v1.0.0
```

For stable releases, land the download-page commit on `main` before pushing the tag.
Release preflight verifies that `/download` already targets the requested version,
avoiding a workflow push that would violate `main` branch protection (PR-only).
Prerelease tags (`desktop-v1.0.0-beta.1`, etc.) leave `/download` unchanged.

Tag pushes always build and publish **both** platforms.

### Manual release (all or single platform)

Run **Release Desktop** in GitHub Actions with:

| Input      | Values                        | Notes                      |
| ---------- | ----------------------------- | -------------------------- |
| `version`  | `1.0.0` or `desktop-v1.0.0`   | Required                   |
| `platform` | `all` (default), `mac`, `win` | Which platform jobs to run |

CLI examples:

```bash
# Both platforms
gh workflow run "Release Desktop" -f version=1.0.0 -f platform=all

# Windows only — e.g. add Windows artifacts to a tag that already shipped macOS,
# without paying for another notarization round trip
gh workflow run "Release Desktop" -f version=1.0.0 -f platform=win

# macOS only
gh workflow run "Release Desktop" -f version=1.0.0 -f platform=mac
```

Manual releases build the commit the workflow is dispatched on. Pass `--ref desktop-v1.0.0` to build the tagged commit instead of the branch head.

## Version handling

The committed desktop package version can stay at the development baseline (`0.0.0`). During CI, each build job runs:

```bash
node scripts/prepare-desktop-release.mjs <version> --write
```

That updates `packages/desktop/package.json` on the ephemeral runner before packaging so installer names, update metadata, and the app bundle version match the release tag.

For local checks:

```bash
bun run release:desktop:prepare -- 1.0.0 --write
bun run desktop:build
bun run --cwd packages/desktop dist -- --mac --universal   # or --win --x64
```

Only commit the version change if you intentionally want the repository baseline updated; otherwise revert `packages/desktop/package.json` after the local packaging check.

## Local releases

### macOS-only

Must run on macOS, with signing/notarization credentials:

```bash
bun run release:desktop:mac -- 1.0.0
```

### Windows-only

Must run on Windows. Signing is optional:

```bash
bun run release:desktop:win -- 1.0.0
```

Both scripts:

1. Remove stale `packages/desktop/release` output (unless `--skip-clean`)
2. Temporarily align `packages/desktop/package.json` to the release version
3. Build and package the platform artifact
4. Attach the assets to the `desktop-v<version>` release, creating it if needed (unless `--skip-upload`)
5. Restore `packages/desktop/package.json` (unless `--keep-version`)

Shared flags:

| Flag             | Effect                                                       |
| ---------------- | ------------------------------------------------------------ |
| `--dry-run`      | Print the command sequence without running it                |
| `--skip-clean`   | Keep existing `packages/desktop/release/` contents           |
| `--skip-upload`  | Package only, no GitHub release                              |
| `--keep-version` | Leave the release version in `packages/desktop/package.json` |
| `--help`         | Show usage                                                   |

From Linux/macOS, use GitHub Actions for Windows (`platform=win`) rather than the local Windows script.

## Unsigned local packaging

For a quick unsigned smoke build on macOS:

```bash
bash scripts/build-test-desktop.sh
```

Artifacts land in `packages/desktop/release/`.

## Signing and notarization

See [`docs/code-signing.md`](./code-signing.md) for the required GitHub secrets and local setup.

- **macOS** packaging **requires** signing/notarization secrets; the release job fails fast when they are missing.
- **Windows** signing is optional. With `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` set, electron-builder Authenticode-signs the build; without them it publishes an unsigned installer, logs a workflow warning, and the download page tells users how to get past SmartScreen.

## Release assets

Expected macOS assets:

- `Agendex-<version>-universal.dmg`
- `Agendex-<version>-universal.zip`
- matching `.blockmap` files
- `latest-mac.yml` (auto-update feed)

Expected Windows assets:

- `Agendex-<version>-x64-Setup.exe` (NSIS installer)
- `Agendex-<version>-x64-Portable.exe`
- `Agendex-<version>-x64-Setup.exe.blockmap`
- `latest.yml` (auto-update feed)

## Auto-update

`packages/desktop/electron-builder.yml` points electron-updater's generic provider at
`https://github.com/Tyru5/Agendex/releases/latest/download`, so installed clients read
`latest-mac.yml` / `latest.yml` from whichever release is marked **Latest**. Two consequences:

- A stable release must be published as latest for updates to flow. Prereleases are not advertised.
- A platform is only self-updating once its feed file lands in the latest release. Shipping macOS
  alone leaves Windows clients pinned until a release carries `latest.yml`.

Unsigned Windows builds surface that fact in **Settings → Updates** as a "Code signing: Not signed
yet" row, derived from the packaged `app-update.yml` so it clears itself once signed builds ship
(see [`docs/code-signing.md`](./code-signing.md)).

Unsigned Windows builds still auto-update: electron-builder omits `publisherName` from
`app-update.yml` when there is no certificate, and electron-updater skips its Authenticode check
when that field is absent. Once Windows signing is added, keep it on — going back to unsigned
after shipping signed builds would fail that check on existing installs.

The **portable** exe cannot self-update. electron-updater has no in-place path for it and would
run the NSIS installer instead, leaving a second installed copy alongside a stale portable file, so
`createDesktopUpdater` disables itself when `PORTABLE_EXECUTABLE_FILE` is set and the app reports
"Updates unavailable". Portable users re-download from `/download`.

## Download page

The marketing download page is `/download` (`packages/web` `DownloadPage`). It links to
GitHub Release assets for both platforms and explains the two first-run OS prompts: the macOS
Keychain password request and the Windows SmartScreen warning.

`scripts/prepare-desktop-release.mjs --write` rewrites `DESKTOP_VERSION` in
`packages/web/src/client/components/DownloadPage.tsx` for **stable** releases (not
prereleases); every asset URL on the page derives from that constant. Commit that
change before creating the release tag; release preflight rejects a stable release
whose download page is stale. Local `bun run release:desktop:mac` / `:win` keep the
same download-page update on disk (commit it with your next web deploy).

## Root commands

| Command                                    | Purpose                           |
| ------------------------------------------ | --------------------------------- |
| `bun run desktop:dev`                      | Dev shell with renderer HMR       |
| `bun run desktop:build`                    | Build EE client + Electron bundle |
| `bun run desktop:dist:mac`                 | Build + unsigned macOS package    |
| `bun run desktop:dist:win`                 | Build + unsigned Windows package  |
| `bun run release:desktop:prepare -- 1.0.0` | Print release metadata            |
| `bun run release:desktop:mac -- 1.0.0`     | Full local macOS release          |
| `bun run release:desktop:win -- 1.0.0`     | Full local Windows release        |
| `bash scripts/build-test-desktop.sh`       | Unsigned macOS smoke package      |
