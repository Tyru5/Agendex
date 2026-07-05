#!/usr/bin/env node

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

if (flags.has('--write')) {
  const packageJson = JSON.parse(readFileSync(desktopPackagePath, 'utf8'));
  if (packageJson.version !== version) {
    packageJson.version = version;
    writeFileSync(desktopPackagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  }
}

const outputs = {
  version,
  tag,
  release_name: releaseName,
  is_prerelease: String(isPrerelease),
  make_latest: String(makeLatest),
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
