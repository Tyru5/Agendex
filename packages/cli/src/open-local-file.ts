import { spawn, type SpawnOptions } from 'node:child_process';

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

function spawnDetached(command: string, args: string[], options: SpawnOptions = {}): void {
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    ...options,
  });
  child.on('error', () => {});
  child.unref();
}

/** Launch a local file with the OS handler. Returns false when launch is disabled. */
export function openLocalFile(path: string, platform = process.platform): boolean {
  if (isLocalFileOpenDisabled()) return false;
  const launch = buildOpenLocalFileCommand(path, platform);
  spawnDetached(launch.command, launch.args, launch.options ?? {});
  return true;
}
