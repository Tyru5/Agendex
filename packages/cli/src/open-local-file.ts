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
      command: 'cmd',
      args: ['/c', 'start', '', path],
      options: { windowsHide: true },
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

  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    for (const ext of extensions) {
      if (existsSync(join(dir, name + ext))) return true;
    }
  }
  return false;
}

function spawnDetached(command: string, args: string[], options: SpawnOptions = {}): boolean {
  if (!commandExists(command)) return false;
  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      ...options,
    });
    child.on('error', () => {});
    if (child.pid === undefined) return false;
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/** Launch a local file with the OS handler. Returns false when launch is disabled or fails. */
export function openLocalFile(path: string, platform = process.platform): boolean {
  if (isLocalFileOpenDisabled()) return false;
  const launch = buildOpenLocalFileCommand(path, platform);
  return spawnDetached(launch.command, launch.args, launch.options ?? {});
}
