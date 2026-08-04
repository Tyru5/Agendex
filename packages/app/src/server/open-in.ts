/**
 * Launch a local application on a pre-resolved file path. Argv-only spawn,
 * detached so the server never blocks on the launched process.
 */
import { spawn } from 'node:child_process';
import { buildLaunchCommand } from '@agendex/shared';

export interface OpenInLaunchResult {
  ok: boolean;
  error?: string;
}

/** Brief window to catch immediate spawn failures (ENOENT/EACCES) before OK. */
const SPAWN_ERROR_GRACE_MS = 40;

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
      const child = spawn(argv[0]!, argv.slice(1), { detached: true, stdio: 'ignore' });
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
