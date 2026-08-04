/**
 * Launch a local application on a pre-resolved file path. Argv-only spawn,
 * detached so the server never blocks on the launched process.
 */
import { spawn, type SpawnOptions } from 'node:child_process';
import { buildLaunchCommand } from '@agendex/shared';

export interface OpenInLaunchResult {
  ok: boolean;
  error?: string;
}

/** Brief window to catch immediate spawn failures (ENOENT/EACCES) before OK. */
const SPAWN_ERROR_GRACE_MS = 40;

/**
 * Windows editor CLIs are often `.cmd`/`.bat` shims. Shell-disabled `spawn`
 * cannot execute those directly, so rewrite through `cmd.exe /d /s /c`.
 * Exported for unit tests.
 */
export function resolveSpawnInvocation(argv: string[]): {
  command: string;
  args: string[];
  options: SpawnOptions;
} {
  const command = argv[0]!;
  const args = argv.slice(1);
  const baseOptions: SpawnOptions = { detached: true, stdio: 'ignore' };

  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)) {
    const comspec = process.env.ComSpec || 'cmd.exe';
    // cmd.exe quoting: wrap when whitespace/metacharacters are present; double
    // embedded quotes; escape % so paired segments like %USERNAME% are not
    // expanded before the shim sees the path.
    const quote = (value: string) => {
      const escaped = value.replace(/%/g, '%%').replace(/"/g, '""');
      return /[\s&<>|^()"]/u.test(value) || value.includes('%') ? `"${escaped}"` : escaped;
    };
    const cmdline = [command, ...args].map(quote).join(' ');
    return {
      command: comspec,
      args: ['/d', '/s', '/c', cmdline],
      options: { ...baseOptions, windowsVerbatimArguments: true },
    };
  }

  return { command, args, options: baseOptions };
}

export async function launchOpenIn(
  appId: string,
  filePath: string,
  line?: number,
): Promise<OpenInLaunchResult> {
  const argv = buildLaunchCommand(appId, filePath, line);
  if (!argv || argv.length === 0) {
    return { ok: false, error: `The selected application is not available on this machine.` };
  }

  return await new Promise<OpenInLaunchResult>((resolve) => {
    let settled = false;
    const finish = (result: OpenInLaunchResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    try {
      const { command, args, options } = resolveSpawnInvocation(argv);
      const child = spawn(command, args, options);
      child.once('error', (err) => {
        finish({
          ok: false,
          error: err instanceof Error ? err.message : 'Failed to launch',
        });
      });
      setTimeout(() => {
        child.unref();
        finish({ ok: true });
      }, SPAWN_ERROR_GRACE_MS);
    } catch (err) {
      finish({ ok: false, error: err instanceof Error ? err.message : 'Failed to launch' });
    }
  });
}
