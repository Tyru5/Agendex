export type DeleteJobStatus = 'running' | 'done' | 'failed';

export interface DeleteJob {
  readonly path: string;
  readonly label: string;
  readonly completed: number;
  readonly total: number;
  readonly status: DeleteJobStatus;
  readonly message?: string;
}

interface CloudPlanSourcesDeleteActivityProps {
  readonly jobs: readonly DeleteJob[];
  readonly onDismiss: (path: string) => void;
}

export function CloudPlanSourcesDeleteActivity({
  jobs,
  onDismiss,
}: CloudPlanSourcesDeleteActivityProps) {
  if (jobs.length === 0) return null;

  return (
    <div
      className="rounded-lg border border-border bg-bg px-3 py-3 flex flex-col gap-2"
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-[12px] font-semibold text-text">Background activity</div>
        <div className="text-[11px] text-tertiary">Safe to close</div>
      </div>
      <div className="flex flex-col gap-2">
        {jobs.map((job) => (
          <div key={job.path} className="flex items-center gap-3">
            <div
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{
                background:
                  job.status === 'failed'
                    ? 'var(--danger)'
                    : job.status === 'done'
                      ? 'var(--accent)'
                      : 'var(--tertiary)',
              }}
            />
            <div className="min-w-0 flex-1">
              <div className="text-[12px] text-secondary truncate">
                {job.status === 'running' ? `Removing ${job.label} in background` : job.message}
              </div>
              <div
                className="text-[11px] text-tertiary truncate"
                style={{ fontFamily: 'var(--font-mono)' }}
                title={job.path}
              >
                {job.completed}/{job.total} plans - {job.path}
              </div>
            </div>
            {job.status !== 'running' && (
              <button
                type="button"
                onClick={() => onDismiss(job.path)}
                className="text-[11px] font-medium px-2 py-1 rounded-md border border-border bg-transparent text-tertiary cursor-pointer"
              >
                Dismiss
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
