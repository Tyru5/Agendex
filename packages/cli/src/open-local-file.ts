import { spawn, type SpawnOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

export interface OpenLocalFileCommand {
  command: string;
  args: string[];
  options?: SpawnOptions;
}

export function isLocalFileOpenDisabled(): boolean {
  return process.env.AGENDEX_DISABLE_BROWSER === '1';
}

export function buildOpenLocalFileCommand(
  path: string,
  platform = process.platform,
): OpenLocalFileCommand {
  if (platform === 'darwin') return { command: 'open', args: [path] };
  if (platform === 'win32') {
    return {
      command: 'powershell',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        'Start-Process -LiteralPath $env:AGENDEX_OPEN_PATH',
      ],
      options: {
        windowsHide: true,
        env: { ...process.env, AGENDEX_OPEN_PATH: path },
      },
    };
  }
  return { command: 'xdg-open', args: [path] };
}

export function commandExists(name: string, platform = process.platform): boolean {
  if (name.includes('/') || name.includes('\\')) return existsSync(name);

  const pathEnv = process.env.PATH ?? '';
  const extensions =
    platform === 'win32'
      ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').map((ext) => ext.toLowerCase())
      : [''];
  const suffixes =
    platform === 'win32' && extensions.some((ext) => ext && name.toLowerCase().endsWith(ext))
      ? ['']
      : extensions;

  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    for (const ext of suffixes) {
      if (existsSync(join(dir, name + ext))) return true;
    }
  }
  return false;
}

export interface LaunchOpenHooks {
  /** How long to watch for an early non-zero exit before declaring the launch good. */
  graceMs?: number;
  /** Called when the launcher fails after the launch was already reported as successful. */
  onLateFailure?: (code: number | null) => void;
}

/**
 * Launchers (`open`, `xdg-open`, `Start-Process`) normally exit within
 * milliseconds; a missing handler surfaces as a fast non-zero exit, which this
 * window catches. A launcher still alive past the window is a handler running
 * in the foreground (e.g. a terminal editor), which is a successful open and
 * must not be waited out.
 */
const OPEN_LAUNCH_GRACE_MS = 1000;

export async function launchOpenCommand(
  command: string,
  args: string[],
  options: SpawnOptions = {},
  hooks: LaunchOpenHooks = {},
): Promise<boolean> {
  if (!commandExists(command)) return false;
  const graceMs = hooks.graceMs ?? OPEN_LAUNCH_GRACE_MS;
  return await new Promise((resolve) => {
    let settled = false;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      if (graceTimer !== undefined) clearTimeout(graceTimer);
      resolve(ok);
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, {
        ...options,
        detached: true,
        stdio: 'ignore',
      });
    } catch {
      finish(false);
      return;
    }

    child.once('error', () => finish(false));
    child.on('exit', (code) => {
      if (!settled) {
        finish(code === 0);
        return;
      }
      // Past the grace window the result is already reported; the best that
      // can be done for a late failure is to surface it while still running.
      if (code !== 0) hooks.onLateFailure?.(code);
    });
    child.once('spawn', () => {
      if (settled) return;
      graceTimer = setTimeout(() => {
        child.unref();
        finish(true);
      }, graceMs);
    });
  });
}

/**
 * Launch a local file with the OS handler. True when the handler started and
 * did not fail within the grace window; failures after that are reported via
 * `hooks.onLateFailure`.
 */
export async function openLocalFile(
  path: string,
  platform = process.platform,
  hooks: LaunchOpenHooks = {},
): Promise<boolean> {
  if (isLocalFileOpenDisabled()) return false;
  const launch = buildOpenLocalFileCommand(path, platform);
  return await launchOpenCommand(launch.command, launch.args, launch.options ?? {}, hooks);
}
