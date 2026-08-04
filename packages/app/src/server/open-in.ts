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

const OPEN_ARGV_ENV_PREFIX = 'AGENDEX_OPEN_ARGV_';

/**
 * Windows editor CLIs are often `.cmd`/`.bat` shims. Shell-disabled `spawn`
 * cannot execute those directly, so rewrite through `cmd.exe /d /s /c`.
 *
 * Argv tokens are handed off via env vars (`AGENDEX_OPEN_ARGV_*`) and referenced
 * as `%AGENDEX_OPEN_ARGV_N%` on the cmdline. That keeps literal `%` segments
 * (e.g. a folder named `%USERNAME%`) out of cmd's parser — env expansion is
 * not recursive, so the shim receives the original path bytes.
 *
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
    const env: Record<string, string | undefined> = { ...process.env };
    const tokens: string[] = [];

    for (let i = 0; i < argv.length; i++) {
      const key = `${OPEN_ARGV_ENV_PREFIX}${i}`;
      env[key] = argv[i];
      // Quote each expansion so spaces in the value stay one token for the shim.
      tokens.push(`"%${key}%"`);
    }

    // cmd.exe strips the first and last quote of a /c string that starts with
    // `"`, so wrap the whole command once more to preserve per-arg quotes.
    const cmdline = `"${tokens.join(' ')}"`;

    return {
      command: comspec,
      args: ['/d', '/s', '/c', cmdline],
      options: { ...baseOptions, env, windowsVerbatimArguments: true },
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
