import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.ts';

interface PlanSourcesDialogProps {
  open: boolean;
  onClose: () => void;
  onSourcesChanged?: () => void;
}

export function PlanSourcesDialog({ open, onClose, onSourcesChanged }: PlanSourcesDialogProps) {
  const [dirs, setDirs] = useState<string[]>([]);
  const [newPath, setNewPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchSources = useCallback(async () => {
    try {
      const res = await api.getPlanSources();
      setDirs(res.customPlanDirs);
    } catch {
      setError('Failed to load plan sources');
    }
  }, []);

  useEffect(() => {
    if (!open) return;

    fetchSources();
    setError(null);
    setNewPath('');
    const focusTimer = setTimeout(() => inputRef.current?.focus(), 100);

    return () => clearTimeout(focusTimer);
  }, [open, fetchSources]);

  async function handleAdd() {
    const trimmed = newPath.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.addPlanSource(trimmed);
      setDirs(res.customPlanDirs);
      setNewPath('');
      onSourcesChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add directory');
    } finally {
      setLoading(false);
    }
  }

  async function handleRemove(path: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await api.removePlanSource(path);
      setDirs(res.customPlanDirs);
      onSourcesChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove directory');
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        className="rounded-xl border border-border bg-surface shadow-lg"
        style={{ width: 480, maxHeight: '80vh', overflow: 'auto' }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-[15px] font-semibold text-text m-0">Custom Plan Sources</h3>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg border border-border bg-transparent text-tertiary cursor-pointer flex items-center justify-center"
            style={{ lineHeight: 0 }}
          >
            <svg viewBox="0 0 16 16" fill="none" width="12" height="12" aria-hidden="true">
              <path
                d="M12 4L4 12M4 4l8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-3">
          <p className="text-[12px] text-tertiary m-0 leading-[1.5]">
            Add filesystem directories to scan for markdown plan files. Changes take effect
            immediately.
          </p>

          {error && (
            <div className="text-[12px] text-red-400 bg-red-400/10 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAdd();
              }}
              placeholder="/path/to/plans"
              disabled={loading}
              className="flex-1 text-[13px] px-3 py-2 rounded-lg border border-border bg-bg text-text placeholder:text-tertiary outline-none"
              style={{ fontFamily: 'inherit' }}
            />
            <button
              type="button"
              onClick={handleAdd}
              disabled={loading || !newPath.trim()}
              className="text-[13px] font-medium px-4 py-2 rounded-lg border border-border cursor-pointer"
              style={{
                background: newPath.trim() ? 'var(--hover)' : 'transparent',
                color: 'var(--text)',
                opacity: loading || !newPath.trim() ? 0.5 : 1,
              }}
            >
              Add
            </button>
          </div>

          {dirs.length > 0 && (
            <div className="flex flex-col gap-1">
              {dirs.map((dir) => (
                <div
                  key={dir}
                  className="flex items-center gap-2 py-2 px-3 rounded-lg border border-border"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-tertiary shrink-0"
                    aria-hidden="true"
                  >
                    <path d="m22 19-10-7 10-7z" />
                    <path d="M2 19V5l10 7-10 7z" />
                  </svg>
                  <span
                    className="flex-1 text-[12px] text-secondary truncate"
                    style={{ fontFamily: 'monospace' }}
                    title={dir}
                  >
                    {dir}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemove(dir)}
                    disabled={loading}
                    className="w-6 h-6 rounded-md border border-border bg-transparent text-tertiary cursor-pointer flex items-center justify-center shrink-0"
                    style={{ opacity: loading ? 0.5 : 1 }}
                    title="Remove"
                  >
                    <svg viewBox="0 0 16 16" fill="none" width="10" height="10" aria-hidden="true">
                      <path
                        d="M12 4L4 12M4 4l8 8"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {dirs.length === 0 && (
            <p className="text-[12px] text-tertiary m-0 text-center py-3">
              No custom directories configured. Add a path above to start scanning.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
