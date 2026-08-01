#!/usr/bin/env node
// Packages packages/ee/dist as a signed UI bundle for the desktop app.
//
// Two modes:
//   --stamp-only   Write dist/ui-bundle.json and stop. Run as part of the
//                  desktop build so `resources/client` carries a revision and
//                  the shipped-floor comparison is meaningful.
//   (default)      Stamp, tar+gzip, hash, and emit a manifest — optionally
//                  signed. Run by .github/workflows/ui-release.yml.
//
// The bundle's revision is the git commit timestamp it was built from:
// monotonic on a linear main, deterministic in CI, and no counter to maintain.

import { execFileSync } from 'node:child_process';
import { createHash, createPrivateKey, sign as signBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { create as createTarball } from 'tar';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const eeDir = join(repoRoot, 'packages', 'ee');
const distDir = join(eeDir, 'dist');
const configPath = join(eeDir, 'ui-bundle.config.json');

const DEFAULT_ASSET_BASE_URL =
  'https://github.com/Tyru5/Agendex/releases/download/desktop-ui-channel';

function parseArgs(argv) {
  const args = { stampOnly: false, outDir: join(eeDir, 'ui-release'), signKey: null };
  args.assetBaseUrl = process.env.UI_ASSET_BASE_URL || DEFAULT_ASSET_BASE_URL;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--stamp-only') args.stampOnly = true;
    else if (arg === '--out') args.outDir = resolve(argv[++i]);
    else if (arg === '--sign-key') args.signKey = resolve(argv[++i]);
    else if (arg === '--asset-base-url') args.assetBaseUrl = argv[++i];
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  return args;
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

/**
 * Revision 0 means "unknown" — a build with no git available. It loses to every
 * published bundle, which is the safe direction: a local build never pretends to
 * outrank what the feed is serving.
 */
function resolveRevision() {
  const raw = Number.parseInt(git(['log', '-1', '--format=%ct']), 10);
  return Number.isSafeInteger(raw) && raw > 0 ? raw : 0;
}

function readMinShellVersion() {
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const value = config.minShellVersion;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${configPath} is missing a minShellVersion string`);
  }
  return value;
}

function writeStamp(revision, minShellVersion) {
  if (!existsSync(distDir)) {
    throw new Error(`${distDir} does not exist — build packages/ee first`);
  }
  const sha = git(['rev-parse', '--short', 'HEAD']) || 'nogit';
  const date = revision > 0 ? new Date(revision * 1000).toISOString().slice(0, 10) : 'local';
  const stamp = { revision, label: `${date} (${sha})`, minShellVersion };
  writeFileSync(join(distDir, 'ui-bundle.json'), `${JSON.stringify(stamp, null, 2)}\n`, 'utf8');
  return stamp;
}

function loadPrivateKey(signKeyPath) {
  const pem = signKeyPath
    ? readFileSync(signKeyPath, 'utf8')
    : (process.env.UI_BUNDLE_SIGNING_KEY ?? '');
  if (pem.trim() === '') return null;
  return createPrivateKey(pem);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const revision = resolveRevision();
  const minShellVersion = readMinShellVersion();

  // Written before packaging so the stamp travels inside the tarball, which is
  // what lets the installer confirm it extracted the revision it asked for.
  const stamp = writeStamp(revision, minShellVersion);
  console.log(
    `ui-bundle: revision ${stamp.revision} ${stamp.label} (needs shell >= ${minShellVersion})`,
  );

  if (args.stampOnly) return;

  if (revision === 0) {
    throw new Error('refusing to publish a bundle with an unknown revision (no git history)');
  }

  rmSync(args.outDir, { recursive: true, force: true });
  mkdirSync(args.outDir, { recursive: true });

  const archiveName = `agendex-ui-${revision}.tar.gz`;
  const archivePath = join(args.outDir, archiveName);

  // `portable` drops mtimes/uid/gid so the same dist produces the same bytes.
  await createTarball({ gzip: true, file: archivePath, cwd: distDir, portable: true }, ['.']);

  const bytes = readFileSync(archivePath);
  const manifest = {
    revision,
    label: stamp.label,
    minShellVersion,
    url: `${args.assetBaseUrl.replace(/\/$/, '')}/${archiveName}`,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: statSync(archivePath).size,
  };

  const manifestPath = join(args.outDir, 'ui-manifest.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  // Sign the bytes exactly as written. A detached signature over the raw file
  // means publisher and client agree on one byte sequence, with no JSON
  // canonicalization to get wrong.
  const privateKey = loadPrivateKey(args.signKey);
  if (privateKey) {
    const signature = signBytes(null, readFileSync(manifestPath), privateKey);
    writeFileSync(`${manifestPath}.sig`, signature);
    console.log(`ui-bundle: signed manifest (${signature.length} bytes)`);
  } else {
    console.warn(
      'ui-bundle: WARNING no signing key (UI_BUNDLE_SIGNING_KEY or --sign-key); manifest is unsigned and every shell will reject it',
    );
  }

  console.log(`ui-bundle: wrote ${args.outDir}`);
  console.log(`  ${archiveName}  ${(manifest.size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  sha256 ${manifest.sha256}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
