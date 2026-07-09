# Desktop Release Runbook

Agendex Desktop ships as a signed and notarized macOS universal app via **GitHub Releases**. Windows builds are planned for a later release.

There are two workflows:

- `.github/workflows/desktop-build.yml`: CI on PRs and `main`. Runs checks/tests and produces **unsigned** macOS packages for validation.
- `.github/workflows/desktop-release.yml`: Release workflow on `desktop-v*.*.*` tag pushes or manual dispatch. Builds a signed/notarized macOS artifact and publishes it to GitHub Releases.

This mirrors the release model used in [streamer.share](https://github.com/Tyru5/screenstream.live), adapted for Agendex paths and GitHub Releases instead of a CDN bucket.

## Triggering a release

### Tag push

Desktop releases use a `desktop-v` prefix so they do not collide with CLI tags (`v*` from the npm publish workflow):

```bash
git tag desktop-v1.0.0
git push origin desktop-v1.0.0
```

### Manual release

1. Open **GitHub Actions**.
2. Select **Release Desktop**.
3. Run the workflow with a version such as `1.0.0` or `desktop-v1.0.0`.

Manual releases publish a GitHub release for the selected commit. Tag-triggered releases publish the pushed tag.

## Version handling

The committed desktop package version can stay at the development baseline (`0.0.0`). During CI, the workflow runs:

```bash
node scripts/prepare-desktop-release.mjs <version> --write
```

That updates `packages/desktop/package.json` on the ephemeral runner before packaging so installer names and the app bundle version match the release tag.

For local checks:

```bash
bun run release:desktop:prepare -- 1.0.0 --write
bun run desktop:build
bun run --cwd packages/desktop dist -- --mac --universal
```

Only commit the version change if you intentionally want the repository baseline updated; otherwise revert `packages/desktop/package.json` after the local packaging check.

## macOS-only local release

Publish a signed/notarized macOS release from a Mac:

```bash
bun run release:desktop:mac -- 1.0.0
```

The script removes stale desktop release output, temporarily aligns `packages/desktop/package.json` to the requested version, builds the desktop app, packages a universal macOS artifact, creates a GitHub release, and then restores the package file.

Options:

- `--dry-run` — print the command sequence without publishing
- `--skip-upload` — package only, no GitHub release
- `--skip-clean` — keep existing `packages/desktop/release/` contents
- `--keep-version` — leave `packages/desktop/package.json` at the release version

## Unsigned local packaging

For a quick unsigned smoke build on macOS:

```bash
bash scripts/build-test-desktop.sh
```

Artifacts land in `packages/desktop/release/`.

## Signing and notarization

See [`docs/code-signing.md`](./code-signing.md) for the required GitHub secrets and local setup.

The release workflow decodes `APPLE_API_KEY` from base64 on macOS and passes the resulting `.p8` file path to electron-builder. If signing secrets are absent, `electron-builder` may produce unsigned artifacts — useful for internal testing, but not for production distribution.

## Release assets

Expected macOS assets:

- `Agendex-<version>-universal.dmg`
- `Agendex-<version>-universal.zip`
- matching `.blockmap` files
- `latest-mac.yml` (auto-update metadata if you wire an updater later)

The marketing download page is `/download` (`packages/web` `DownloadPage`). It links to
GitHub Releases for assets and explains the macOS Keychain prompt first-run users see.
When you ship a new desktop version, bump `DESKTOP_VERSION` in
`packages/web/src/client/components/DownloadPage.tsx` so the direct `.dmg` / `.zip` links
stay current.

## Root commands

| Command                                    | Purpose                           |
| ------------------------------------------ | --------------------------------- |
| `bun run desktop:dev`                      | Dev shell with renderer HMR       |
| `bun run desktop:build`                    | Build EE client + Electron bundle |
| `bun run desktop:dist:mac`                 | Build + unsigned macOS package    |
| `bun run release:desktop:prepare -- 1.0.0` | Print release metadata            |
| `bun run release:desktop:mac -- 1.0.0`     | Full local macOS release          |
| `bash scripts/build-test-desktop.sh`       | Unsigned macOS smoke package      |
