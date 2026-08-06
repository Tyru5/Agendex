import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export type WindowsAgentEnv = 'native' | 'wsl';

export type WindowsEnvStatus = {
  env: WindowsAgentEnv;
  wslAvailable: boolean;
  wslDistroName: string | null;
  wslHomePath: string | null;
  error?: string;
};

export type WindowsEnvSetResult = WindowsEnvStatus & {
  ok: boolean;
  willRelaunch: boolean;
};

export type WslDetection = {
  available: boolean;
  distroName: string | null;
  homePath: string | null;
  error?: string;
};

export type WindowsEnvRuntime = {
  nativeHome: string;
  nativeConfigDir: string;
  isDev: boolean;
};

type RunCommandResult = {
  code: number | null;
  stdout: Buffer;
  stderr: Buffer;
};

type RunCommand = (
  command: string,
  args: readonly string[],
  options?: { timeoutMs?: number },
) => Promise<RunCommandResult>;

const DEFAULT_WSL_TIMEOUT_MS = 5_000;

/** Lazy so unit tests can import pure helpers without loading Electron. */
function getElectronApp(): typeof import('electron').app {
  return (require('electron') as typeof import('electron')).app;
}

function windowsEnvPrefPath(): string {
  return join(getElectronApp().getPath('userData'), 'agendex-windows-env.json');
}

export function parseWindowsAgentEnv(value: unknown): WindowsAgentEnv | null {
  return value === 'native' || value === 'wsl' ? value : null;
}

export function loadWindowsEnvPref(): WindowsAgentEnv {
  try {
    const path = windowsEnvPrefPath();
    if (!existsSync(path)) return 'native';
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { env?: unknown };
    return parseWindowsAgentEnv(raw.env) ?? 'native';
  } catch {
    return 'native';
  }
}

export function saveWindowsEnvPref(env: WindowsAgentEnv): void {
  const dir = getElectronApp().getPath('userData');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(windowsEnvPrefPath(), JSON.stringify({ env }), 'utf8');
}

export function resolveNativeHomeDir(): string {
  if (process.env.USERPROFILE?.trim()) return process.env.USERPROFILE.trim();
  if (process.env.HOMEDRIVE && process.env.HOMEPATH) {
    return `${process.env.HOMEDRIVE}${process.env.HOMEPATH}`;
  }
  if (process.env.HOME?.trim()) return process.env.HOME.trim();
  return homedir();
}

export function resolveNativeConfigDir(
  isDev: boolean,
  nativeHome = resolveNativeHomeDir(),
): string {
  const override = process.env.AGENDEX_CONFIG_DIR?.trim();
  if (override) return resolve(override);
  return join(nativeHome, isDev ? '.agendex-dev' : '.agendex');
}

export function createWindowsEnvRuntime(isDev: boolean): WindowsEnvRuntime {
  const nativeHome = resolveNativeHomeDir();
  return {
    nativeHome,
    nativeConfigDir: resolveNativeConfigDir(isDev, nativeHome),
    isDev,
  };
}

function decodeWslText(buffer: Buffer): string {
  if (buffer.length >= 2) {
    const evenNulls = countNullsAt(buffer, 0);
    const oddNulls = countNullsAt(buffer, 1);
    // wsl.exe -l emits UTF-16LE; treat mostly-null odd bytes as UTF-16LE.
    if (oddNulls > evenNulls && oddNulls >= buffer.length / 8) {
      return buffer.toString('utf16le');
    }
  }
  return buffer.toString('utf8');
}

function countNullsAt(buffer: Buffer, offset: number): number {
  let count = 0;
  for (let i = offset; i < buffer.length; i += 2) {
    if (buffer[i] === 0) count += 1;
  }
  return count;
}

/**
 * Parse `wsl.exe -l` / `wsl.exe -l -q` output into distro names.
 * The default distribution (marked with `*` or `(Default)`) is returned first
 * so callers using `[0]` always get the same distro that bare `wsl.exe -e`
 * would target.
 *
 * Distro names may contain spaces. Verbose `wsl -l -v` rows (NAME STATE VERSION)
 * are ignored so localized multi-word STATE columns cannot corrupt names.
 */
export function parseWslDistroList(stdout: Buffer): string[] {
  const names: string[] = [];
  let defaultName: string | null = null;

  for (const raw of decodeWslText(stdout).split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, '').trim();
    if (!line) continue;
    // Skip the non-quiet banner / verbose header rows.
    if (/^Windows Subsystem for Linux/i.test(line)) continue;
    if (/^NAME\b/i.test(line)) continue;

    const isDefault = /^\*/.test(line) || /\(Default\)\s*$/i.test(line);
    const name = line
      .replace(/^\*\s*/, '')
      .replace(/\s*\(Default\)\s*$/i, '')
      .trim();
    if (!name) continue;
    // Verbose rows end with `STATE VERSION` where VERSION is numeric. Skip them
    // rather than guessing how many STATE words to strip (locales vary).
    if (/\s+\S+\s+\d+\s*$/.test(name)) continue;
    if (!names.includes(name)) names.push(name);
    if (isDefault) defaultName = name;
  }

  if (!defaultName || names[0] === defaultName) return names;
  return [defaultName, ...names.filter((n) => n !== defaultName)];
}

export function toWindowsWslHomePath(distroName: string, linuxHome: string): string {
  const normalized = linuxHome.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  const relative = normalized.startsWith('/') ? normalized.slice(1) : normalized;
  return `\\\\wsl$\\${distroName}\\${relative.replace(/\//g, '\\')}`;
}

async function defaultRunCommand(
  command: string,
  args: readonly string[],
  options?: { timeoutMs?: number },
): Promise<RunCommandResult> {
  return await new Promise((resolvePromise) => {
    const child = spawn(command, [...args], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let settled = false;

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({
        code,
        stdout: Buffer.concat(chunks),
        stderr: Buffer.concat(errChunks),
      });
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(null);
    }, options?.timeoutMs ?? DEFAULT_WSL_TIMEOUT_MS);

    child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => errChunks.push(chunk));
    child.on('error', () => finish(null));
    child.on('close', (code) => finish(code));
  });
}

export async function detectWsl(
  runCommand: RunCommand = defaultRunCommand,
  options?: { platform?: NodeJS.Platform },
): Promise<WslDetection> {
  const platform = options?.platform ?? process.platform;
  if (platform !== 'win32') {
    return { available: false, distroName: null, homePath: null, error: 'Not Windows' };
  }

  // Prefer non-verbose `-l` so default is marked with `*` / `(Default)` without
  // localized STATE/VERSION columns that can corrupt distro names.
  const list = await runCommand('wsl.exe', ['-l']);
  if (list.code !== 0) {
    return {
      available: false,
      distroName: null,
      homePath: null,
      error: 'WSL not detected',
    };
  }

  const distros = parseWslDistroList(list.stdout);
  const distroName = distros[0] ?? null;
  if (!distroName) {
    return {
      available: false,
      distroName: null,
      homePath: null,
      error: 'No WSL distro installed',
    };
  }

  // Pin `-d` so home/wslpath resolve against the same distro we report.
  const homeResult = await runCommand('wsl.exe', [
    '-d',
    distroName,
    '-e',
    'sh',
    '-lc',
    'printf %s "$HOME"',
  ]);
  const linuxHome = decodeWslText(homeResult.stdout).trim();
  if (homeResult.code !== 0 || !linuxHome.startsWith('/')) {
    return {
      available: false,
      distroName,
      homePath: null,
      error: 'Could not resolve WSL home directory',
    };
  }

  const wslpathResult = await runCommand('wsl.exe', [
    '-d',
    distroName,
    '-e',
    'wslpath',
    '-w',
    linuxHome,
  ]);
  const wslpathHome = decodeWslText(wslpathResult.stdout).trim();
  const homePath =
    wslpathResult.code === 0 && wslpathHome
      ? wslpathHome
      : toWindowsWslHomePath(distroName, linuxHome);

  if (!homePath) {
    return {
      available: false,
      distroName,
      homePath: null,
      error: 'Could not map WSL home to a Windows path',
    };
  }

  return { available: true, distroName, homePath };
}

export function resolveRuntimeEnvVars(
  env: WindowsAgentEnv,
  runtime: WindowsEnvRuntime,
  detection: WslDetection,
): { env: WindowsAgentEnv; patch: Record<string, string | undefined>; error?: string } {
  const patch: Record<string, string | undefined> = {
    AGENDEX_CONFIG_DIR: runtime.nativeConfigDir,
  };

  if (env === 'wsl') {
    if (!detection.available || !detection.homePath) {
      patch.AGENDEX_HOME = undefined;
      return {
        env: 'native',
        patch,
        error: detection.error ?? 'WSL not available',
      };
    }
    patch.AGENDEX_HOME = detection.homePath;
    return { env: 'wsl', patch };
  }

  patch.AGENDEX_HOME = undefined;
  return { env: 'native', patch };
}

export function applyRuntimeEnvVars(patch: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === '') delete process.env[key];
    else process.env[key] = value;
  }
}

export function mergeWorkerEnv(
  baseEnv: NodeJS.ProcessEnv,
  patch: Record<string, string | undefined>,
): NodeJS.ProcessEnv {
  const env = { ...baseEnv };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === '') delete env[key];
    else env[key] = value;
  }
  return env;
}

export async function getWindowsEnvStatus(options: {
  runtime: WindowsEnvRuntime;
  detect?: () => Promise<WslDetection>;
  loadPref?: () => WindowsAgentEnv;
}): Promise<WindowsEnvStatus> {
  const pref = (options.loadPref ?? loadWindowsEnvPref)();
  const detection = await (options.detect ?? detectWsl)();
  const resolved = resolveRuntimeEnvVars(pref, options.runtime, detection);
  return {
    env: resolved.env,
    wslAvailable: detection.available,
    wslDistroName: detection.distroName,
    wslHomePath: detection.homePath,
    ...(resolved.error
      ? { error: resolved.error }
      : detection.error
        ? { error: detection.error }
        : {}),
  };
}

export function applyWindowsEnvAtBoot(
  runtime: WindowsEnvRuntime,
  detection: WslDetection,
  loadPref: () => WindowsAgentEnv = loadWindowsEnvPref,
): { env: WindowsAgentEnv; patch: Record<string, string | undefined>; error?: string } {
  const pref = loadPref();
  const resolved = resolveRuntimeEnvVars(pref, runtime, detection);
  applyRuntimeEnvVars(resolved.patch);
  return resolved;
}
