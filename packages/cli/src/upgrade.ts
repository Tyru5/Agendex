import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
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

/** Detect the package manager that most likely installed this CLI. */
function detectPackageManager(packageRoot: string): PackageManager {
  const userAgent = process.env.npm_config_user_agent ?? '';
  const execpath = process.env.npm_execpath ?? '';

  // Layer 1: active-invocation env vars (set by the pm that ran us).
  if (userAgent.startsWith('bun/') || execpath.includes('bun')) return 'bun';
  if (userAgent.startsWith('pnpm/') || execpath.includes('pnpm')) return 'pnpm';
  if (userAgent.startsWith('yarn/') || execpath.includes('yarn')) return 'yarn';

  // Layer 2: installed-path inspection (works when invoked directly from $PATH).
  const lower = packageRoot.toLowerCase();
  if (lower.includes(`${sep}.bun${sep}`) || lower.includes('/.bun/')) return 'bun';
  if (lower.includes(`${sep}pnpm${sep}`) || lower.includes('/pnpm/')) return 'pnpm';
  if (lower.includes(`${sep}yarn${sep}`) || lower.includes('/yarn/')) return 'yarn';

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

function buildGlobalInstallCommand(pm: PackageManager): UpgradeCommand {
  const pkgSpec = `${PACKAGE_NAME}@latest`;
  switch (pm) {
    case 'bun':
      return { bin: 'bun', args: ['add', '-g', pkgSpec], display: `bun add -g ${pkgSpec}` };
    case 'pnpm':
      return { bin: 'pnpm', args: ['add', '-g', pkgSpec], display: `pnpm add -g ${pkgSpec}` };
    case 'yarn':
      return {
        bin: 'yarn',
        args: ['global', 'add', pkgSpec],
        display: `yarn global add ${pkgSpec}`,
      };
    default:
      return {
        bin: 'npm',
        args: ['install', '-g', pkgSpec],
        display: `npm install -g ${pkgSpec}`,
      };
  }
}

/** Heuristic: does this look like a real global install (vs a local repo / linked checkout)? */
function isLikelyGlobalInstall(packageRoot: string): boolean {
  const normalized = packageRoot.replace(/\\/g, '/');
  if (!normalized.includes('/node_modules/')) {
    // Not under any node_modules — almost certainly a source checkout or `npm link` target.
    return false;
  }
  const globalMarkers = [
    '/lib/node_modules/',
    '/pnpm/global/',
    '/yarn/global/',
    '/.bun/install/global/',
    '/.bun/install/',
    '/.config/yarn/global/',
    '/AppData/Roaming/npm/',
    '/AppData/Local/Yarn/',
    '/AppData/Local/pnpm/',
  ];
  return globalMarkers.some((marker) => normalized.includes(marker));
}

interface RunUpgradeOptions {
  force: boolean;
}

export async function runUpgrade(opts: RunUpgradeOptions): Promise<number> {
  const packageRoot = getPackageRoot();
  const pm = detectPackageManager(packageRoot);
  const isGlobal = isLikelyGlobalInstall(packageRoot);

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

  const cmd = buildGlobalInstallCommand(pm);

  if (checked && updateAvailable) {
    process.stdout.write(`[agendex] upgrading: v${current} → v${latest}\n`);
  } else if (opts.force) {
    process.stdout.write(`[agendex] reinstalling v${CLI_VERSION} (forced)\n`);
  }
  process.stdout.write(`[agendex] running: ${cmd.display}\n`);

  return await new Promise<number>((resolveExit) => {
    const child = spawn(cmd.bin, cmd.args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: process.env,
    });
    child.on('error', (err) => {
      process.stderr.write(
        `[agendex] failed to run ${cmd.bin}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.stderr.write(`[agendex] you can run it manually: ${cmd.display}\n`);
      resolveExit(1);
    });
    child.on('close', (code) => {
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
