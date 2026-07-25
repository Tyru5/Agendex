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
  console.log(`Usage: bun run release:desktop:win -- <version> [options]

Builds and publishes a Windows x64-only Agendex Desktop release to GitHub Releases.

Signing is optional. Without WIN_CSC_* / CSC_* credentials, electron-builder ships
an unsigned installer (SmartScreen will warn; users can Run anyway).

Assets are attached to the existing desktop-v<version> release when there is one,
so a Windows build can join a release that already shipped macOS artifacts.

Options:
  --dry-run       Print the commands without running them.
  --keep-version  Leave packages/desktop/package.json at the release version.
                  (Stable releases always leave DownloadPage.tsx updated.)
  --skip-clean    Do not remove packages/desktop/release before packaging.
  --skip-upload   Package the release without touching GitHub Releases.
  --help          Show this help.

Required environment (unless --skip-upload):
  GH_TOKEN or a logged-in \`gh\` CLI session for GitHub release upload.

Optional signing environment (either pair works):
  WIN_CSC_LINK, WIN_CSC_KEY_PASSWORD
    or CSC_LINK, CSC_KEY_PASSWORD

Must be run on Windows. From Linux/macOS, use GitHub Actions instead:
  gh workflow run "Release Desktop" -f version=<version> -f platform=win
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

async function requirePath(path, label) {
  try {
    await access(path);
  } catch {
    throw new Error(`${label} does not exist: ${path}`);
  }
}

/**
 * Resolve Windows signing credentials into electron-builder's CSC_* vars.
 * Prefer WIN_CSC_* (matches the GitHub secret names) then fall back to CSC_*.
 * Returns the env overrides to merge into the packaging step (may be empty).
 */
async function resolveSigningEnv() {
  const link = process.env.WIN_CSC_LINK || process.env.CSC_LINK || '';
  const password = process.env.WIN_CSC_KEY_PASSWORD || process.env.CSC_KEY_PASSWORD || '';

  if (!link && !password) {
    return { signed: false, env: {} };
  }

  if (!link || !password) {
    throw new Error(
      'Partial Windows signing credentials: set both WIN_CSC_LINK and WIN_CSC_KEY_PASSWORD (or both CSC_LINK and CSC_KEY_PASSWORD).',
    );
  }

  // File-path certificates must exist. Base64 / data: / https: values are
  // passed through to electron-builder unchanged.
  const looksLikePath =
    link.startsWith('.') ||
    link.startsWith('/') ||
    link.includes('\\') ||
    /^[A-Za-z]:[\\/]/.test(link);
  if (looksLikePath) {
    await requirePath(link, 'Windows code-signing certificate');
  }

  return { signed: true, env: { CSC_LINK: link, CSC_KEY_PASSWORD: password } };
}

async function requireReleaseEnv() {
  if (flags.has('--dry-run')) return;

  if (process.platform !== 'win32') {
    throw new Error(
      'Windows desktop releases must be run from Windows. Use GitHub Actions instead:\n' +
        '  gh workflow run "Release Desktop" -f version=<version> -f platform=win',
    );
  }

  if (!flags.has('--skip-upload') && !process.env.GH_TOKEN) {
    console.warn('GH_TOKEN is not set; relying on an authenticated `gh` CLI session.');
  }
}

function quoteForDisplay(value) {
  return /^[A-Za-z0-9_./:=@+-]+$/.test(value) ? value : JSON.stringify(value);
}

async function run(command, commandArgs, env = process.env) {
  console.log(`$ ${[command, ...commandArgs].map(quoteForDisplay).join(' ')}`);
  if (flags.has('--dry-run')) return;

  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, commandArgs, {
      cwd: repoRoot,
      env,
      stdio: 'inherit',
      // Windows resolves `bun`/`gh` through shims that need a shell.
      shell: process.platform === 'win32',
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

function capture(command, commandArgs) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, commandArgs, {
      cwd: repoRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'inherit'],
      shell: process.platform === 'win32',
    });

    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.on('error', rejectPromise);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise(stdout);
      else rejectPromise(new Error(`${command} failed with exit code ${code}`));
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
  const allowed = new Set(['.exe', '.blockmap', '.yml']);
  const files = await readdir(desktopReleaseDir);
  return files
    .filter((file) => {
      if (file === 'builder-debug.yml') return false;
      const ext = file.slice(file.lastIndexOf('.'));
      return allowed.has(ext);
    })
    .map((file) => join(desktopReleaseDir, file));
}

async function releaseExists(tag) {
  try {
    await capture('gh', ['release', 'view', tag, '--json', 'tagName']);
    return true;
  } catch {
    return false;
  }
}

async function publishToGitHub(tag, releaseName, isPrerelease) {
  if (flags.has('--dry-run')) {
    console.log(`$ gh release upload ${tag} <packaged assets> --clobber`);
    console.log(`  (falls back to \`gh release create ${tag}\` when the release does not exist)`);
    return;
  }

  const assets = await collectReleaseAssets();
  if (assets.length === 0) {
    throw new Error(`No release assets found in ${desktopReleaseDir}`);
  }

  // Windows often ships onto a tag that already carries the macOS artifacts,
  // so attach to the existing release instead of failing on `create`.
  if (await releaseExists(tag)) {
    console.log(`Release ${tag} already exists; attaching Windows assets.`);
    await run('gh', ['release', 'upload', tag, ...assets, '--clobber']);
    return;
  }

  const ghArgs = [
    'release',
    'create',
    tag,
    ...assets.flatMap((asset) => ['--attach', asset]),
    '--title',
    releaseName,
    '--notes',
    'Agendex Desktop for Windows (x64). This build is not code-signed: SmartScreen will warn, choose More info then Run anyway.',
  ];

  if (isPrerelease) {
    ghArgs.push('--prerelease');
  }

  await run('gh', ghArgs);
}

async function readReleaseMeta() {
  const output = await capture('node', ['scripts/prepare-desktop-release.mjs', version]);
  return Object.fromEntries(
    output
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

async function main() {
  requireKnownFlags();
  if (flags.has('--help')) {
    printUsage();
    return;
  }

  requireVersion();
  await requireReleaseEnv();

  const signing = flags.has('--dry-run')
    ? { signed: Boolean(process.env.WIN_CSC_LINK || process.env.CSC_LINK), env: {} }
    : await resolveSigningEnv();

  if (signing.signed) {
    console.log('Windows signing credentials found; packaging a signed installer.');
  } else {
    console.log(
      'No Windows signing credentials; packaging an unsigned installer (SmartScreen will warn).',
    );
  }

  const originalDesktopPackage = await readFile(desktopPackagePath, 'utf8');
  const restoreVersion = !flags.has('--keep-version') && !flags.has('--dry-run');
  const packageEnv = { ...process.env, ...signing.env };

  try {
    await cleanReleaseDir();
    // --write also bumps packages/web DownloadPage DESKTOP_VERSION for stable
    // releases. That change is intentionally kept so /download stays current;
    // only packages/desktop/package.json is restored below.
    await run('node', ['scripts/prepare-desktop-release.mjs', version, '--write']);
    await run('bun', ['run', 'desktop:build']);
    await run(
      'bun',
      ['run', '--cwd', 'packages/desktop', 'dist', '--', '--win', '--x64'],
      packageEnv,
    );

    if (!flags.has('--skip-upload')) {
      const releaseMeta = await readReleaseMeta();
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

  console.log('Windows desktop release complete.');
}

main().catch((error) => {
  if (error instanceof Error) {
    fail(error.message);
    return;
  }

  fail('Windows desktop release failed.');
});
