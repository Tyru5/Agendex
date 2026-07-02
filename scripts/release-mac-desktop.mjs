#!/usr/bin/env node

import { access, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const desktopPackagePath = resolve(repoRoot, 'packages/desktop/package.json');
const desktopReleaseDir = resolve(repoRoot, 'packages/desktop/release');

const knownFlags = new Set([
  '--dry-run',
  '--help',
  '--keep-version',
  '--skip-clean',
  '--skip-upload',
]);
const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith('--')));
const version = args.find((arg) => !arg.startsWith('--')) ?? process.env.RELEASE_VERSION ?? '';

function printUsage() {
  console.log(`Usage: bun run release:desktop:mac -- <version> [options]

Builds, signs/notarizes, and publishes a macOS-only Agendex Desktop release to GitHub Releases.

Options:
  --dry-run       Print the commands without running them.
  --keep-version  Leave packages/desktop/package.json at the release version.
  --skip-clean    Do not remove packages/desktop/release before packaging.
  --skip-upload   Package the release without creating a GitHub release.
  --help          Show this help.

Required environment (unless --skip-upload):
  GH_TOKEN or a logged-in \`gh\` CLI session for GitHub release upload.

Required environment for signed/notarized builds:
  CSC_LINK and CSC_KEY_PASSWORD, plus either:
    APPLE_API_KEY (path to .p8), APPLE_API_KEY_ID, APPLE_API_ISSUER
    or APPLE_ID and APPLE_APP_SPECIFIC_PASSWORD
`);
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function requireKnownFlags() {
  const unknown = [...flags].filter((flag) => !knownFlags.has(flag));
  if (unknown.length > 0) {
    throw new Error(`Unknown option: ${unknown.join(', ')}`);
  }
}

function requireVersion() {
  const semverPattern =
    /^(?:v|desktop-v)?[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
  if (!semverPattern.test(version.trim())) {
    throw new Error('Pass a semantic release version, for example: 1.0.0 or 1.0.1-beta.1');
  }
}

function requireEnv(keys, label) {
  const missing = keys.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing ${label} environment: ${missing.join(', ')}`);
  }
}

async function requirePath(path, label) {
  try {
    await access(path);
  } catch {
    throw new Error(`${label} does not exist: ${path}`);
  }
}

async function requireReleaseEnv() {
  if (flags.has('--dry-run')) return;

  if (process.platform !== 'darwin') {
    throw new Error('macOS desktop releases must be run from macOS.');
  }

  if (process.env.APPLE_API_KEY) {
    requireEnv(['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'], 'notarization');
    await requirePath(process.env.APPLE_API_KEY, 'APPLE_API_KEY');
  } else {
    requireEnv(['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD'], 'notarization');
  }

  if (!flags.has('--skip-upload') && !process.env.GH_TOKEN) {
    console.warn('GH_TOKEN is not set; relying on an authenticated `gh` CLI session.');
  }
}

function quoteForDisplay(value) {
  return /^[A-Za-z0-9_./:=@+-]+$/.test(value) ? value : JSON.stringify(value);
}

async function run(command, commandArgs) {
  console.log(`$ ${[command, ...commandArgs].map(quoteForDisplay).join(' ')}`);
  if (flags.has('--dry-run')) return;

  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, commandArgs, {
      cwd: repoRoot,
      env: process.env,
      stdio: 'inherit',
    });

    child.on('error', rejectPromise);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      const suffix = signal ? `signal ${signal}` : `exit code ${code}`;
      rejectPromise(new Error(`${command} failed with ${suffix}`));
    });
  });
}

async function cleanReleaseDir() {
  if (flags.has('--skip-clean')) return;

  console.log(`$ rm -rf ${quoteForDisplay(desktopReleaseDir)}`);
  if (!flags.has('--dry-run')) {
    await rm(desktopReleaseDir, { force: true, recursive: true });
  }
}

async function collectReleaseAssets() {
  const allowed = new Set(['.dmg', '.zip', '.blockmap', '.yml']);
  const files = await readdir(desktopReleaseDir);
  return files
    .filter((file) => {
      if (file === 'builder-debug.yml') return false;
      const ext = file.slice(file.lastIndexOf('.'));
      return allowed.has(ext);
    })
    .map((file) => join(desktopReleaseDir, file));
}

async function publishToGitHub(tag, releaseName, isPrerelease) {
  const assets = await collectReleaseAssets();
  if (assets.length === 0) {
    throw new Error(`No release assets found in ${desktopReleaseDir}`);
  }

  const ghArgs = [
    'release',
    'create',
    tag,
    ...assets.flatMap((asset) => ['--attach', asset]),
    '--title',
    releaseName,
    '--notes',
    'Agendex Desktop for macOS. Windows builds will follow in a later release.',
  ];

  if (isPrerelease) {
    ghArgs.push('--prerelease');
  }

  await run('gh', ghArgs);
}

async function main() {
  requireKnownFlags();
  if (flags.has('--help')) {
    printUsage();
    return;
  }

  requireVersion();
  await requireReleaseEnv();

  const originalDesktopPackage = await readFile(desktopPackagePath, 'utf8');
  const restoreVersion = !flags.has('--keep-version') && !flags.has('--dry-run');

  let releaseMeta = null;

  try {
    await cleanReleaseDir();
    await run('node', ['scripts/prepare-desktop-release.mjs', version, '--write']);
    await run('bun', ['run', 'desktop:build']);
    await run('bun', ['run', '--cwd', 'packages/desktop', 'dist', '--', '--mac', '--universal']);

    if (!flags.has('--skip-upload')) {
      const metaOutput = await new Promise((resolvePromise, rejectPromise) => {
        const child = spawn('node', ['scripts/prepare-desktop-release.mjs', version], {
          cwd: repoRoot,
          env: process.env,
          stdio: ['ignore', 'pipe', 'inherit'],
        });

        let stdout = '';
        child.stdout.on('data', (chunk) => {
          stdout += chunk.toString();
        });
        child.on('error', rejectPromise);
        child.on('exit', (code) => {
          if (code === 0) {
            resolvePromise(stdout);
            return;
          }
          rejectPromise(new Error('prepare-desktop-release.mjs failed'));
        });
      });

      releaseMeta = Object.fromEntries(
        metaOutput
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const index = line.indexOf('=');
            return [line.slice(0, index), line.slice(index + 1)];
          }),
      );

      await publishToGitHub(
        releaseMeta.tag,
        releaseMeta.release_name,
        releaseMeta.is_prerelease === 'true',
      );
    }
  } finally {
    if (restoreVersion) {
      await writeFile(desktopPackagePath, originalDesktopPackage);
      console.log('Restored packages/desktop/package.json to its pre-release version.');
    }
  }

  console.log('macOS desktop release complete.');
}

main().catch((error) => {
  if (error instanceof Error) {
    fail(error.message);
    return;
  }

  fail('macOS desktop release failed.');
});
