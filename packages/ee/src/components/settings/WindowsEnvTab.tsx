import { useEffect, useState } from 'react';
import {
  getDesktopWindowsEnv,
  setDesktopWindowsEnv,
  type WindowsAgentEnv,
  type WindowsEnvStatus,
} from '../../lib/desktop.ts';
import { useDesktopDaemonState } from '../../hooks/useDesktopDaemonState.ts';

function envLabel(env: WindowsAgentEnv): string {
  return env === 'wsl' ? 'WSL' : 'Windows';
}

export function WindowsEnvTab() {
  const daemonState = useDesktopDaemonState();
  const [status, setStatus] = useState<WindowsEnvStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [confirmEnv, setConfirmEnv] = useState<WindowsAgentEnv | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    let mounted = true;
    void getDesktopWindowsEnv().then((next) => {
      if (!mounted) return;
      setStatus(next);
      setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, []);

  async function applyEnv(env: WindowsAgentEnv) {
    setPending(true);
    setError(null);
    try {
      const result = await setDesktopWindowsEnv(env);
      if (!result) {
        setError('Could not update environment.');
        setPending(false);
        setConfirmEnv(null);
        return;
      }
      if (!result.ok) {
        setError(result.error ?? 'Could not update environment.');
        setStatus(result);
        setPending(false);
        setConfirmEnv(null);
        return;
      }
      setStatus(result);
      if (result.willRelaunch) {
        setRestarting(true);
        return;
      }
      setPending(false);
      setConfirmEnv(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPending(false);
      setConfirmEnv(null);
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-6 text-[13px] text-tertiary">
        Loading plan folder settings…
      </div>
    );
  }

  if (!status) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-6 text-[13px] text-tertiary">
        Plan folder selection is only available in the Windows desktop app.
      </div>
    );
  }

  const current = status.env;
  const wslDisabled = !status.wslAvailable || pending || restarting;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-surface p-6">
        <h3 className="text-[14px] font-semibold text-text mb-1">Plan folders</h3>
        <p className="text-[13px] text-tertiary mb-5 leading-[1.55]">
          Choose where Agendex reads agent plan files. The Electron app and its settings always run
          on Windows.
        </p>

        <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-hover/60 border border-border">
          {(['native', 'wsl'] as const).map((env) => {
            const selected = current === env;
            const disabled = env === 'wsl' ? wslDisabled : pending || restarting;
            return (
              <button
                key={env}
                type="button"
                disabled={disabled}
                aria-pressed={selected}
                onClick={() => {
                  if (selected || pending || restarting) return;
                  setConfirmEnv(env);
                  setError(null);
                }}
                className={[
                  'rounded-lg px-3 py-2.5 text-[13px] font-medium border transition-colors',
                  selected
                    ? 'bg-surface border-border text-text shadow-sm'
                    : 'bg-transparent border-transparent text-secondary hover:text-text',
                  disabled && !selected ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
                ].join(' ')}
              >
                {envLabel(env)}
              </button>
            );
          })}
        </div>

        <div className="mt-4 space-y-1.5 text-[12px] text-tertiary">
          {status.env === 'wsl' && status.wslHomePath && (
            <p className="mb-0">
              WSL home:{' '}
              <code className="font-mono text-[11px] bg-hover px-1.5 py-0.5 rounded break-all">
                {status.wslHomePath}
              </code>
              {status.wslDistroName ? ` (${status.wslDistroName})` : null}
            </p>
          )}
          {!status.wslAvailable && (
            <p className="mb-0">{status.error ?? 'WSL not detected on this machine.'}</p>
          )}
          {daemonState && daemonState.status !== 'idle' && (
            <p className="mb-0 pt-1">
              Sync service:{' '}
              <span className="text-secondary">
                {daemonState.status === 'error'
                  ? daemonState.message
                  : daemonState.status === 'indexing' || daemonState.status === 'starting'
                    ? (daemonState.message ?? 'Starting')
                    : daemonState.status === 'ready'
                      ? 'Ready'
                      : 'Stopping'}
              </span>
            </p>
          )}
        </div>
      </div>

      {confirmEnv && !restarting && (
        <div className="rounded-2xl border border-border bg-surface p-6">
          <h3 className="text-[14px] font-semibold text-text mb-2">Restart required</h3>
          <p className="text-[13px] text-secondary mb-4 leading-[1.55]">
            Agendex needs to restart to use {envLabel(confirmEnv)} plan folders.
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              disabled={pending}
              onClick={() => void applyEnv(confirmEnv)}
              className="agendex-topbar-primary text-[13px] px-4 py-2 rounded-lg cursor-pointer font-semibold disabled:opacity-50"
            >
              {pending ? 'Restarting…' : 'Restart and switch'}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirmEnv(null)}
              className="agendex-topbar-button text-[13px] px-4 py-2 rounded-lg border border-border cursor-pointer font-medium disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {restarting && (
        <div className="rounded-2xl border border-border bg-surface p-6 text-[13px] text-secondary">
          Restarting to apply…
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-border bg-surface p-4 text-[12px] text-[var(--danger,#ff4757)]">
          {error}
        </div>
      )}
    </div>
  );
}
