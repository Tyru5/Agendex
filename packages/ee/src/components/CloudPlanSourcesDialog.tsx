import type { Plan } from '@agendex/web';
import { useMemo, useState } from 'react';
import {
  getCloudCustomPlanSources,
  type CloudCustomPlanSource,
} from '../lib/cloud-plan-sources.ts';
import {
  CloudPlanSourcesDeleteActivity,
  type DeleteJob,
} from './CloudPlanSourcesDeleteActivity.tsx';

interface CloudPlanSourcesDialogProps {
  readonly open: boolean;
  readonly plans: readonly Plan[];
  readonly onClose: () => void;
  readonly onDeletePlan: (planId: string) => Promise<void>;
}

const DELETE_BATCH_SIZE = 5;

interface DeleteJobRequest {
  readonly path: string;
  readonly planIds: readonly string[];
}

async function deletePlansInBatches(
  planIds: readonly string[],
  onDeletePlan: (planId: string) => Promise<void>,
  onProgress: () => void,
): Promise<void> {
  for (let start = 0; start < planIds.length; start += DELETE_BATCH_SIZE) {
    const batch = planIds.slice(start, start + DELETE_BATCH_SIZE);
    await Promise.all(
      batch.map(async (planId) => {
        await onDeletePlan(planId);
        onProgress();
      }),
    );
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
  const [deleteJobs, setDeleteJobs] = useState<ReadonlyMap<string, DeleteJob>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  const deleteJobList = useMemo(() => [...deleteJobs.values()], [deleteJobs]);

  if (!open) return null;

  function updateDeleteJob(
    path: string,
    getNextJob: (job: DeleteJob | undefined) => DeleteJob | undefined,
  ) {
    setDeleteJobs((currentJobs) => {
      const nextJobs = new Map(currentJobs);
      const nextJob = getNextJob(nextJobs.get(path));
      if (nextJob) {
        nextJobs.set(path, nextJob);
      } else {
        nextJobs.delete(path);
      }
      return nextJobs;
    });
  }

  async function runDeleteJob(request: DeleteJobRequest): Promise<void> {
    try {
      await deletePlansInBatches(request.planIds, onDeletePlan, () => {
        updateDeleteJob(request.path, (job) =>
          job ? { ...job, completed: Math.min(job.completed + 1, job.total) } : undefined,
        );
      });
      updateDeleteJob(request.path, (job) =>
        job
          ? { ...job, completed: job.total, status: 'done', message: 'Finished in Cloud' }
          : undefined,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove synced source';
      updateDeleteJob(request.path, (job) =>
        job ? { ...job, status: 'failed', message } : undefined,
      );
    }
  }

  function handleDelete(source: CloudCustomPlanSource) {
    if (deleteJobs.get(source.path)?.status === 'running') return;
    const planIds = source.plans.map((plan) => plan.id);
    setConfirming(null);
    setError(null);
    updateDeleteJob(source.path, () => ({
      path: source.path,
      label: source.label,
      completed: 0,
      total: planIds.length,
      status: 'running',
      message: 'Removing in background',
    }));
    void runDeleteJob({ path: source.path, planIds });
  }

  return (
    <div
      role="presentation"
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
        role="dialog"
        aria-modal="true"
        aria-labelledby="cloud-plan-sources-title"
        className="rounded-xl border border-border bg-surface shadow-lg"
        style={{ width: 'min(520px, calc(100vw - 24px))', maxHeight: '80vh', overflow: 'auto' }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 id="cloud-plan-sources-title" className="text-[15px] font-semibold text-text m-0">
            Cloud Plan Sources
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg border border-border bg-transparent text-tertiary cursor-pointer flex items-center justify-center"
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

          <CloudPlanSourcesDeleteActivity
            jobs={deleteJobList}
            onDismiss={(path) => updateDeleteJob(path, () => undefined)}
          />

          {sources.length === 0 ? (
            <p className="text-[12px] text-tertiary m-0 text-center py-3">
              No synced custom directories found in Cloud.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {sources.map((source) => {
                const isConfirming = confirming?.path === source.path;
                const deleteJob = deleteJobs.get(source.path);
                const isDeleting = deleteJob?.status === 'running';

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
                      {isDeleting && (
                        <span className="hidden sm:inline text-[11px] text-tertiary whitespace-nowrap">
                          Removing in background
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => setConfirming(source)}
                        disabled={isDeleting}
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
                            className="text-[12px] font-medium px-3 py-1.5 rounded-md border border-border bg-transparent text-secondary cursor-pointer"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(source)}
                            disabled={isDeleting}
                            className="text-[12px] font-semibold px-3 py-1.5 rounded-md border border-border cursor-pointer disabled:cursor-default disabled:opacity-50"
                            style={{ background: 'var(--danger)', color: 'var(--bg)' }}
                          >
                            {isDeleting ? 'Removing in background' : 'Delete from Cloud'}
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
