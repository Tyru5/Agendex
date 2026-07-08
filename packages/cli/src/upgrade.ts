import { spawn, spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLI_VERSION, checkForUpdate } from './version.ts';

type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

const PACKAGE_NAME = 'agendex-cli';

const moduleDir = dirname(fileURLToPath(import.meta.url));

/** Resolve the installed CLI's package root via realpath, falling back gracefully. */
function getPackageRoot(): string {
  try {
    // Walk from this module's dir up to the package.json directory.
    return realpathSync(resolve(moduleDir, '..'));
  } catch {
    return resolve(moduleDir, '..');
  }
}

function normalizeInstallPath(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase();
}

function getInvocationPath(): string | null {
  const entry = process.argv[1];
  if (!entry) return null;
  return isAbsolute(entry) ? entry : resolve(process.cwd(), entry);
}

function getInstallPathHints(): string[] {
  const invocationPath = getInvocationPath();
  return invocationPath ? [invocationPath] : [];
}

/** Detect the package manager that most likely installed this CLI. */
export function detectPackageManager(
  packageRoot: string,
  installPathHints: string[] = getInstallPathHints(),
): PackageManager {
  const userAgent = process.env.npm_config_user_agent ?? '';
  const execpath = process.env.npm_execpath ?? '';

  // Layer 1: active-invocation env vars (set by the pm that ran us).
  if (userAgent.startsWith('bun/') || execpath.includes('bun')) return 'bun';
  if (userAgent.startsWith('pnpm/') || execpath.includes('pnpm')) return 'pnpm';
  if (userAgent.startsWith('yarn/') || execpath.includes('yarn')) return 'yarn';

  // Layer 2: installed-path inspection (works when invoked directly from $PATH).
  const lowerPaths = [packageRoot, ...installPathHints].map(normalizeInstallPath);
  if (lowerPaths.some((path) => path.includes('/.bun/'))) return 'bun';
  if (lowerPaths.some((path) => path.includes('/pnpm/'))) return 'pnpm';
  if (lowerPaths.some((path) => path.includes('/yarn/'))) return 'yarn';
  if (
    lowerPaths.some(
      (path) => path.includes('/lib/node_modules/') || path.includes('/appdata/roaming/npm/'),
    )
  ) {
    return 'npm';
  }

  // Layer 3: bun runtime globals.
  if (typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined' || process.versions.bun) {
    return 'bun';
  }

  return 'npm';
}

interface UpgradeCommand {
  bin: string;
  args: string[];
  display: string;
}

type UpgradeCommandResult =
  | { supported: true; command: UpgradeCommand }
  | { supported: false; reason: string; manualCommand: string };

function executableName(bin: string): string {
  if (process.platform !== 'win32') return bin;
  return bin === 'npm' || bin === 'pnpm' || bin === 'yarn' ? `${bin}.cmd` : bin;
}

function readYarnVersion(): string | null {
  const result = spawnSync(executableName('yarn'), ['--version'], {
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0) return null;
  return result.stdout.trim() || null;
}

function parseMajorVersion(version: string): number | null {
  const match = version.match(/^(\d+)/);
  if (!match) return null;
  const major = Number(match[1]);
  return Number.isFinite(major) ? major : null;
}

function buildGlobalInstallCommand(pm: PackageManager): UpgradeCommandResult {
  const pkgSpec = `${PACKAGE_NAME}@latest`;
  switch (pm) {
    case 'bun':
      return {
        supported: true,
        command: { bin: 'bun', args: ['add', '-g', pkgSpec], display: `bun add -g ${pkgSpec}` },
      };
    case 'pnpm':
      return {
        supported: true,
        command: {
          bin: 'pnpm',
          args: ['add', '-g', pkgSpec],
          display: `pnpm add -g ${pkgSpec}`,
        },
      };
    case 'yarn': {
      const yarnVersion = readYarnVersion();
      const yarnMajorVersion = yarnVersion ? parseMajorVersion(yarnVersion) : null;
      if (yarnMajorVersion !== null && yarnMajorVersion >= 2) {
        return {
          supported: false,
          reason: `automatic upgrade with Yarn only supports Yarn Classic (v1); detected Yarn v${yarnVersion}.`,
          manualCommand: `npm install -g ${pkgSpec}`,
        };
      }
      return {
        supported: true,
        command: {
          bin: 'yarn',
          args: ['global', 'add', pkgSpec],
          display: `yarn global add ${pkgSpec}`,
        },
      };
    }
    default:
      return {
        supported: true,
        command: {
          bin: 'npm',
          args: ['install', '-g', pkgSpec],
          display: `npm install -g ${pkgSpec}`,
        },
      };
  }
}

function pathLooksGlobal(path: string): boolean {
  const normalized = normalizeInstallPath(path);
  const globalMarkers = [
    '/lib/node_modules/',
    '/pnpm/global/',
    '/yarn/global/',
    '/.bun/install/global/',
    '/.bun/install/',
    '/.config/yarn/global/',
    '/appdata/roaming/npm/',
    '/appdata/local/yarn/',
    '/appdata/local/pnpm/',
  ];
  if (globalMarkers.some((marker) => normalized.includes(marker))) return true;

  // Bun exposes global binaries from ~/.bun/bin. When the installed package is a
  // file/path dependency, Node follows the symlink back to the source checkout in
  // import.meta.url, so the package root alone looks local. The invocation path is
  // still a global Bun command, and running `bun add -g agendex-cli@latest` mutates
  // Bun's global package list rather than the checkout.
  const globalBinMarkers = ['/.bun/bin/'];
  return globalBinMarkers.some((marker) => normalized.includes(marker));
}

/** Heuristic: does this look like a real global install (vs a local repo checkout)? */
export function isLikelyGlobalInstall(
  packageRoot: string,
  installPathHints: string[] = getInstallPathHints(),
): boolean {
  return [packageRoot, ...installPathHints].some(pathLooksGlobal);
}

interface RunUpgradeOptions {
  force: boolean;
}

export async function runUpgrade(opts: RunUpgradeOptions): Promise<number> {
  const packageRoot = getPackageRoot();
  const installPathHints = getInstallPathHints();
  const pm = detectPackageManager(packageRoot, installPathHints);
  const isGlobal = isLikelyGlobalInstall(packageRoot, installPathHints);

  // Bail out early on local checkouts / linked installs — don't mutate the user's project.
  if (!isGlobal) {
    process.stderr.write(
      `[agendex] this CLI appears to be running from a local checkout or linked install:\n` +
        `[agendex]   ${packageRoot}\n` +
        `[agendex] automatic upgrade only supports global installs.\n` +
        `[agendex] reinstall globally (e.g. \`npm install -g ${PACKAGE_NAME}@latest\`) or update the source repo manually.\n`,
    );
    return 1;
  }

  // Force-refresh the version cache so we report accurate "already up to date" status.
  const { checked, updateAvailable, current, latest } = await checkForUpdate({
    forceRefresh: true,
  });

  if (checked && !updateAvailable && !opts.force) {
    process.stdout.write(`[agendex] already up to date (v${current})\n`);
    return 0;
  }

  if (!checked) {
    process.stderr.write(
      `[agendex] could not verify the latest version; attempting upgrade anyway...\n`,
    );
  }

  const commandResult = buildGlobalInstallCommand(pm);
  if (!commandResult.supported) {
    process.stderr.write(`[agendex] ${commandResult.reason}\n`);
    process.stderr.write(
      `[agendex] install the latest CLI manually, e.g. \`${commandResult.manualCommand}\`.\n`,
    );
    return 1;
  }
  const cmd = commandResult.command;

  if (checked && updateAvailable) {
    process.stdout.write(`[agendex] upgrading: v${current} → v${latest}\n`);
  } else if (opts.force) {
    process.stdout.write(`[agendex] reinstalling v${CLI_VERSION} (forced)\n`);
  }
  process.stdout.write(`[agendex] running: ${cmd.display}\n`);

  return new Promise<number>((resolveExit) => {
    const child = spawn(executableName(cmd.bin), cmd.args, {
      stdio: 'inherit',
      env: process.env,
    });
    let didError = false;
    child.on('error', (err) => {
      didError = true;
      process.stderr.write(
        `[agendex] failed to run ${cmd.bin}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.stderr.write(`[agendex] you can run it manually: ${cmd.display}\n`);
      resolveExit(1);
    });
    child.on('close', (code) => {
      if (didError) return;
      if (code === 0) {
        process.stdout.write(`[agendex] upgrade complete.\n`);
        process.stdout.write(
          `[agendex] note: if the daemon is running, restart it: \`agendex stop && agendex start\`\n`,
        );
        resolveExit(0);
        return;
      }
      process.stderr.write(`[agendex] upgrade failed with exit code ${code ?? 'unknown'}\n`);
      process.stderr.write(`[agendex] you can run it manually: ${cmd.display}\n`);
      resolveExit(code ?? 1);
    });
  });
}
