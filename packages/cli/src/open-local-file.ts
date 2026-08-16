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

export async function launchOpenCommand(
  command: string,
  args: string[],
  options: SpawnOptions = {},
): Promise<boolean> {
  if (!commandExists(command)) return false;
  return await new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
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
    child.once('spawn', () => {
      child.unref();
      finish(true);
    });
  });
}

/** Launch a local file with the OS handler. True when the handler process started. */
export async function openLocalFile(path: string, platform = process.platform): Promise<boolean> {
  if (isLocalFileOpenDisabled()) return false;
  const launch = buildOpenLocalFileCommand(path, platform);
  return await launchOpenCommand(launch.command, launch.args, launch.options ?? {});
}
