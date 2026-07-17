#!/usr/bin/env node

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DESKTOP_VERSION_LINE = /^(\s*const DESKTOP_VERSION = ')([^']+)(';?\s*)$/m;

/**
 * Replace the marketing download page's DESKTOP_VERSION constant.
 * Asset URLs and the "Latest release" label both derive from that constant.
 */
export function updateDownloadPageVersion(source, nextVersion) {
  if (!DESKTOP_VERSION_LINE.test(source)) {
    throw new Error(
      "Could not find DESKTOP_VERSION constant. Expected a line like: const DESKTOP_VERSION = '1.2.3';",
    );
  }

  // Reset lastIndex after the existence check (global-less, but keep it explicit).
  DESKTOP_VERSION_LINE.lastIndex = 0;
  return source.replace(DESKTOP_VERSION_LINE, `$1${nextVersion}$3`);
}

function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((arg) => arg.startsWith('--')));
  const rawVersion =
    args.find((arg) => !arg.startsWith('--')) ??
    process.env.RELEASE_VERSION ??
    process.env.GITHUB_REF_NAME ??
    '';

  const normalizedVersion = rawVersion
    .trim()
    .replace(/^refs\/tags\//, '')
    .replace(/^desktop-v/, '')
    .replace(/^v/, '');
  const semverPattern = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

  if (!semverPattern.test(normalizedVersion)) {
    console.error(
      `Invalid desktop release version '${rawVersion}'. Expected a semantic version like 1.2.3, v1.2.3, or desktop-v1.2.3.`,
    );
    process.exit(1);
  }

  const version = normalizedVersion.replace(/\+.*$/, '');
  const tag = `desktop-v${version}`;
  const releaseName = `Agendex Desktop v${version}`;
  const isPrerelease = version.includes('-');
  const makeLatest = !isPrerelease;

  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const desktopPackagePath = resolve(repoRoot, 'packages/desktop/package.json');
  const downloadPagePath = resolve(repoRoot, 'packages/web/src/client/components/DownloadPage.tsx');

  let downloadPageUpdated = false;

  if (flags.has('--write')) {
    const packageJson = JSON.parse(readFileSync(desktopPackagePath, 'utf8'));
    if (packageJson.version !== version) {
      packageJson.version = version;
      writeFileSync(desktopPackagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
    }

    // Only stable releases should become the public "latest" download links.
    // Prereleases keep packaging version alignment without advertising on /download.
    if (makeLatest) {
      const current = readFileSync(downloadPagePath, 'utf8');
      const next = updateDownloadPageVersion(current, version);
      if (next !== current) {
        writeFileSync(downloadPagePath, next);
        downloadPageUpdated = true;
      }
    }
  }

  const outputs = {
    version,
    tag,
    release_name: releaseName,
    is_prerelease: String(isPrerelease),
    make_latest: String(makeLatest),
    download_page_updated: String(downloadPageUpdated),
  };

  if (flags.has('--github-output')) {
    const githubOutput = process.env.GITHUB_OUTPUT;
    if (!githubOutput) {
      console.error('--github-output requires the GITHUB_OUTPUT environment variable.');
      process.exit(1);
    }

    appendFileSync(
      githubOutput,
      Object.entries(outputs)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(''),
    );
  }

  for (const [key, value] of Object.entries(outputs)) {
    console.log(`${key}=${value}`);
  }
}

const isDirectRun =
  process.argv[1] !== undefined &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (isDirectRun) {
  main();
}
