import type { Plan } from '@agendex/web';
import { useMemo, useState } from 'react';
import {
  getCloudCustomPlanSources,
  type CloudCustomPlanSource,
} from '../lib/cloud-plan-sources.ts';

interface CloudPlanSourcesDialogProps {
  readonly open: boolean;
  readonly plans: readonly Plan[];
  readonly onClose: () => void;
  readonly onDeletePlan: (planId: string) => Promise<void>;
}

const DELETE_BATCH_SIZE = 5;

async function deletePlansInBatches(
  planIds: readonly string[],
  onDeletePlan: (planId: string) => Promise<void>,
): Promise<void> {
  for (let start = 0; start < planIds.length; start += DELETE_BATCH_SIZE) {
    const batch = planIds.slice(start, start + DELETE_BATCH_SIZE);
    await Promise.all(batch.map((planId) => onDeletePlan(planId)));
  }
}

export function CloudPlanSourcesDialog({
  open,
  plans,
  onClose,
  onDeletePlan,
}: CloudPlanSourcesDialogProps) {
  const sources = useMemo(() => getCloudCustomPlanSources(plans), [plans]);
  const [confirming, setConfirming] = useState<CloudCustomPlanSource | null>(null);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function handleDelete(source: CloudCustomPlanSource) {
    setDeletingPath(source.path);
    setError(null);
    try {
      await deletePlansInBatches(
        source.plans.map((plan) => plan.id),
        onDeletePlan,
      );
      setConfirming(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove synced source');
    } finally {
      setDeletingPath(null);
    }
  }

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !deletingPath) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !deletingPath) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cloud-plan-sources-title"
        className="rounded-xl border border-border bg-surface shadow-lg"
        style={{ width: 520, maxHeight: '80vh', overflow: 'auto' }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 id="cloud-plan-sources-title" className="text-[15px] font-semibold text-text m-0">
            Cloud Plan Sources
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={Boolean(deletingPath)}
            className="w-7 h-7 rounded-lg border border-border bg-transparent text-tertiary cursor-pointer flex items-center justify-center disabled:cursor-default disabled:opacity-50"
            style={{ lineHeight: 0 }}
            aria-label="Close"
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
            Remove synced custom directories from Cloud. This deletes the cloud plan rows only; stop
            watching the directory locally or it can sync again.
          </p>

          {error && (
            <div className="text-[12px] text-red-400 bg-red-400/10 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {sources.length === 0 ? (
            <p className="text-[12px] text-tertiary m-0 text-center py-3">
              No synced custom directories found in Cloud.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {sources.map((source) => {
                const isConfirming = confirming?.path === source.path;
                const isDeleting = deletingPath === source.path;

                return (
                  <div
                    key={source.path}
                    className="flex flex-col gap-3 py-3 px-3 rounded-lg border border-border"
                  >
                    <div className="flex items-center gap-2">
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
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                      </svg>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-semibold text-text truncate">
                          {source.label}
                        </div>
                        <div
                          className="text-[12px] text-secondary truncate"
                          style={{ fontFamily: 'var(--font-mono)' }}
                          title={source.path}
                        >
                          {source.path}
                        </div>
                      </div>
                      <span className="sidebar-count-pill">{source.plans.length}</span>
                      <button
                        type="button"
                        onClick={() => setConfirming(source)}
                        disabled={Boolean(deletingPath)}
                        className="text-[12px] font-medium px-3 py-1.5 rounded-md border border-border bg-transparent text-[var(--danger)] cursor-pointer disabled:cursor-default disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>

                    {isConfirming && (
                      <div className="rounded-lg border border-border bg-bg px-3 py-3 flex flex-col gap-2">
                        <p className="text-[12px] text-secondary m-0 leading-[1.5]">
                          Delete {source.plans.length} cloud plan
                          {source.plans.length === 1 ? '' : 's'} from this source?
                        </p>
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setConfirming(null)}
                            disabled={Boolean(deletingPath)}
                            className="text-[12px] font-medium px-3 py-1.5 rounded-md border border-border bg-transparent text-secondary cursor-pointer disabled:cursor-default disabled:opacity-50"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(source)}
                            disabled={Boolean(deletingPath)}
                            className="text-[12px] font-semibold px-3 py-1.5 rounded-md border border-border cursor-pointer disabled:cursor-default disabled:opacity-50"
                            style={{ background: 'var(--danger)', color: 'var(--bg)' }}
                          >
                            {isDeleting ? 'Removing...' : 'Delete from Cloud'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
